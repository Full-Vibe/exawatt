/**
 * Live consumption store (ENG-008 E5) — the ONE renderer-side consumer of the
 * `window.electron.consumption` bridge.
 *
 * Every live consumer — `useTenantConsumption` (the meter + `/usage`), the
 * Team-tile burn readouts, the Fleet burn lens — reads through this module,
 * so the whole renderer holds exactly one IPC subscription, one snapshot
 * cache, and one built view per revision. A second subscriber is how the
 * title bar and the page start disagreeing; this store makes that
 * structurally impossible, extending the tenant-seam invariant to Live.
 *
 * Update discipline (contract: `consumption/live-snapshot.ts`):
 * - `consumption:updated` is notification-only; the store pulls a bounded
 *   snapshot (`sinceMs` = the view window) when the revision advances.
 * - Identity meta (Session titles, worktree-aware project roots) joins from
 *   the fleet's own records — live PTYs, the closed-session ledger, and the
 *   workspace layout — over main's durable↔provider identity index. The
 *   store never re-derives identity from log contents.
 * - A 60s re-pin rebuilds the view from cached data with a fresh `nowMs`
 *   so resets and pace stay current between scans; a 5-minute polite
 *   `rescan()` keeps the data itself fresh (debounced and cheap in main by
 *   contract — watermarked incremental passes).
 *
 * SSR/web-safe: without the bridge the store is permanently `unavailable`
 * and the tenant seam falls back to the demo corpus (explicitly bannered).
 */
import type {
  ClosedSessionEntry,
  PtyHarness,
  PtySessionInfo,
} from '@/types/electron';
import {
  HARNESS_ORDER,
  isDefaultHarnessTitle,
} from '@/components/workspace/harnesses';
import { sessionDisplayCopy } from '@/components/workspace/session-display-copy';
import {
  emptyLiveConsumptionSnapshot,
  type ConsumptionSourceId,
  type ConsumptionUpdatedEvent,
  type LiveConsumptionSnapshot,
} from '@exawatt/core';
import { extractLocalWorkspaceProjects } from '@/lib/fleet/local-workspace-sessions';
import type { DemoConsumption } from './demo-source';
import {
  LIVE_WINDOW_DAYS,
  buildLiveConsumption,
  liveScanView,
  type LiveProjectRecord,
  type LiveScanView,
  type LiveSessionIdentity,
} from './live-source';

const DAY_MS = 24 * 3_600_000;
const REPIN_MS = 60_000;
const RESCAN_MS = 5 * 60_000;
const REFETCH_DEBOUNCE_MS = 250;

export type LiveConsumptionStatus = 'unavailable' | 'pending' | 'ready';

export interface LiveSessionBurn {
  rawTokens: number;
  normalizedTokens: number;
}

export interface LiveConsumptionState {
  status: LiveConsumptionStatus;
  /**
   * The built live view. Present from the first tick whenever the bridge
   * exists — an honest EMPTY view while the first pull is in flight (the
   * meter renders unknown, the page renders absent states), never the demo
   * corpus flashing real-looking numbers.
   */
  view: DemoConsumption | null;
  scan: LiveScanView | null;
  /** Per provider-session burn for the entity carriers (tiles, lens). */
  burnByProviderId: ReadonlyMap<string, LiveSessionBurn>;
  /**
   * The snapshot revision this state was built from (-1 when none). Emits
   * also happen on 60s now-re-pins; consumers doing real work per DATA
   * change (the fleet re-list) gate on this instead of on every emit.
   */
  revision: number;
}

const UNAVAILABLE: LiveConsumptionState = Object.freeze({
  status: 'unavailable' as const,
  view: null,
  scan: null,
  burnByProviderId: new Map<string, LiveSessionBurn>(),
  revision: -1,
});

type HarnessSource = ConsumptionSourceId | null;
const HARNESS_TO_SOURCE: Record<string, HarnessSource> = {
  claude: 'claude-code',
  codex: 'codex',
};

function bridge() {
  if (typeof window === 'undefined') return undefined;
  return window.electron?.consumption;
}

/* ------------------------------------------------------------------ */
/* identity assembly — fleet records over main's identity index        */
/* ------------------------------------------------------------------ */

/**
 * Everything `sessionDisplayCopy` needs, carried from whichever fleet record
 * knows this Session. The raw `title` is NOT display copy: for an unrenamed
 * Session it is the harness's own default ("Claude Code"), which is why the
 * grid rendered fourteen identically-named rows while the Team altitude —
 * the one surface that called the resolver — showed real names.
 */
interface DurableMeta {
  title: string;
  titleKind: 'default' | 'operator';
  harness: PtyHarness;
  lifecycle: string;
  summary: string | null;
  projectDir: string | null;
}

const HARNESSES: readonly string[] = HARNESS_ORDER;
const asHarness = (value: unknown): PtyHarness =>
  typeof value === 'string' && HARNESSES.includes(value)
    ? (value as PtyHarness)
    : 'claude';

/** A record that predates explicit title ownership states it by shape. */
function titleKindOf(
  declared: unknown,
  harness: PtyHarness,
  title: string
): 'default' | 'operator' {
  if (declared === 'default' || declared === 'operator') return declared;
  return isDefaultHarnessTitle(harness, title) ? 'default' : 'operator';
}

function layoutMeta(layout: unknown): Map<string, DurableMeta> {
  const out = new Map<string, DurableMeta>();
  if (!layout || typeof layout !== 'object') return out;
  const root = layout as { projects?: unknown; initiatives?: unknown };
  const groups = Array.isArray(root.projects) ? root.projects : root.initiatives;
  if (!Array.isArray(groups)) return out;
  for (const candidate of groups) {
    if (!candidate || typeof candidate !== 'object') continue;
    const group = candidate as { dir?: unknown; tabs?: unknown };
    const dir = typeof group.dir === 'string' ? group.dir : null;
    if (!Array.isArray(group.tabs)) continue;
    for (const row of group.tabs) {
      if (!row || typeof row !== 'object') continue;
      const tab = row as {
        durableSessionId?: unknown;
        id?: unknown;
        title?: unknown;
        titleKind?: unknown;
        harness?: unknown;
        lifecycle?: unknown;
        contextSummary?: unknown;
      };
      const durableId =
        typeof tab.durableSessionId === 'string'
          ? tab.durableSessionId
          : typeof tab.id === 'string'
            ? tab.id
            : null;
      if (!durableId) continue;
      const harness = asHarness(tab.harness);
      const title =
        typeof tab.title === 'string' && tab.title.trim() ? tab.title : 'Session';
      out.set(durableId, {
        title,
        titleKind: titleKindOf(tab.titleKind, harness, title),
        harness,
        lifecycle: typeof tab.lifecycle === 'string' ? tab.lifecycle : 'stopped',
        summary:
          typeof tab.contextSummary === 'string' && tab.contextSummary.trim()
            ? tab.contextSummary
            : null,
        projectDir: dir,
      });
    }
  }
  return out;
}

function assembleIdentities(
  snapshot: LiveConsumptionSnapshot,
  ptys: PtySessionInfo[],
  closed: ClosedSessionEntry[],
  layout: unknown
): LiveSessionIdentity[] {
  const meta = new Map<string, DurableMeta>();
  // Oldest truth first so fresher records override: ledger → layout → live.
  for (const entry of closed) {
    meta.set(entry.durableSessionId, {
      title: entry.title,
      titleKind: titleKindOf(entry.titleKind, entry.harness, entry.title),
      harness: entry.harness,
      lifecycle: 'stopped-clean',
      // The ledger's `goal` IS the durable context label the workspace
      // restores as this Session's summary.
      summary: entry.goal,
      projectDir: entry.projectDir || null,
    });
  }
  for (const [id, m] of layoutMeta(layout)) meta.set(id, m);
  for (const p of ptys) {
    meta.set(p.durableSessionId, {
      title: p.title,
      // A live PTY carries no title ownership on the wire; its shape states it.
      titleKind: titleKindOf(undefined, p.harness, p.title),
      harness: p.harness,
      lifecycle: p.exited ? 'stopped' : 'running',
      summary: p.contextSummary ?? null,
      projectDir: p.projectDir || null,
    });
  }

  const identities = new Map<string, LiveSessionIdentity>();
  for (const link of snapshot.sessionIdentities) {
    const m = meta.get(link.durableSessionId);
    // An index row whose durable Session no longer exists anywhere in the
    // fleet record has no honest title to show — the provider session then
    // renders as the outside-fleet-record row it truthfully is.
    if (!m) continue;
    identities.set(`${link.source}:${link.providerSessionId}`, {
      providerSessionId: link.providerSessionId,
      source: link.source,
      // THE one display-identity projection, shared with the tab strip and
      // the Team tiles — a Session is named identically on every surface.
      title: displayTitle(m),
      projectDir: m.projectDir ?? (link.cwd || null),
      // Owed to the contract (recorded in the project doc): live
      // intervention counts — UserPromptSubmit via the ENG-023 channel for
      // Claude Code, user turns in Codex rollouts. Until the snapshot
      // carries them: null — unrecorded, never zero.
      interventions: null,
    });
  }
  // A live PTY can capture its provider identity moments before main's
  // persisted index catches up — union it in so a running Session is never
  // nameless on its own machine.
  for (const p of ptys) {
    const source = HARNESS_TO_SOURCE[p.harness] ?? null;
    if (!source || !p.harnessSessionId) continue;
    const key = `${source}:${p.harnessSessionId}`;
    if (identities.has(key)) continue;
    identities.set(key, {
      providerSessionId: p.harnessSessionId,
      source,
      title: displayTitle({
        title: p.title,
        titleKind: titleKindOf(undefined, p.harness, p.title),
        harness: p.harness,
        lifecycle: p.exited ? 'stopped' : 'running',
        summary: p.contextSummary ?? null,
        projectDir: p.projectDir || null,
      }),
      projectDir: p.projectDir || null,
      interventions: null,
    });
  }
  return [...identities.values()];
}

/** The visible identity every Session surface must render (ENG-016 D18). */
function displayTitle(m: DurableMeta): string {
  return sessionDisplayCopy({
    harness: m.harness,
    title: m.title,
    titleKind: m.titleKind,
    lifecycle: m.lifecycle,
    summary: m.summary,
  }).primary;
}

function sessionBurn(view: DemoConsumption): Map<string, LiveSessionBurn> {
  const out = new Map<string, LiveSessionBurn>();
  for (const [providerSessionId, rollup] of view.sessionsById) {
    out.set(providerSessionId, {
      rawTokens:
        rollup.totals.inputTokens +
        rollup.totals.cacheReadTokens +
        rollup.totals.cacheWriteTokens +
        rollup.totals.outputTokens,
      normalizedTokens: rollup.weightedTokens,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* the store                                                           */
/* ------------------------------------------------------------------ */

interface CachedInputs {
  snapshot: LiveConsumptionSnapshot;
  identities: LiveSessionIdentity[];
  projects: LiveProjectRecord[];
}

let state: LiveConsumptionState | null = null;
let cached: CachedInputs | null = null;
let listeners = new Set<() => void>();
let started = false;
let lastRevision = -1;
let refetchTimer: ReturnType<typeof setTimeout> | null = null;
let repinTimer: ReturnType<typeof setInterval> | null = null;
let rescanTimer: ReturnType<typeof setInterval> | null = null;
let disposers: Array<() => void> = [];

function emit(): void {
  for (const l of [...listeners]) l();
}

function setState(next: LiveConsumptionState): void {
  state = next;
  emit();
}

function buildState(
  inputs: CachedInputs,
  status: LiveConsumptionStatus
): LiveConsumptionState {
  const view = buildLiveConsumption({
    nowMs: Date.now(),
    samples: inputs.snapshot.samples,
    planWindows: inputs.snapshot.planWindows,
    windowRates: inputs.snapshot.windowRates,
    windowObservations: inputs.snapshot.windowObservations,
    identities: inputs.identities,
    projects: inputs.projects,
    // ENG-038 account state — the plan-credit spend and, load-bearing, the
    // read's own health. Dropping it here is what made a failed vendor read
    // present as "this source keeps no plan record".
    ...(inputs.snapshot.providerPlanAccounts
      ? { providerPlanAccounts: inputs.snapshot.providerPlanAccounts }
      : {}),
  });
  return {
    status,
    view,
    scan: liveScanView(inputs.snapshot.scanState),
    burnByProviderId: sessionBurn(view),
    revision: inputs.snapshot.scanState.revision,
  };
}

let pulling = false;
let pullAgain = false;

/**
 * Single-flight, monotonic pulls. Two guards close a real race observed on
 * the first scan: the boot pull can resolve AFTER an updated-triggered pull
 * (the scanner streams progressive revisions), and applying it late would
 * overwrite real samples with the earlier, emptier snapshot.
 * - only one pull runs at a time; a request during flight queues one rerun;
 * - a resolved snapshot older than the applied one is dropped, never applied.
 */
async function refetch(): Promise<void> {
  const api = bridge();
  if (!api) return;
  if (pulling) {
    pullAgain = true;
    return;
  }
  pulling = true;
  try {
    do {
      pullAgain = false;
      const pty = window.electron?.pty;
      const workspace = window.electron?.workspace;
      const [snapshot, ptys, closed, layout] = await Promise.all([
        api.snapshot({ sinceMs: Date.now() - LIVE_WINDOW_DAYS * DAY_MS }),
        pty?.list().catch(() => []) ?? Promise.resolve([]),
        pty?.closedSessions().catch(() => []) ?? Promise.resolve([]),
        workspace?.load().catch(() => null) ?? Promise.resolve(null),
      ]);
      lastRevision = Math.max(lastRevision, snapshot.scanState.revision);
      if (
        cached &&
        snapshot.scanState.revision < cached.snapshot.scanState.revision
      ) {
        continue; // stale pull — keep the newer applied state
      }
      const identities = assembleIdentities(snapshot, ptys, closed, layout);
      const projects: LiveProjectRecord[] = extractLocalWorkspaceProjects(
        layout
      ).map(p => ({
        dir: p.id,
        name: p.label,
        ...(p.color ? { color: p.color } : {}),
      }));
      cached = { snapshot, identities, projects };
      setState(buildState(cached, 'ready'));
    } while (pullAgain);
  } catch {
    // A failed pull keeps the last honest state; the next revision retries.
  } finally {
    pulling = false;
  }
}

function scheduleRefetch(): void {
  if (refetchTimer) clearTimeout(refetchTimer);
  refetchTimer = setTimeout(() => {
    refetchTimer = null;
    void refetch();
  }, REFETCH_DEBOUNCE_MS);
}

function start(): void {
  if (started) return;
  const api = bridge();
  if (!api) return;
  started = true;

  disposers.push(
    api.onUpdated((event: ConsumptionUpdatedEvent) => {
      if (event.revision <= lastRevision) return;
      scheduleRefetch();
    })
  );
  const offWorkspace = window.electron?.workspace?.onChanged?.(() =>
    scheduleRefetch()
  );
  if (offWorkspace) disposers.push(offWorkspace);

  // Fresh "now" between scans: resets tick down and pace stays current.
  repinTimer = setInterval(() => {
    if (!cached || document.visibilityState !== 'visible') return;
    setState(buildState(cached, 'ready'));
  }, REPIN_MS);
  // Polite freshness: an incremental watermarked pass is cheap by contract
  // and main debounces; a hidden window does not scan.
  rescanTimer = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    void api.rescan();
  }, RESCAN_MS);

  void refetch();
}

/** For tests only: tear the singleton down so a fresh bridge can be faked. */
export function resetLiveConsumptionForTests(): void {
  for (const off of disposers) off();
  disposers = [];
  if (refetchTimer) clearTimeout(refetchTimer);
  refetchTimer = null;
  if (repinTimer) clearInterval(repinTimer);
  repinTimer = null;
  if (rescanTimer) clearInterval(rescanTimer);
  rescanTimer = null;
  listeners = new Set();
  state = null;
  cached = null;
  started = false;
  lastRevision = -1;
  pendingState = null;
  pulling = false;
  pullAgain = false;
}

let pendingState: LiveConsumptionState | null = null;

/** The pre-first-pull state: an honest empty live view, built once. */
function pending(): LiveConsumptionState {
  if (!pendingState) {
    pendingState = buildState(
      {
        snapshot: emptyLiveConsumptionSnapshot(Date.now()),
        identities: [],
        projects: [],
      },
      'pending'
    );
  }
  return pendingState;
}

export function subscribeLiveConsumption(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLiveConsumption(): LiveConsumptionState {
  if (!bridge()) return UNAVAILABLE;
  return state ?? pending();
}

/** SSR snapshot: the bridge never exists on the server. */
export function getServerLiveConsumption(): LiveConsumptionState {
  return UNAVAILABLE;
}

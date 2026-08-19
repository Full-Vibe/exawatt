'use client';

/**
 * Connected sources (ENG-010 C2).
 *
 * C1 landed a persisted registry of configured sources: saved connections to
 * an OpenClaw Gateway running on this machine or on a server the operator
 * hosts. This is the surface for them, inside the one place the product
 * promises will hold source instances and connection health.
 *
 * Three product rules shape every string and every row here.
 *
 * 1. Facts stay separate. Placement, connection freshness, credential
 *    custody, version, and capabilities are five different questions and get
 *    five different answers. A roll-up helps scanning; it may never swallow
 *    the fact underneath it.
 * 2. Connection is observation, never work state. Nothing on this surface may
 *    claim the remote installation stopped, paused, or ended because Exawatt
 *    cannot currently see it. The connection vocabulary has exactly one owner,
 *    `describeConnectionStatus` in `@exawatt/core`, and this file does not
 *    mint a second one.
 * 3. Detach is Exawatt's record and Exawatt's stored credential, and nothing
 *    else. The confirmation says what goes and what stays, in that order, so a
 *    careful reader cannot mistake it for deletion.
 */

import {
  Check,
  Cloud,
  History,
  KeyRound,
  LoaderCircle,
  Monitor,
  Pencil,
  RefreshCw,
  Server,
  Sparkles,
  Unplug,
  WifiOff,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ClaudeIcon,
  OpenAIIcon,
  OpenCodeIcon,
  OpenClawIcon,
} from '@/components/workspace/harness-icons';
import { SourceIdentityMark } from '@/components/workspace/source-identity-mark';
import { agentSourceDeclaration } from '@/generated/agent-source-declarations';
import {
  describeConnectionStatus,
  type AgentSourceAdapterId,
  type AgentSourceEvidenceBasis,
  type AgentSourcePlacement,
  type ConnectedSourceView,
  type ConnectionStatus,
  type SourceConnectionState,
} from '@exawatt/core';
import type {
  ConnectedSourceStatusView,
  ElectronConnectedSourcesApi,
  ObservedSourceCapability,
  ObservedSourceFact,
} from '@/types/electron';

/* ------------------------------------------------------------------ */
/* Bridge                                                              */
/* ------------------------------------------------------------------ */

/**
 * One observation of one configured source, exactly as `status()` reports it.
 *
 * Version and capabilities are part of that contract rather than a local
 * augmentation of it: the session reads both on every discovery, so the rows
 * below render what the source actually said. Null and empty still mean "not
 * observed this launch", and every row says so rather than inventing a value.
 */
export type ConnectedSourceObservation = ConnectedSourceStatusView;

export type ObservedFact = ObservedSourceFact;
export type ObservedCapability = ObservedSourceCapability;

/**
 * `window.electron.connectedSources`, or null outside the desktop app. Every
 * caller degrades rather than failing: Settings must render with the bridge
 * absent, and an absent bridge is not a claim about anyone's server.
 */
function connectedSourcesBridge(): ElectronConnectedSourcesApi | null {
  if (typeof window === 'undefined') return null;
  return window.electron?.connectedSources ?? null;
}

/** Observation ages drift while Settings stays open, so they are re-read. */
export const CONNECTED_SOURCE_STATUS_INTERVAL_MS = 15_000;

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

const UNOBSERVED_STATUS: ConnectionStatus = {
  state: 'unavailable',
  observationAgeMs: null,
  stalePresentation: true,
  failure: null,
};

export function connectionStatusOf(
  observation: ConnectedSourceObservation | undefined
): ConnectionStatus {
  return observation?.connection ?? UNOBSERVED_STATUS;
}

/**
 * The observation's age, in the vocabulary that already owns it. Asking
 * `describeConnectionStatus` for the freshness sentence rather than restating
 * `describeAge` here keeps one owner for the words: a reconnecting source and
 * a stale one report their age identically, because it is the same fact.
 */
export function describeObservationAge(status: ConnectionStatus): string {
  return describeConnectionStatus({
    state: 'stale',
    observationAgeMs: status.observationAgeMs,
    stalePresentation: true,
    failure: null,
  });
}

const PLACEMENT_LABELS: Readonly<Record<AgentSourcePlacement, string>> = {
  local: 'Local',
  'customer-hosted': 'Remote',
  'exawatt-hosted': 'Exawatt Cloud',
};

const PLACEMENT_DETAILS: Readonly<Record<AgentSourcePlacement, string>> = {
  local: 'The Gateway runs on this machine.',
  'customer-hosted': 'The Gateway runs on a server you operate.',
  'exawatt-hosted': 'The Gateway runs on infrastructure Exawatt operates.',
};

/**
 * Placement is infrastructure metadata, so it carries its own glyph and the
 * quiet text roles. It never borrows a status color: a Remote source is not a
 * warning, and a Local one is not a success.
 */
function PlacementGlyph({ placement }: { placement: AgentSourcePlacement }) {
  const size = 14;
  if (placement === 'local') return <Monitor aria-hidden size={size} />;
  if (placement === 'exawatt-hosted') return <Cloud aria-hidden size={size} />;
  return <Server aria-hidden size={size} />;
}

/**
 * The sentence under the Connection fact when the bridge sends none.
 *
 * One per state, because the previous two-way fallback keyed on
 * `stalePresentation` and told an operator watching a RECONNECTING source
 * that Exawatt was "receiving current snapshots" — a false freshness claim on
 * the surface whose job is freshness truth. None of these may say the Gateway
 * stopped; losing sight of a server is a fact about Exawatt.
 */
const CONNECTION_FALLBACK_DETAIL: Readonly<
  Record<SourceConnectionState, string>
> = {
  live: 'Exawatt is receiving current snapshots.',
  reconnecting:
    'Exawatt is reopening the connection. The Gateway keeps working meanwhile.',
  stale:
    'Last-known content, not a current report. The Gateway keeps working whether or not Exawatt is watching.',
  unavailable:
    'Last-known content, not a current report. The Gateway keeps working whether or not Exawatt is watching.',
};

/**
 * Connection ink, and it never borrows work state's.
 *
 * `--settings-red` resolves to the D40 fault role, which means this Agent's
 * own work failed or needs a person. A server Exawatt cannot currently see is
 * not that: the coworker on it may be working perfectly, and Exawatt is the
 * one that lost the thread. So an unavailable connection wears the chrome
 * attention role, which is what the remote coworker surface already uses for
 * the same fact, and the two surfaces say the same thing about it.
 */
const CONNECTION_TONE: Readonly<Record<SourceConnectionState, string>> = {
  live: 'var(--settings-teal)',
  reconnecting: 'var(--settings-amber)',
  stale: 'var(--settings-dim)',
  unavailable: 'var(--settings-amber)',
};

const CONNECTION_WASH: Readonly<Record<SourceConnectionState, string>> = {
  live: 'var(--settings-teal-wash)',
  reconnecting: 'var(--settings-amber-wash)',
  stale: 'color-mix(in srgb, var(--settings-dim) 8%, transparent)',
  unavailable: 'var(--settings-amber-wash)',
};

/** Shape, icon, and text all carry the state; hue is never alone (D30). */
function ConnectionGlyph({ state }: { state: SourceConnectionState }) {
  const color = CONNECTION_TONE[state];
  if (state === 'live') {
    return (
      <span
        className="flex size-5 items-center justify-center rounded-full border"
        style={{ color, borderColor: color }}
      >
        <Check aria-hidden size={12} strokeWidth={2.4} />
      </span>
    );
  }
  if (state === 'reconnecting') {
    return (
      <LoaderCircle
        aria-hidden
        size={20}
        className="animate-spin motion-reduce:animate-none"
        style={{ color }}
      />
    );
  }
  if (state === 'stale') {
    return <History aria-hidden size={20} style={{ color }} />;
  }
  return <WifiOff aria-hidden size={20} style={{ color }} />;
}

function ConnectionPill({ status }: { status: ConnectionStatus }) {
  const color = CONNECTION_TONE[status.state];
  return (
    <span
      data-connection-pill={status.state}
      className="inline-flex min-h-7 items-center gap-2 rounded-full border px-2.5 font-ui text-chrome-label font-medium"
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} 34%, transparent)`,
        background: CONNECTION_WASH[status.state],
      }}
    >
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {describeConnectionStatus(status)}
    </span>
  );
}

function AdapterMark({
  id,
  size = 19,
}: {
  id: AgentSourceAdapterId;
  size?: number;
}) {
  if (id === 'claude') return <ClaudeIcon size={size} />;
  if (id === 'codex') return <OpenAIIcon size={size} />;
  if (id === 'opencode') return <OpenCodeIcon size={size} />;
  if (id === 'openclaw') return <OpenClawIcon size={size} />;
  return <Sparkles aria-hidden size={size} />;
}

const BASIS_LABELS: Readonly<Record<AgentSourceEvidenceBasis, string>> = {
  observed: 'Observed',
  declared: 'Declared',
  simulated: 'Simulated',
};

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

function FactLine({
  label,
  value,
  detail,
  meta,
  glyph,
  tone,
  testState,
}: {
  label: string;
  value: string;
  detail?: string;
  meta?: string;
  glyph?: ReactNode;
  /** Only connection facts pass a tone. Everything else stays quiet. */
  tone?: string;
  testState?: string;
}) {
  return (
    <div
      data-connected-fact={label}
      data-connected-fact-state={testState}
      className="grid min-h-[66px] grid-cols-[minmax(112px,0.62fr)_minmax(0,1.38fr)] items-center gap-5 border-t border-[var(--settings-line)] py-3 max-[520px]:grid-cols-1 max-[520px]:gap-1.5"
    >
      <span className="font-ui text-chrome-title text-[var(--settings-dim)]">
        {label}
      </span>
      <span className="min-w-0">
        <span
          className="flex min-w-0 items-center gap-1.5 font-ui text-sm font-medium"
          style={{ color: tone ?? 'var(--settings-soft)' }}
        >
          {glyph ? (
            <span className="flex shrink-0 items-center text-[var(--settings-faint)]">
              {glyph}
            </span>
          ) : null}
          <span className="min-w-0 truncate">{value}</span>
        </span>
        {detail ? (
          <span className="mt-0.5 block font-ui text-chrome-label leading-4.5 text-[var(--settings-dim)]">
            {detail}
          </span>
        ) : null}
        {meta ? (
          <span className="mt-0.5 block font-ui text-chrome-label text-[var(--settings-faint)]">
            {meta}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function SectionHeading({ id, children }: { id: string; children: string }) {
  return (
    <h3
      id={id}
      className="mb-3 font-display text-reading font-semibold text-[var(--settings-text)]"
    >
      {children}
    </h3>
  );
}

/**
 * Where a value came from, or what has to happen before there is one.
 *
 * The absent sentence is written for the operator: it says what Exawatt will
 * do, not what kind of check it runs. "A bounded check on the Gateway" is a
 * phrase from an engineering doc, and an operator reading a row that has no
 * value needs to know it fills itself in, not what the protocol calls it.
 */
function evidenceMeta(fact: ObservedFact | null | undefined): string {
  if (!fact) return 'Exawatt reads this the next time it connects.';
  return fact.provenance
    ? `${BASIS_LABELS[fact.basis]} · ${fact.provenance}`
    : BASIS_LABELS[fact.basis];
}

/* ------------------------------------------------------------------ */
/* Hook                                                                */
/* ------------------------------------------------------------------ */

export interface ConnectedSourcesState {
  /** The desktop bridge is present. Absent means this is not the app. */
  available: boolean;
  sources: ConnectedSourceView[];
  observations: Map<string, ConnectedSourceObservation>;
  busyId: string | null;
  message: { ok: boolean; text: string } | null;
  reconnect: (id: string) => Promise<void>;
  rename: (id: string, displayName: string) => Promise<void>;
  detach: (id: string) => Promise<void>;
}

export function useConnectedSources(): ConnectedSourcesState {
  const [available] = useState(() => connectedSourcesBridge() !== null);
  const [sources, setSources] = useState<ConnectedSourceView[]>([]);
  const [observations, setObservations] = useState<
    Map<string, ConnectedSourceObservation>
  >(() => new Map());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const readStatus = useCallback(async () => {
    const api = connectedSourcesBridge();
    if (!api) return;
    try {
      const rows = await api.status();
      if (!mounted.current) return;
      setObservations(new Map(rows.map(row => [row.sourceId, row])));
    } catch {
      // A failed status read is not evidence about the server. The last
      // observation stands, already marked with its own age.
    }
  }, []);

  const readList = useCallback(async () => {
    const api = connectedSourcesBridge();
    if (!api) return;
    try {
      const rows = await api.list();
      if (!mounted.current) return;
      setSources(rows);
    } catch {
      if (!mounted.current) return;
      setMessage({
        ok: false,
        text: 'Exawatt could not read its connection records.',
      });
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await readList();
      await readStatus();
    })();
  }, [readList, readStatus]);

  /**
   * The records this surface has seen, read from inside a subscription that
   * outlives any one of them.
   */
  const knownIds = useRef<ReadonlySet<string>>(new Set());
  knownIds.current = useMemo(
    () => new Set(sources.map(source => source.id)),
    [sources]
  );

  /**
   * Two inputs, because they answer different questions. The bridge's own
   * change tick says a source moved, so freshness follows the source rather
   * than a clock; the interval only keeps the displayed age from drifting
   * while nothing moves and Settings stays open.
   */
  useEffect(() => {
    if (!available) return;
    const api = connectedSourcesBridge();
    const stop =
      typeof api?.onChanged === 'function'
        ? api.onChanged(change => {
            void readStatus();
            // A source this surface has never listed just moved, which is what
            // connecting one from here looks like from this side. Settings is
            // the page the operator is standing on while it happens, so the
            // rail picks it up rather than waiting to be reopened.
            if (!knownIds.current.has(change.sourceId)) void readList();
          })
        : null;
    const timer = window.setInterval(() => {
      void readStatus();
    }, CONNECTED_SOURCE_STATUS_INTERVAL_MS);
    return () => {
      stop?.();
      window.clearInterval(timer);
    };
  }, [available, readList, readStatus]);

  const reconnect = useCallback(
    async (id: string) => {
      const api = connectedSourcesBridge();
      if (!api) return;
      setBusyId(id);
      setMessage(null);
      try {
        const result = await api.connect(id);
        if (!mounted.current) return;
        setMessage(
          result.ok
            ? { ok: true, text: 'Exawatt is observing this source again.' }
            : { ok: false, text: result.message }
        );
      } catch {
        if (!mounted.current) return;
        setMessage({
          ok: false,
          text: 'Exawatt could not reach this source. Its work is unaffected.',
        });
      } finally {
        if (mounted.current) setBusyId(null);
      }
      await readStatus();
    },
    [readStatus]
  );

  const rename = useCallback(
    async (id: string, displayName: string) => {
      const api = connectedSourcesBridge();
      if (!api) return;
      const next = displayName.trim();
      if (!next) return;
      setBusyId(id);
      setMessage(null);
      try {
        const result = await api.rename(id, next);
        if (!mounted.current) return;
        if (!result.ok) {
          setMessage({ ok: false, text: 'That name could not be saved.' });
        }
      } catch {
        if (!mounted.current) return;
        setMessage({ ok: false, text: 'That name could not be saved.' });
      } finally {
        if (mounted.current) setBusyId(null);
      }
      await readList();
    },
    [readList]
  );

  const detach = useCallback(
    async (id: string) => {
      const api = connectedSourcesBridge();
      if (!api) return;
      setBusyId(id);
      setMessage(null);
      try {
        const result = await api.detach(id);
        if (!mounted.current) return;
        setMessage(
          result.ok
            ? {
                ok: true,
                text: 'Detached. The record and its stored credential are gone from Exawatt.',
              }
            : {
                ok: false,
                text: 'That connection record could not be removed.',
              }
        );
      } catch {
        if (!mounted.current) return;
        setMessage({
          ok: false,
          text: 'That connection record could not be removed.',
        });
      } finally {
        if (mounted.current) setBusyId(null);
      }
      await readList();
      await readStatus();
    },
    [readList, readStatus]
  );

  return useMemo(
    () => ({
      available,
      sources,
      observations,
      busyId,
      message,
      reconnect,
      rename,
      detach,
    }),
    [
      available,
      sources,
      observations,
      busyId,
      message,
      reconnect,
      rename,
      detach,
    ]
  );
}

/* ------------------------------------------------------------------ */
/* Rail                                                                */
/* ------------------------------------------------------------------ */

/**
 * The registry rail's second group. Configured connections sit beside the
 * auto-discovered adapters because they answer the same question the rail
 * exists for: which source am I looking at.
 */
export function ConnectedSourcesRail({
  sources,
  observations,
  selectedId,
  onSelect,
  onConnect,
}: {
  sources: ConnectedSourceView[];
  observations: Map<string, ConnectedSourceObservation>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Opens the Connect existing Agent route. The host owns the dialog. */
  onConnect?: () => void;
}) {
  return (
    <section
      aria-labelledby="connected-sources-heading"
      data-connected-sources-rail
      className="border-t border-[var(--settings-line)] p-2"
    >
      <div className="flex min-h-9 items-center justify-between px-3">
        <h3
          id="connected-sources-heading"
          className="font-ui text-chrome-label font-medium text-[var(--settings-dim)]"
        >
          Connected sources
        </h3>
        {sources.length > 0 && (
          <span className="font-mono text-chrome-label text-[var(--settings-faint)]">
            {sources.length}
          </span>
        )}
      </div>
      {sources.length === 0 ? (
        <ConnectedSourcesEmpty onConnect={onConnect} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1">
          {sources.map(source => {
            const declaration = agentSourceDeclaration(source.adapterId);
            const status = connectionStatusOf(observations.get(source.id));
            const active = selectedId === source.id;
            return (
              <button
                key={source.id}
                type="button"
                onClick={() => onSelect(source.id)}
                aria-pressed={active}
                aria-label={`${source.displayName}, ${declaration.label}, ${PLACEMENT_LABELS[source.placement]}, ${describeConnectionStatus(status)}`}
                className="group relative flex min-h-[70px] min-w-0 items-center gap-3 rounded-lg border px-3 text-left outline-none transition-[background-color,border-color] duration-150 hover:bg-[var(--settings-hover)] focus-visible:ring-2 focus-visible:ring-[var(--settings-teal)] motion-reduce:transition-none"
                style={{
                  background: active
                    ? 'var(--settings-selected)'
                    : 'transparent',
                  borderColor: active
                    ? 'var(--settings-line-strong)'
                    : 'transparent',
                }}
              >
                <SourceIdentityMark
                  className="size-9 rounded-lg"
                  color={declaration.color}
                >
                  <AdapterMark id={source.adapterId} />
                </SourceIdentityMark>
                <span className="min-w-0 flex-1">
                  <span
                    className="block truncate font-ui text-sm font-medium"
                    style={{
                      color: active
                        ? 'var(--settings-text)'
                        : 'var(--settings-soft)',
                    }}
                  >
                    {source.displayName}
                  </span>
                  <span className="mt-0.5 flex min-w-0 items-center gap-1 font-ui text-chrome-label text-[var(--settings-dim)]">
                    <PlacementGlyph placement={source.placement} />
                    <span className="truncate">
                      {declaration.label} · {PLACEMENT_LABELS[source.placement]}
                    </span>
                  </span>
                </span>
                {/* Connection state at every width. Hiding it under `lg`
                    left a narrow window with no channel for the one fact
                    this list exists to carry. */}
                <span className="shrink-0">
                  <ConnectionGlyph state={status.state} />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * Nothing connected. One route out, and no invented roster standing in for a
 * server the operator has not connected.
 */
function ConnectedSourcesEmpty({ onConnect }: { onConnect?: () => void }) {
  return (
    <div
      data-connected-sources-empty
      className="px-3 py-2.5 font-ui text-chrome-label leading-4.5 text-[var(--settings-dim)]"
    >
      <p>Gateways you connect appear here with their own health.</p>
      {/* A route, or nothing. Naming a chord here was navigation the operator
          could read and not take: this empty state is exactly where somebody
          with no sources arrives, and the one thing it owes them is the way
          in. The host always passes one; a surface that cannot connect says
          less rather than pointing at a keystroke. */}
      {onConnect ? (
        <button
          type="button"
          onClick={onConnect}
          className="mt-2 flex min-h-9 w-full items-center justify-center gap-2 rounded-lg border border-[var(--settings-line-strong)] bg-[var(--settings-raised)] px-3 font-ui text-chrome-title font-medium text-[var(--settings-soft)] outline-none transition-colors hover:bg-[var(--settings-hover-strong)] focus-visible:ring-2 focus-visible:ring-[var(--settings-teal)]"
        >
          Connect existing Agent
        </button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Detail                                                              */
/* ------------------------------------------------------------------ */

export function ConnectedSourceDetail({
  source,
  observation,
  busy,
  message,
  onReconnect,
  onRename,
  onDetach,
}: {
  source: ConnectedSourceView;
  observation: ConnectedSourceObservation | undefined;
  busy: boolean;
  message: { ok: boolean; text: string } | null;
  onReconnect: () => void;
  onRename: (displayName: string) => void;
  onDetach: () => void;
}) {
  const declaration = agentSourceDeclaration(source.adapterId);
  const status = connectionStatusOf(observation);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(source.displayName);
  const [confirmingDetach, setConfirmingDetach] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRenaming(false);
    setConfirmingDetach(false);
    setDraftName(source.displayName);
  }, [source.id, source.displayName]);

  useEffect(() => {
    if (renaming) nameInput.current?.select();
  }, [renaming]);

  const commitRename = useCallback(() => {
    const next = draftName.trim();
    setRenaming(false);
    if (!next || next === source.displayName) {
      setDraftName(source.displayName);
      return;
    }
    onRename(next);
  }, [draftName, onRename, source.displayName]);

  const capabilities = observation?.capabilities ?? [];

  return (
    <article
      data-connected-source={source.id}
      className="min-w-0 px-5 py-5 sm:px-7 sm:py-7 xl:px-9"
    >
      <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <SourceIdentityMark
            className="size-11 rounded-lg"
            color={declaration.color}
          >
            <AdapterMark id={source.adapterId} size={22} />
          </SourceIdentityMark>
          <div className="min-w-0">
            <p className="truncate font-ui text-chrome-title text-[var(--settings-dim)]">
              {declaration.label} · {PLACEMENT_LABELS[source.placement]}
            </p>
            {renaming ? (
              <form
                className="mt-1 flex items-center gap-2"
                onSubmit={event => {
                  event.preventDefault();
                  commitRename();
                }}
              >
                <input
                  ref={nameInput}
                  aria-label="Connection name"
                  value={draftName}
                  onChange={event => setDraftName(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      setDraftName(source.displayName);
                      setRenaming(false);
                    }
                  }}
                  className="min-w-0 flex-1 rounded-md border border-[var(--settings-line-strong)] bg-[var(--settings-raised)] px-2 py-1 font-display text-display font-semibold tracking-[-0.02em] text-[var(--settings-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--settings-teal)]"
                />
                <Button type="submit" size="sm">
                  Save
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDraftName(source.displayName);
                    setRenaming(false);
                  }}
                >
                  Cancel
                </Button>
              </form>
            ) : (
              <h2 className="truncate font-display text-display font-semibold tracking-[-0.02em] text-[var(--settings-text)]">
                {source.displayName}
              </h2>
            )}
          </div>
        </div>
        <ConnectionPill status={status} />
      </header>

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onReconnect}
          className="flex min-h-10 items-center gap-2 rounded-lg border border-[var(--settings-line-strong)] bg-[var(--settings-raised)] px-3.5 font-ui text-chrome-title font-medium text-[var(--settings-soft)] outline-none transition-[background-color,transform] hover:bg-[var(--settings-hover-strong)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--settings-teal)] motion-reduce:transition-none"
        >
          <RefreshCw
            aria-hidden
            size={15}
            className={busy ? 'animate-spin motion-reduce:animate-none' : ''}
          />
          Reconnect
        </button>
        <button
          type="button"
          disabled={busy || renaming}
          onClick={() => setRenaming(true)}
          className="flex min-h-10 items-center gap-2 rounded-lg border border-[var(--settings-line-strong)] bg-[var(--settings-raised)] px-3.5 font-ui text-chrome-title font-medium text-[var(--settings-soft)] outline-none transition-[background-color,transform] hover:bg-[var(--settings-hover-strong)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--settings-teal)] motion-reduce:transition-none"
        >
          <Pencil aria-hidden size={15} />
          Rename
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirmingDetach(true)}
          className="flex min-h-10 items-center gap-2 rounded-lg border px-3.5 font-ui text-chrome-title font-medium outline-none transition-[background-color,transform] hover:bg-[var(--settings-hover-strong)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--settings-red)] motion-reduce:transition-none"
          style={{
            color: 'var(--settings-red)',
            borderColor:
              'color-mix(in srgb, var(--settings-red) 40%, transparent)',
          }}
        >
          <Unplug aria-hidden size={15} />
          Detach
        </button>
      </div>

      <p className="mt-3 max-w-[68ch] font-ui text-chrome-label leading-4.5 text-[var(--settings-faint)]">
        Reconnect repairs Exawatt&apos;s observation. It does not start, resume,
        or change anything on the Gateway.
      </p>

      {message && (
        <p
          role="status"
          className="mt-3 max-w-xl font-ui text-chrome-label leading-5"
          style={{
            color: message.ok ? 'var(--settings-teal)' : 'var(--settings-red)',
          }}
        >
          {message.text}
        </p>
      )}

      <section className="mt-8" aria-labelledby="connection-facts-heading">
        <SectionHeading id="connection-facts-heading">
          Connection
        </SectionHeading>
        <FactLine
          label="Placement"
          value={PLACEMENT_LABELS[source.placement]}
          detail={PLACEMENT_DETAILS[source.placement]}
          glyph={<PlacementGlyph placement={source.placement} />}
          testState={source.placement}
        />
        <FactLine
          label="Connection"
          /* The state word comes from `describeConnectionStatus`, the one
             owner of this vocabulary, rather than from the view's own `label`,
             so a second producer can never disagree with it. The sentence
             beneath it is the bridge's when the bridge has one. */
          value={describeConnectionStatus(status)}
          detail={
            observation?.connection.detail?.trim() ||
            CONNECTION_FALLBACK_DETAIL[status.state]
          }
          tone={CONNECTION_TONE[status.state]}
          testState={status.state}
        />
        <FactLine
          label="Last snapshot"
          value={describeObservationAge(status)}
          detail={
            status.observationAgeMs === null
              ? 'Exawatt has not received a snapshot from this source yet.'
              : 'When Exawatt last received authoritative state from this source.'
          }
          glyph={<History aria-hidden size={14} />}
        />
      </section>

      <section className="mt-8" aria-labelledby="connection-custody-heading">
        <SectionHeading id="connection-custody-heading">
          Credentials
        </SectionHeading>
        <p className="mb-3 max-w-[68ch] font-ui text-chrome-label leading-4.5 text-[var(--settings-dim)]">
          The Gateway&apos;s own secret is never stored. Exawatt reads it once
          to pair a device, then keeps only the read-only device credential,
          which you can revoke on the server at any time.
        </p>
        {source.credentialOwner === 'source-owned-ssh' ? (
          <FactLine
            label="Server access"
            value="Your own SSH configuration"
            detail={
              source.alias
                ? `Exawatt reaches this Gateway through the SSH host alias "${source.alias}" already on this machine. It holds no access material of its own.`
                : 'Exawatt reaches this Gateway through the SSH setup already on this machine. It holds no access material of its own.'
            }
            glyph={<KeyRound aria-hidden size={14} />}
            testState="source-owned-ssh"
          />
        ) : (
          <FactLine
            label="Server access"
            value="Held by Exawatt in the OS keychain"
            detail="You entered the access material when you connected, and Exawatt keeps it in this machine's keychain rather than in its own files."
            glyph={<KeyRound aria-hidden size={14} />}
            testState="exawatt-keychain"
          />
        )}
        <FactLine
          label="Device credential"
          value={
            source.hasDeviceCredential
              ? 'Read-only device credential in the OS keychain'
              : 'Not paired yet'
          }
          detail={
            source.hasDeviceCredential
              ? 'Scoped to reading only. The Gateway lists it beside your own devices and can revoke it there.'
              : 'Exawatt pairs a read-only device credential the first time it reaches this Gateway.'
          }
          glyph={<KeyRound aria-hidden size={14} />}
          testState={
            source.hasDeviceCredential ? 'device-paired' : 'device-unpaired'
          }
        />
      </section>

      <section className="mt-8 pb-6" aria-labelledby="connection-build-heading">
        <SectionHeading id="connection-build-heading">
          Version and capabilities
        </SectionHeading>
        <FactLine
          label="Version"
          value={observation?.version?.value ?? 'Not observed yet'}
          meta={evidenceMeta(observation?.version)}
        />
        {capabilities.length === 0 ? (
          <FactLine
            label="Capabilities"
            value="Not observed yet"
            meta={evidenceMeta(null)}
          />
        ) : (
          capabilities.map(capability => (
            <FactLine
              key={capability.label}
              label={capability.label}
              value={capability.value}
              meta={evidenceMeta(capability)}
            />
          ))
        )}
      </section>

      <DetachConfirm
        open={confirmingDetach}
        name={source.displayName}
        sourceLabel={declaration.label}
        busy={busy}
        onOpenChange={setConfirmingDetach}
        onConfirm={() => {
          setConfirmingDetach(false);
          onDetach();
        }}
      />
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Detach confirmation                                                 */
/* ------------------------------------------------------------------ */

/**
 * Detach is a two-way door and the copy has to prove it. The dialog names
 * what leaves Exawatt first and what stays on the server second, as two
 * labelled lists rather than one sentence a reader can skim past.
 *
 * macOS button semantics, through the repo's own dialog contract: Cancel sits
 * to the left and the declared primary action is the footer's last child, so
 * it is rightmost and prints the chord that presses it on its own face.
 */
export function DetachConfirm({
  open,
  name,
  sourceLabel,
  busy,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  name: string;
  sourceLabel: string;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        primaryAction={{
          label: 'Detach',
          run: onConfirm,
          destructive: true,
          disabled: busy,
        }}
      >
        <DialogHeader>
          <DialogTitle>Detach {name}?</DialogTitle>
          <DialogDescription>
            Detaching changes Exawatt only. The Gateway is not contacted, and
            nothing on it changes.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <p className="font-medium">Exawatt gives up</p>
            <ul className="text-muted-foreground mt-1.5 list-disc space-y-1 pl-4">
              <li>Its record of this connection</li>
              <li>The read-only device credential it stored for it</li>
            </ul>
          </div>
          <div>
            <p className="font-medium">The Gateway keeps</p>
            <ul className="text-muted-foreground mt-1.5 list-disc space-y-1 pl-4">
              <li>The {sourceLabel} installation and its configuration</li>
              <li>Its Agents, workspaces, conversation history, and results</li>
              <li>Its automations and their schedules</li>
              <li>
                Its own credentials, including the Gateway secret Exawatt never
                stored
              </li>
            </ul>
          </div>
        </div>

        <p className="text-muted-foreground text-sm">
          Work already running there continues, and you can connect to it again
          whenever you want.
        </p>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  AGENT_PROJECTION_VERSION,
  describeConnectionStatus,
  projectAgentTopology,
  resolveConnectionStatus,
  sourceAgentKey,
  type AgentProjectionMapping,
  type AgentSourceAdapterId,
  type AgentStatus,
  type AgentSourcePlacement,
  type AgentSourceTopologySnapshot,
  type ConnectedSourceRecord,
  type ProjectedAgent,
  type SourceAgentDiscoveryState,
  type SourceConnectionState,
  type SourceContextRecord,
  type SourceFailureClass,
} from '@exawatt/core';
import type {
  ConnectedGatewayPhase,
  ConnectedGatewaySession,
} from './connected-gateway';
import type { ConnectedSourceStore } from './connected-source-store';

/**
 * The main-process owner of every configured Agent Source (ENG-010 C2).
 *
 * `ConnectedGatewaySession` owns one source's transport, credential custody,
 * and authoritative snapshot. This runtime owns the layer above it: which
 * sources are being observed at all, which native Agent is which Exawatt
 * coworker, and what the renderer is told when any of that moves.
 *
 * Five rules shape the file.
 *
 * 1. **Nothing connects on its own.** Opening a session reaches someone's
 *    server, so it follows an operator act (`connect`) or the reconnect of a
 *    source the operator already authorized by pairing a device credential
 *    (`observeSavedSources`). Constructing this object contacts nothing.
 * 2. **The projection plan is Exawatt's, not the source's.** Which coworker
 *    lands in which Project, and under what name, is persisted here and edited
 *    here. `mapAgents` performs no Gateway call of any kind: renaming a
 *    coworker or moving it between Projects must be invisible to the server.
 * 3. **Freshness is not work state.** Every status this file produces
 *    describes Exawatt's own observation. None of it may say, or let a caller
 *    infer, that remote work stopped, paused, or was lost.
 * 4. **Change notifications carry no payload.** The renderer is told which
 *    source moved, how fresh it is, and whether a new authoritative snapshot
 *    replaced the last one. It then pulls what it wants. A tick must not cost
 *    a full topology serialization across the IPC boundary.
 * 5. **Quitting detaches observation, never execution.** `dispose` closes
 *    every session exactly once and leaves every remote installation, Agent,
 *    context, automation, and credential exactly as it found them.
 *
 * Every dependency is injected, so the tests never open a socket, never read
 * the operator's SSH configuration, and never touch `userData`.
 */

/* ---- Projection plan ----------------------------------------------------- */

/**
 * One native Agent's place in Exawatt.
 *
 * `projectLabel` rides alongside the kernel's mapping rather than inside it:
 * `AgentProjectionMapping` is the C0 contract and owns identity, not display
 * text. The label is what the Connect flow's Project step chose, kept so the
 * roster can name a Project that the local workspace catalog has never heard
 * of.
 */
export interface ConnectedAgentMapping extends AgentProjectionMapping {
  projectLabel: string;
}

export interface ConnectedAgentProjectionPlan {
  projectionVersion: typeof AGENT_PROJECTION_VERSION;
  mappings: readonly ConnectedAgentMapping[];
}

export interface ConnectedAgentProjectionPlanStore {
  read(): ConnectedAgentProjectionPlan;
  write(plan: ConnectedAgentProjectionPlan): void;
}

const PLAN_FILE = 'connected-agent-projection.json';
const PLAN_SCHEMA_VERSION = 1;
/** A registry of coworkers, not a data store. */
const MAX_MAPPINGS = 2_000;
const MAX_TEXT_LENGTH = 512;
const MAX_ID_LENGTH = 4_096;

function validText(value: unknown, max = MAX_TEXT_LENGTH): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

export const EMPTY_PROJECTION_PLAN: ConnectedAgentProjectionPlan = {
  projectionVersion: AGENT_PROJECTION_VERSION,
  mappings: [],
};

/**
 * Parse one persisted mapping. Fails closed per row: a hand-edited or
 * partially written file must cost the operator the coworkers it corrupted,
 * never the whole roster.
 */
function parseMapping(value: unknown): ConnectedAgentMapping | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    !validText(candidate.configuredSourceId, MAX_ID_LENGTH) ||
    !validText(candidate.nativeAgentId, MAX_ID_LENGTH) ||
    !validText(candidate.exawattAgentId, MAX_ID_LENGTH) ||
    !validText(candidate.projectId, MAX_ID_LENGTH)
  ) {
    return null;
  }
  const override = candidate.displayNameOverride;
  if (override !== null && !validText(override)) return null;
  return {
    configuredSourceId: candidate.configuredSourceId,
    nativeAgentId: candidate.nativeAgentId,
    exawattAgentId: candidate.exawattAgentId,
    projectId: candidate.projectId,
    displayNameOverride: override === null ? null : (override as string),
    projectLabel: validText(candidate.projectLabel)
      ? candidate.projectLabel
      : candidate.projectId,
  };
}

/**
 * The plan on disk. Deliberately its own file rather than a field on the
 * source registry: a source is a connection and a plan is a set of product
 * decisions about people, and detaching one source must never rewrite the
 * mapping of another.
 */
export class FileConnectedAgentProjectionPlanStore implements ConnectedAgentProjectionPlanStore {
  private readonly file: string;

  constructor(userDataDir: string) {
    this.file = path.join(userDataDir, PLAN_FILE);
  }

  read(): ConnectedAgentProjectionPlan {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as unknown;
    } catch {
      // Missing or corrupt is an empty plan, never a crash on boot.
      return EMPTY_PROJECTION_PLAN;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return EMPTY_PROJECTION_PLAN;
    }
    const rows = (parsed as { mappings?: unknown }).mappings;
    if (!Array.isArray(rows)) return EMPTY_PROJECTION_PLAN;
    return {
      projectionVersion: AGENT_PROJECTION_VERSION,
      mappings: normalizeMappings(rows.slice(0, MAX_MAPPINGS)),
    };
  }

  write(plan: ConnectedAgentProjectionPlan): void {
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    const temp = path.join(dir, `.${PLAN_FILE}.${randomUUID()}.tmp`);
    fs.writeFileSync(
      temp,
      JSON.stringify(
        {
          schemaVersion: PLAN_SCHEMA_VERSION,
          projectionVersion: AGENT_PROJECTION_VERSION,
          mappings: plan.mappings,
        },
        null,
        2
      ),
      { mode: 0o600 }
    );
    fs.renameSync(temp, this.file);
  }
}

/**
 * Drop unreadable rows, then drop collisions. Two mappings for one native
 * Agent, or two coworkers claiming one Exawatt Agent id, are fatal to the
 * kernel; resolving them here keeps a bad row from taking the roster with it.
 */
function normalizeMappings(
  rows: readonly unknown[]
): readonly ConnectedAgentMapping[] {
  const bySourceAgent = new Map<string, ConnectedAgentMapping>();
  const claimedIds = new Set<string>();
  for (const row of rows) {
    const mapping = parseMapping(row);
    if (!mapping) continue;
    const key = sourceAgentKey(mapping);
    if (bySourceAgent.has(key)) continue;
    if (claimedIds.has(mapping.exawattAgentId)) continue;
    claimedIds.add(mapping.exawattAgentId);
    bySourceAgent.set(key, mapping);
  }
  return [...bySourceAgent.values()];
}

/**
 * Exawatt's own id for a source-native Agent.
 *
 * Derived, not random, so a reconnect, a relaunch, or a reinstall that
 * rebuilds a plan from the same source produces the same coworker rather than
 * a duplicate. It is a digest of the source-qualified key, so it carries no
 * hostname, alias, or native name, and it is safe in a URL.
 */
export function deriveRemoteAgentId(
  configuredSourceId: string,
  nativeAgentId: string
): string {
  const digest = createHash('sha256')
    .update(sourceAgentKey({ configuredSourceId, nativeAgentId }))
    .digest('hex');
  return `remote-${digest.slice(0, 24)}`;
}

/* ---- Renderer-facing views ----------------------------------------------- */

/**
 * The short freshness labels the design system names. `describeConnectionStatus`
 * answers with an observation age for `stale`, which is the right sentence for
 * a detail surface and the wrong one for a roster chip, so both travel.
 */
export const CONNECTION_STATE_LABELS: Readonly<
  Record<SourceConnectionState, string>
> = {
  live: 'Live',
  reconnecting: 'Reconnecting',
  stale: 'Stale',
  unavailable: 'Unavailable',
};

/** Quiet placement metadata. Never a status, never a Project identity. */
export const PLACEMENT_LABELS: Readonly<Record<AgentSourcePlacement, string>> =
  {
    local: 'Local',
    'customer-hosted': 'Remote',
    'exawatt-hosted': 'Exawatt Cloud',
  };

export interface SourceConnectionView {
  state: SourceConnectionState;
  /** `Live` | `Reconnecting` | `Stale` | `Unavailable`. */
  label: string;
  /** Longer sentence for detail surfaces; still only about observation. */
  detail: string;
  observationAgeMs: number | null;
  stalePresentation: boolean;
  failure: SourceFailureClass | null;
}

export interface ConnectedSourceStatusView {
  sourceId: string;
  displayName: string;
  adapterId: AgentSourceAdapterId;
  placement: AgentSourcePlacement;
  placementLabel: string;
  /** True once this launch opened a session for the source. */
  observing: boolean;
  phase: ConnectedGatewayPhase;
  connection: SourceConnectionView;
  /** The source now reports a different installation than the plan maps. */
  identityDrift: boolean;
  /** Bumped only by an authoritative snapshot. */
  snapshotRevision: number;
}

/** What the Connect dialog's discovery step chooses from. */
export interface DiscoveredSourceAgent {
  nativeAgentId: string;
  displayName: string;
  discoveryState: SourceAgentDiscoveryState;
  contextCount: number;
  /** False means this Agent opens on its work, not on a fabricated Home. */
  hasPrimaryConversation: boolean;
  /** The saved mapping, when this Agent already has one. */
  mapping: {
    exawattAgentId: string;
    projectId: string;
    projectLabel: string;
    displayNameOverride: string | null;
  } | null;
}

/** One projected coworker, ready for the roster. */
export interface RemoteAgentView {
  id: string;
  displayName: string;
  projectId: string;
  projectLabel: string;
  discoveryState: SourceAgentDiscoveryState;
  placement: AgentSourcePlacement;
  placementLabel: string;
  adapterId: AgentSourceAdapterId;
  source: { id: string; displayName: string };
  nativeAgentId: string;
  /** The source-declared `main` context, or null when it declares none. */
  primaryContextId: string | null;
  /**
   * D40 work state, in the vocabulary a local Agent already uses.
   *
   * Observed at `observedAt` and nowhere else: a stale or unavailable
   * connection leaves this exactly as it was last observed, and `connection`
   * is what tells the operator the view is not current. Nothing in this field
   * may move because observation moved.
   */
  workState: AgentStatus;
  contextCount: number;
  observedAt: number;
  createdAt: number;
  lastActiveAt: number;
  connection: SourceConnectionView;
  projectionVersion: typeof AGENT_PROJECTION_VERSION;
}

export type ConnectSourceResult =
  | {
      ok: true;
      sourceId: string;
      agents: readonly DiscoveredSourceAgent[];
      status: ConnectedSourceStatusView;
    }
  | {
      ok: false;
      sourceId: string;
      outcome: 'unknown-source' | 'identity-drift' | 'failed';
      failure: SourceFailureClass | null;
      message: string;
    };

/** One Project/name decision the Connect flow collected. */
export interface AgentMappingInput {
  nativeAgentId: string;
  projectId: string;
  projectLabel?: string;
  displayNameOverride?: string | null;
}

export type MapAgentsResult =
  | { ok: true; mapped: number }
  | { ok: false; issues: readonly string[] };

export interface ConnectedSourceChange {
  sourceId: string;
  phase: ConnectedGatewayPhase;
  connection: SourceConnectionView;
  snapshotRevision: number;
}

/* ---- Runtime ------------------------------------------------------------- */

/**
 * Exactly what the runtime uses of a gateway session. Structural on purpose:
 * the test drives a hand-written double, so no test in this file can open a
 * tunnel, read an SSH configuration, or reach a network.
 */
export type ConnectedSourceSession = Pick<
  ConnectedGatewaySession,
  | 'connect'
  | 'resnapshot'
  | 'status'
  | 'disconnect'
  | 'onPhaseChange'
  | 'snapshot'
  | 'phase'
  | 'identityDrift'
>;

export interface ConnectedSourceRuntimeDeps {
  store: Pick<ConnectedSourceStore, 'list' | 'get'>;
  plans: ConnectedAgentProjectionPlanStore;
  createSession: (record: ConnectedSourceRecord) => ConnectedSourceSession;
  now: () => number;
}

interface SessionEntry {
  record: ConnectedSourceRecord;
  session: ConnectedSourceSession;
  snapshotRevision: number;
  offPhase: () => void;
  closed: boolean;
}

export class ConnectedSourceRuntime {
  private readonly deps: ConnectedSourceRuntimeDeps;
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly listeners = new Set<
    (change: ConnectedSourceChange) => void
  >();
  private resumeStarted = false;
  private disposed = false;

  constructor(deps: ConnectedSourceRuntimeDeps) {
    this.deps = deps;
  }

  onChange(listener: (change: ConnectedSourceChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Open a session for one saved source and report what it discovered.
   *
   * This is the operator act. It is the only entry point that may reach a
   * server the operator has not already paired with.
   */
  async connect(sourceId: string): Promise<ConnectSourceResult> {
    if (this.disposed) {
      return {
        ok: false,
        sourceId,
        outcome: 'failed',
        failure: 'unknown',
        message: 'Exawatt is shutting down.',
      };
    }
    const record = this.deps.store.get(sourceId);
    if (!record) {
      return {
        ok: false,
        sourceId,
        outcome: 'unknown-source',
        failure: null,
        message: 'That source is no longer configured.',
      };
    }

    const entry = this.ensureSession(record);
    const result = await entry.session.connect();
    if (this.disposed) {
      return {
        ok: false,
        sourceId,
        outcome: 'failed',
        failure: 'unknown',
        message: 'Exawatt is shutting down.',
      };
    }

    if (!result.ok) {
      this.emit(entry);
      return result.outcome === 'identity-drift'
        ? {
            ok: false,
            sourceId,
            outcome: 'identity-drift',
            failure: null,
            message: result.message,
          }
        : {
            ok: false,
            sourceId,
            outcome: 'failed',
            failure: result.failure,
            message: result.message,
          };
    }

    entry.snapshotRevision += 1;
    this.emit(entry);
    return {
      ok: true,
      sourceId,
      agents: describeDiscoveredAgents(result.snapshot, this.deps.plans.read()),
      status: this.statusFor(entry, record),
    };
  }

  /**
   * Reconnect the sources the operator already authorized.
   *
   * "Already authorized" is a fact on the record, not an assumption: a source
   * only holds a device credential because the operator completed a pairing
   * for it. A saved source without one is left alone, because reaching that
   * server would be Exawatt's decision rather than the operator's.
   *
   * Idempotent, and one source failing never blocks another.
   */
  async observeSavedSources(): Promise<void> {
    if (this.disposed || this.resumeStarted) return;
    this.resumeStarted = true;
    const records = this.deps.store
      .list()
      .filter(record => record.hasDeviceCredential);
    await Promise.allSettled(
      records.map(record => this.connect(record.id).catch(() => undefined))
    );
  }

  /** Per-source freshness, for Settings and the roster. */
  status(): ConnectedSourceStatusView[] {
    return this.deps.store
      .list()
      .map(record =>
        this.statusFor(this.sessions.get(record.id) ?? null, record)
      );
  }

  /**
   * The projected coworkers.
   *
   * Only mappings whose source has a snapshot in hand take part. The kernel
   * treats a mapping with no matching source Agent as a fatal topology error,
   * which is right for a snapshot that lost an Agent and wrong for a source
   * this launch has simply not opened yet; filtering keeps an unopened source
   * silent instead of emptying the whole roster.
   */
  agents(): RemoteAgentView[] {
    const snapshots: AgentSourceTopologySnapshot[] = [];
    const entries = new Map<string, SessionEntry>();
    for (const entry of this.sessions.values()) {
      const snapshot = entry.session.snapshot;
      if (!snapshot) continue;
      snapshots.push(snapshot);
      entries.set(snapshot.configuredSourceId, entry);
    }
    if (snapshots.length === 0) return [];

    const plan = this.deps.plans.read();
    const labels = new Map(
      plan.mappings.map(mapping => [
        mapping.exawattAgentId,
        mapping.projectLabel,
      ])
    );
    const mappings: AgentProjectionMapping[] = plan.mappings
      .filter(mapping => entries.has(mapping.configuredSourceId))
      .map(mapping => ({
        configuredSourceId: mapping.configuredSourceId,
        nativeAgentId: mapping.nativeAgentId,
        exawattAgentId: mapping.exawattAgentId,
        projectId: mapping.projectId,
        displayNameOverride: mapping.displayNameOverride,
      }));

    const projected = projectAgentTopology(snapshots, {
      projectionVersion: plan.projectionVersion,
      mappings,
    });
    if (!projected.ok) return [];

    const views: RemoteAgentView[] = [];
    for (const agent of projected.projection.agents) {
      const entry = entries.get(agent.configuredSourceId);
      if (!entry) continue;
      const snapshot = entry.session.snapshot;
      if (!snapshot) continue;
      views.push(
        toRemoteAgentView(
          agent,
          snapshot,
          entry.record,
          labels.get(agent.id) ?? agent.projectId,
          this.connectionFor(entry)
        )
      );
    }
    return views;
  }

  /**
   * Save where each discovered Agent belongs.
   *
   * A mapping edit is an Exawatt decision. Nothing here calls the Gateway, so
   * renaming a coworker or moving it between Projects cannot rename, move,
   * restart, or otherwise disturb anything on the server. The held snapshot is
   * not touched either: it is the source's truth, and this is Exawatt's.
   */
  mapAgents(
    sourceId: string,
    mappings: readonly AgentMappingInput[]
  ): MapAgentsResult {
    const record = this.deps.store.get(sourceId);
    if (!record)
      return { ok: false, issues: ['That source is not configured.'] };
    if (!Array.isArray(mappings)) {
      return { ok: false, issues: ['Mappings must be a list.'] };
    }
    if (mappings.length > MAX_MAPPINGS) {
      return { ok: false, issues: ['Too many mappings for one source.'] };
    }

    const issues: string[] = [];
    const plan = this.deps.plans.read();
    const existing = new Map(
      plan.mappings.map(mapping => [sourceAgentKey(mapping), mapping])
    );
    const next: ConnectedAgentMapping[] = [];
    const seen = new Set<string>();

    for (const input of mappings) {
      if (!input || typeof input !== 'object') {
        issues.push('Each mapping must be a record.');
        continue;
      }
      if (!validText(input.nativeAgentId, MAX_ID_LENGTH)) {
        issues.push('Each mapping needs the source Agent it maps.');
        continue;
      }
      if (!validText(input.projectId, MAX_ID_LENGTH)) {
        issues.push(`Choose a Project for ${input.nativeAgentId}.`);
        continue;
      }
      const override = input.displayNameOverride ?? null;
      if (override !== null && !validText(override)) {
        issues.push(`That name cannot be used for ${input.nativeAgentId}.`);
        continue;
      }
      const key = sourceAgentKey({
        configuredSourceId: sourceId,
        nativeAgentId: input.nativeAgentId,
      });
      if (seen.has(key)) {
        issues.push(`${input.nativeAgentId} was mapped twice.`);
        continue;
      }
      seen.add(key);
      next.push({
        configuredSourceId: sourceId,
        nativeAgentId: input.nativeAgentId,
        // A coworker keeps the id it already had. Reminting it on every edit
        // would make a Project change read downstream as a different person.
        exawattAgentId:
          existing.get(key)?.exawattAgentId ??
          deriveRemoteAgentId(sourceId, input.nativeAgentId),
        projectId: input.projectId,
        displayNameOverride: override,
        projectLabel: validText(input.projectLabel)
          ? input.projectLabel
          : input.projectId,
      });
    }

    if (issues.length > 0) return { ok: false, issues };

    // Replace this source's entries, leave every other source's alone.
    const others = plan.mappings.filter(
      mapping => mapping.configuredSourceId !== sourceId
    );
    this.deps.plans.write({
      projectionVersion: AGENT_PROJECTION_VERSION,
      mappings: [...others, ...next],
    });

    const entry = this.sessions.get(sourceId);
    if (entry) this.emit(entry);
    return { ok: true, mapped: next.length };
  }

  /**
   * Stop observing one source. The remote keeps working.
   *
   * The session object stays, holding its last authoritative snapshot, so the
   * coworkers remain in the roster as last-known with an honest freshness
   * signal instead of vanishing. Removing them is detach, and detach is the
   * registry's job.
   */
  async disconnect(sourceId: string): Promise<{ ok: boolean }> {
    const entry = this.sessions.get(sourceId);
    if (!entry) return { ok: false };
    await entry.session.disconnect();
    this.emit(entry);
    return { ok: true };
  }

  /**
   * App quit. Every session closes exactly once, and closing observes nothing
   * about remote work: no pause, no stop, no abort, no schedule change.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const entries = [...this.sessions.values()];
    this.sessions.clear();
    this.listeners.clear();
    await Promise.allSettled(
      entries.map(async entry => {
        if (entry.closed) return;
        entry.closed = true;
        entry.offPhase();
        await entry.session.disconnect();
      })
    );
  }

  // ---- Internals ---------------------------------------------------------

  private ensureSession(record: ConnectedSourceRecord): SessionEntry {
    const existing = this.sessions.get(record.id);
    if (existing) {
      existing.record = record;
      return existing;
    }
    const session = this.deps.createSession(record);
    const entry: SessionEntry = {
      record,
      session,
      snapshotRevision: 0,
      offPhase: () => {},
      closed: false,
    };
    // Phase movement is freshness news, not new content, so it never bumps
    // the snapshot revision: a renderer that only cares about topology can
    // ignore a reconnect ladder entirely.
    entry.offPhase = session.onPhaseChange(() => this.emit(entry));
    this.sessions.set(record.id, entry);
    return entry;
  }

  private connectionFor(entry: SessionEntry | null): SourceConnectionView {
    const status = entry
      ? entry.session.status()
      : resolveConnectionStatus({
          // Never opened this launch. Unavailable is the honest answer: it
          // says Exawatt is not observing, and says nothing at all about
          // whether the source is doing work.
          transportUp: false,
          retrying: false,
          lastObservedAt: null,
          failure: null,
          now: this.deps.now(),
        });
    return {
      state: status.state,
      label: CONNECTION_STATE_LABELS[status.state],
      detail: describeConnectionStatus(status),
      observationAgeMs: status.observationAgeMs,
      stalePresentation: status.stalePresentation,
      failure: status.failure,
    };
  }

  private statusFor(
    entry: SessionEntry | null,
    record: ConnectedSourceRecord
  ): ConnectedSourceStatusView {
    return {
      sourceId: record.id,
      displayName: record.displayName,
      adapterId: record.adapterId,
      placement: record.placement,
      placementLabel: PLACEMENT_LABELS[record.placement],
      observing: entry !== null,
      phase: entry?.session.phase ?? 'idle',
      connection: this.connectionFor(entry),
      identityDrift: entry?.session.identityDrift != null,
      snapshotRevision: entry?.snapshotRevision ?? 0,
    };
  }

  private emit(entry: SessionEntry): void {
    if (this.disposed) return;
    const change: ConnectedSourceChange = {
      sourceId: entry.record.id,
      phase: entry.session.phase,
      connection: this.connectionFor(entry),
      snapshotRevision: entry.snapshotRevision,
    };
    for (const listener of this.listeners) listener(change);
  }
}

/* ---- Pure projection helpers --------------------------------------------- */

function isPrimaryConversation(context: SourceContextRecord): boolean {
  return context.roles.includes('primary-conversation');
}

/**
 * One projected coworker's D40 work state.
 *
 * Deliberately only the two states the source's evidence supports. A run in
 * flight is `working`, exactly as a local Session with `working: true` is.
 * Everything else is `idle`: `sessions.list` reports no turn boundary, no
 * human gate, and no fault, so `complete`, `blocked`, and `error` would each
 * be a claim Exawatt has not observed. Read-only H1 earns two of D40's states
 * honestly rather than approximating five.
 *
 * The connection is not an input. An Agent observed working before its source
 * went stale is still working as far as anyone knows; the freshness lens
 * beside the name is what says how old that knowledge is.
 */
function projectedWorkState(agent: ProjectedAgent): AgentStatus {
  return agent.hasActiveRun ? 'working' : 'idle';
}

/**
 * Discovery, as the Connect dialog needs it: who exists, whether Exawatt has
 * placed them before, and enough shape to decide whether to import them.
 */
export function describeDiscoveredAgents(
  snapshot: AgentSourceTopologySnapshot,
  plan: ConnectedAgentProjectionPlan
): DiscoveredSourceAgent[] {
  const mapped = new Map(
    plan.mappings.map(mapping => [sourceAgentKey(mapping), mapping])
  );
  return snapshot.agents.map(agent => {
    const contexts = snapshot.contexts.filter(
      context => context.nativeAgentId === agent.nativeAgentId
    );
    const mapping = mapped.get(sourceAgentKey(agent)) ?? null;
    return {
      nativeAgentId: agent.nativeAgentId,
      displayName: agent.displayName,
      discoveryState: agent.discoveryState,
      contextCount: contexts.length,
      hasPrimaryConversation: contexts.some(isPrimaryConversation),
      mapping: mapping
        ? {
            exawattAgentId: mapping.exawattAgentId,
            projectId: mapping.projectId,
            projectLabel: mapping.projectLabel,
            displayNameOverride: mapping.displayNameOverride,
          }
        : null,
    };
  });
}

export function toRemoteAgentView(
  agent: ProjectedAgent,
  snapshot: AgentSourceTopologySnapshot,
  record: ConnectedSourceRecord,
  projectLabel: string,
  connection: SourceConnectionView
): RemoteAgentView {
  let createdAt = snapshot.observedAt;
  let lastActiveAt = 0;
  for (const context of agent.contexts) {
    if (context.createdAt !== undefined && context.createdAt < createdAt) {
      createdAt = context.createdAt;
    }
    if (
      context.lastActiveAt !== undefined &&
      context.lastActiveAt > lastActiveAt
    ) {
      lastActiveAt = context.lastActiveAt;
    }
  }
  return {
    id: agent.id,
    displayName: agent.displayName,
    projectId: agent.projectId,
    projectLabel,
    discoveryState: agent.discoveryState,
    placement: agent.placement,
    placementLabel: PLACEMENT_LABELS[agent.placement],
    adapterId: agent.adapterId,
    source: { id: record.id, displayName: record.displayName },
    nativeAgentId: agent.nativeAgentId,
    primaryContextId: agent.primaryConversation?.nativeContextId ?? null,
    workState: projectedWorkState(agent),
    contextCount: agent.contexts.length,
    observedAt: snapshot.observedAt,
    createdAt,
    lastActiveAt: lastActiveAt === 0 ? snapshot.observedAt : lastActiveAt,
    connection,
    projectionVersion: AGENT_PROJECTION_VERSION,
  };
}

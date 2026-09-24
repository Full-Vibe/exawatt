/**
 * The workspace model (ENG-002 W0.2): Project groups keyed by PROJECT
 * DIRECTORY, and the two honest kinds of tab inside them.
 *
 * Pure data and pure derivations only. Nothing here reads the desktop bridge,
 * React, or the clock beyond minting an identity, so every rule about what a
 * tab IS can be unit-tested without mounting the workspace.
 */
import { HARNESS_META, isDefaultHarnessTitle } from '../harnesses';
import {
  sessionCanResume,
  sessionLifecyclePresentation,
} from '@exawatt/ui-model';
import type { SessionGlyphState } from '../session-status';
import type { AgentSourceId } from '../agent-sources';
import type { PtyHarness } from '@exawatt/core';
import type {
  ClosedSessionEntry,
  PtySessionRecord,
} from '@exawatt/core/desktop-bridge';

/**
 * A local PTY Session's tab.
 *
 * Everything on it describes a process this machine owns: a working directory,
 * a harness, an incarnation, an exit code, a resume identity. None of that is
 * true of a connected coworker, which is why `RemoteAgentTab` is a second kind
 * rather than these fields with empty values in them.
 */
export interface SessionTab {
  launchModel?: string;
  launchEffort?: string;
  kind: 'session';
  /** stable across revives (sessionId changes when a tab is re-launchd) */
  id: string;
  /** stable logical Session identity, distinct from tab/PTY/provider IDs */
  durableSessionId: string;
  harness: PtyHarness;
  title: string;
  /** Ownership of the strip title. Provider/catalog labels never become
   * tab titles: only an explicit operator rename earns visible title copy. */
  titleKind: TabTitleKind;
  cwd: string;
  sessionId: string | null;
  harnessSessionId: string | null;
  resumeState: ResumeState;
  lifecycle: SessionLifecycle;
  /** null = running; number = exit code; REVIVE_FAILED = revive error */
  exitCode: number | null;
  /** The signal that ended the process (`SIGKILL`), null when none did.
   *  Absent on a record written before exits carried it (BUG-186), which
   *  the lifecycle owner refuses to read as a clean exit. */
  exitSignal?: string | null;
  /** roadmap item declared at launch (ENG-017 S4) — a machine-local view
   *  annotation per decision 0010; overrides link inference, never synced */
  roadmapItemId: string | null;
  /** the composer's goal statement (D21): persists with the layout and
   *  re-anchors the context summarizer when the Session resumes */
  initialTask: string | null;
  /** PTY incarnation start time; present while live for roadmap elapsed time. */
  startedAt?: number | null;
  /** draft tabs only (D24): the source the summon requested (palette
   *  "Start Agent with X"); null = use the recommendation */
  draftSource?: AgentSourceId | null;
  /** draft tabs only (D28): the composer's typed task — the draft's
   *  work-in-progress belongs to the TAB, so it survives the pane
   *  unmounting on tab/Project switches and (with content) restarts */
  draftTask?: string | null;
  /** draft tabs only: the source model resolved or explicitly selected for
   * this launch. It travels with the draft, never mutates harness config. */
  draftModel?: string | null;
  /** draft tabs only: the reasoning effort paired with the selected model. */
  draftEffort?: string | null;
  /** True only after an operator changes the composer. Background catalog
   * hydration must not make an untouched new-tab page durable. */
  draftTouched?: boolean;
  /** Draft launch options travel with the tab just like task/model choices. */
  draftWorktree?: boolean;
  draftBranch?: string | null;
  draftRoadmapItemId?: string | null;
}

/**
 * A connected coworker's tab (ENG-033 H2).
 *
 * Identity, and deliberately nothing else. The conversation, the work stack,
 * and the coworker's own state live on someone else's machine; Exawatt reads
 * them through the source and never caches them in the layout. What persists
 * is which coworker this tab is a view of.
 *
 * `title` and `projectLabel` are last-known copies of names the source owns,
 * kept so the strip can say who a restored tab is before the roster answers.
 * Neither is authority: the roster overrides both the moment it arrives.
 *
 * Closing this tab closes the view. It never reaches the remote worker, which
 * is why nothing here names a process, a directory, or a lifecycle.
 */
export interface RemoteAgentTab {
  kind: 'remote-agent';
  /** stable across roster refreshes and across a relaunch */
  id: string;
  /** last-known coworker name; the source owns the real one */
  title: string;
  /** the configured Agent Source this coworker is observed through */
  sourceId: string;
  /** the Agent's own id on that source */
  nativeAgentId: string;
  /** Exawatt's id for the projected coworker — what the bridge is addressed by */
  agentId: string;
  /** last-known Project label from the mapping */
  projectLabel: string;
}

/**
 * The two honest kinds of tab.
 *
 * The shared members are `kind`, `id`, and `title`: identity and the strip's
 * label. Everything else belongs to one kind, so any consumer that assumes
 * PTY-ness has to say what it means for a coworker before it compiles.
 */
export type WorkspaceTab = SessionTab | RemoteAgentTab;

export function isRemoteAgentTab(tab: WorkspaceTab): tab is RemoteAgentTab {
  return tab.kind === 'remote-agent';
}

export function isSessionTab(tab: WorkspaceTab): tab is SessionTab {
  return tab.kind === 'session';
}

/** What `openRemoteAgent` needs from the roster to open a coworker. */
export interface RemoteAgentOpenRef {
  /** Exawatt's id for the projected coworker */
  agentId: string;
  nativeAgentId: string;
  sourceId: string;
  /** the coworker's name, as its source configured it */
  displayName: string;
  /** the Project this Agent was mapped to at Connect time */
  projectId: string;
  projectLabel: string;
}

/**
 * The Project group a coworker's tab belongs to.
 *
 * Mapping is an explicit Connect-flow decision, so the group is the mapped
 * Project — by identity, never by resemblance. A mapping that names no
 * Project at all falls back to the source, which is the only other true thing
 * about where this coworker came from; it never lands in whichever Project the
 * operator happens to be standing in.
 */
export function remoteAgentGroupDir(ref: {
  projectId: string;
  sourceId: string;
}): string {
  return ref.projectId.trim() || `source:${ref.sourceId}`;
}

export interface WorkspaceDraftPatch {
  draftTask?: string;
  draftSource?: AgentSourceId;
  draftModel?: string | null;
  draftEffort?: string | null;
  draftTouched?: boolean;
  draftWorktree?: boolean;
  draftBranch?: string | null;
  draftRoadmapItemId?: string | null;
}

export function applyWorkspaceDraftPatch(
  tab: SessionTab,
  patch: WorkspaceDraftPatch
): SessionTab {
  const sourceChanged =
    patch.draftSource !== undefined &&
    patch.draftSource !== (tab.draftSource ?? null);
  return {
    ...tab,
    draftTask:
      patch.draftTask === undefined ? (tab.draftTask ?? null) : patch.draftTask,
    draftSource:
      patch.draftSource === undefined
        ? (tab.draftSource ?? null)
        : patch.draftSource,
    draftModel:
      patch.draftModel === undefined
        ? sourceChanged
          ? null
          : (tab.draftModel ?? null)
        : patch.draftModel,
    draftEffort:
      patch.draftEffort === undefined
        ? sourceChanged
          ? null
          : (tab.draftEffort ?? null)
        : patch.draftEffort,
    draftTouched:
      patch.draftTouched === undefined
        ? (tab.draftTouched ?? false)
        : patch.draftTouched,
    draftWorktree:
      patch.draftWorktree === undefined
        ? (tab.draftWorktree ?? false)
        : patch.draftWorktree,
    draftBranch:
      patch.draftBranch === undefined
        ? (tab.draftBranch ?? null)
        : patch.draftBranch,
    draftRoadmapItemId:
      patch.draftRoadmapItemId === undefined
        ? (tab.draftRoadmapItemId ?? null)
        : patch.draftRoadmapItemId,
  };
}

export type TabTitleKind = 'default' | 'operator';

export type SessionLifecycle =
  | 'running'
  | 'stopped-clean'
  | 'interrupted'
  | 'exited'
  | 'resuming'
  | 'failed'
  /** ⌘T new-tab page (D24): a real strip tab whose pane is the composer;
   *  no process yet, discarded by ⌘W without ceremony. Typed draft work
   *  rides on the tab and persists with the layout (D28); an EMPTY draft
   *  still vanishes with the run. */
  | 'draft';

export type ResumeState =
  | 'live'
  | 'ended-resumable'
  | 'identity-missing'
  | 'resuming'
  | 'resumed'
  | 'failed';

export interface ResumeBatchProgress {
  completed: number;
  total: number;
}

/** what a close attempt did (D27) — the UI narrates each differently */
export type CloseOutcome =
  | { kind: 'noop' }
  /** A started live agent needs the in-app confirm; re-call with force. The
   *  turn state rides along so the dialog can name the actual consequence —
   *  an interrupted turn and a discarded question are not the same loss. */
  | { kind: 'needs-confirm'; turn: SessionGlyphState }
  | { kind: 'discarded' }
  | { kind: 'closed'; entry: ClosedSessionEntry }
  /** A coworker's view closed. Nothing was stopped, archived, or asked of the
   *  source: the remote worker never learns Exawatt looked away. */
  | { kind: 'view-closed'; title: string };

/**
 * A PTY incarnation this machine owns is running behind the tab.
 *
 * False for a coworker, and not because Exawatt is disconnected: a remote
 * Agent has no local process at all, so this question has one answer for it
 * forever. What that coworker is DOING is its own D40 work state, which the
 * roster reports and this predicate must never be mistaken for.
 */
export function tabIsLive(tab: WorkspaceTab): boolean {
  if (isRemoteAgentTab(tab)) return false;
  return tab.resumeState === 'live' || tab.resumeState === 'resumed';
}

/**
 * Resume starts a new local process for a saved provider conversation. There
 * is nothing to start for a coworker, and asking its source to would be a
 * command Exawatt does not hold.
 *
 * Past "a local process is gone", the answer is the lifecycle owner's
 * (BUG-185): the same derivation that decides whether the tab may say
 * Paused. Every count, verb and refusal about resuming reads this.
 */
export function tabCanResumeAsAgent(tab: WorkspaceTab): boolean {
  if (isRemoteAgentTab(tab)) return false;
  return (
    !tabIsLive(tab) && tab.resumeState !== 'resuming' && sessionCanResume(tab)
  );
}

/** A stopped Agent whose verb is reconnect: its conversation must be chosen
 *  before it can resume. The complement of `tabCanResumeAsAgent` among
 *  stopped Agents, from the same owner. */
export function tabNeedsReconnection(tab: WorkspaceTab): boolean {
  if (isRemoteAgentTab(tab)) return false;
  return (
    !tabIsLive(tab) &&
    tab.resumeState !== 'resuming' &&
    sessionLifecyclePresentation(tab).verb === 'reconnect'
  );
}

/** Re-adopt a main-process PTY without overstating its lifecycle. This also
 * reconstructs a stopped tab when persistence lagged behind process exit. */
export function tabFromPtySession(
  session: PtySessionRecord,
  id: string,
  roadmapItemId: string | null = null,
  initialTask: string | null = null
): SessionTab {
  return {
    kind: 'session',
    id,
    durableSessionId: session.durableSessionId,
    harness: session.harness,
    title: session.title,
    titleKind: isDefaultHarnessTitle(session.harness, session.title)
      ? 'default'
      : 'operator',
    cwd: session.cwd,
    sessionId: session.exited ? null : session.id,
    harnessSessionId: session.harnessSessionId,
    resumeState: session.exited
      ? session.harnessSessionId
        ? 'ended-resumable'
        : 'identity-missing'
      : 'live',
    lifecycle: session.exited ? 'exited' : 'running',
    exitCode: session.exited ? (session.exitCode ?? 0) : null,
    exitSignal: session.exited ? session.exitSignal : null,
    roadmapItemId,
    initialTask,
    startedAt: session.startedAt,
    launchModel: session.launchModel,
    launchEffort: session.launchEffort,
  };
}

export interface Project {
  /** Workspace grouping key: root path for legacy/local groups, Project id for folderless groups. */
  dir: string;
  /** Local folder binding. Null is a valid folderless Project; absent is legacy `dir`. */
  rootPath?: string | null;
  name: string;
  /** distinct per-project hue (least-used at creation; operator can pick) */
  color: string;
  /** the synced registry row id (S5 P3): links this group to Supabase for
   *  name/color sync. Derived from the registry on load / launch, not persisted. */
  registryId?: string | null;
  tabs: WorkspaceTab[];
  activeTabId: string | null;
}

/** Folder-dependent verbs go through this boundary, never through identity. */
export function projectRootPath(project: Project): string | null {
  return project.rootPath === undefined ? project.dir : project.rootPath;
}

export function resumableAgentTabsInProject(
  projects: Project[],
  projectDir: string
): WorkspaceTab[] {
  return (
    projects
      .find(project => project.dir === projectDir)
      ?.tabs.filter(tabCanResumeAsAgent) ?? []
  );
}

export const REVIVE_FAILED = -999;

let tabCounter = 0;
export function newTabId(): string {
  return `tab-${Date.now().toString(36)}-${++tabCounter}`;
}

export function newDurableSessionId(): string {
  return `session-${crypto.randomUUID()}`;
}

const LEGACY_CATALOG_TITLE_MAX_CHARS = 72;

/** D31 briefly leaked a bounded catalog fallback (the first operator prompt)
 * into a tab title. This shape is deliberately narrow: repair the known
 * migration artifact once without guessing away ordinary operator renames. */
export function isLegacyCatalogTitleLeak(candidate: {
  harness: PtyHarness;
  title: string;
  harnessSessionId: string | null;
  initialTask?: string | null;
  semanticSummary?: string | null;
  draft?: boolean;
}): boolean {
  return (
    candidate.harness !== 'shell' &&
    !candidate.draft &&
    typeof candidate.harnessSessionId === 'string' &&
    typeof candidate.initialTask === 'string' &&
    !!candidate.initialTask.trim() &&
    typeof candidate.semanticSummary === 'string' &&
    !!candidate.semanticSummary.trim() &&
    candidate.title.trim().length <= LEGACY_CATALOG_TITLE_MAX_CHARS &&
    candidate.title.trim().endsWith('…') &&
    candidate.title.trim().split(/\s+/).length > 6
  );
}

/**
 * The ⌘T new-tab page (D24): a real strip tab whose pane is the composer.
 * No process, no resume identity; `requestedSource` is the source a summon
 * asked for (palette "Start Agent with X"), null for the recommendation.
 */
export function newDraftTab(
  cwd: string,
  requestedSource: AgentSourceId | null
): SessionTab {
  return {
    kind: 'session',
    id: newTabId(),
    durableSessionId: newDurableSessionId(),
    harness: 'claude',
    title: 'New agent',
    titleKind: 'default',
    cwd,
    sessionId: null,
    harnessSessionId: null,
    resumeState: 'identity-missing',
    lifecycle: 'draft',
    exitCode: null,
    roadmapItemId: null,
    initialTask: null,
    draftSource: requestedSource,
    draftTask: null,
    draftModel: null,
    draftEffort: null,
    draftTouched: false,
    draftWorktree: false,
    draftBranch: null,
    draftRoadmapItemId: null,
  };
}

/**
 * A soft-closed Session back as a stopped tab (D23): its title, goal
 * statement, and provider identity, never a process. Reopen restores; it
 * never starts anything.
 */
export function tabFromClosedEntry(
  entry: ClosedSessionEntry,
  id: string
): SessionTab {
  // BUG-209: the ledger is a file, and main admits any harness string it
  // finds there; this path has always assumed a harness this build knows.
  const harness = entry.harness as PtyHarness;
  const repairsLegacyCatalogTitle =
    entry.titleKind === undefined &&
    isLegacyCatalogTitleLeak({
      ...entry,
      harness,
      semanticSummary: entry.goal,
    });
  return {
    kind: 'session',
    id,
    durableSessionId: entry.durableSessionId,
    harness,
    title: repairsLegacyCatalogTitle
      ? HARNESS_META[harness].label
      : entry.title,
    titleKind: repairsLegacyCatalogTitle
      ? 'default'
      : entry.titleKind === 'default' || entry.titleKind === 'operator'
        ? entry.titleKind
        : isDefaultHarnessTitle(harness, entry.title)
          ? 'default'
          : 'operator',
    cwd: entry.cwd,
    sessionId: null,
    harnessSessionId: entry.harnessSessionId,
    resumeState:
      entry.harnessSessionId || entry.harness === 'shell'
        ? 'ended-resumable'
        : 'identity-missing',
    lifecycle: 'stopped-clean',
    exitCode: null,
    roadmapItemId: null,
    initialTask: entry.initialTask,
  };
}

/** How an incarnation ended, as `pty:exit` said, when that event beat the
 *  reply that introduced the incarnation. */
export interface ObservedExit {
  exitCode: number;
  exitSignal: string | null;
}

/**
 * What a retained tab becomes when a replacement incarnation answers a
 * resume or a model change. An exit that arrived before the reply wins: the
 * process is already gone, whatever the reply says.
 */
export function runtimeAdoptionPatch(
  tab: SessionTab,
  session: PtySessionRecord,
  observedExit: ObservedExit | undefined
): Partial<SessionTab> {
  const exited = session.exited || observedExit !== undefined;
  return {
    sessionId: exited ? null : session.id,
    harnessSessionId: session.harnessSessionId ?? tab.harnessSessionId,
    cwd: session.cwd,
    launchModel: session.launchModel,
    launchEffort: session.launchEffort,
    lifecycle: exited ? 'exited' : 'running',
    resumeState: exited
      ? session.harnessSessionId || tab.harnessSessionId
        ? 'ended-resumable'
        : 'identity-missing'
      : session.harnessSessionId || tab.harnessSessionId
        ? 'resumed'
        : 'live',
    exitCode: exited ? (observedExit?.exitCode ?? session.exitCode) : null,
    exitSignal: exited
      ? observedExit
        ? observedExit.exitSignal
        : session.exitSignal
      : null,
    startedAt: session.startedAt,
  };
}

/** The layout the workspace owns: what a save writes and every verb reads. */
export interface WorkspaceLayout {
  projects: Project[];
  activeDir: string | null;
  lastUsedDir: string;
  pinnedTabId: string | null;
}

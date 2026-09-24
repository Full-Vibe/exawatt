/**
 * Restoring the persisted layout against what main reports now (ENG-018).
 *
 * On app restart the layout restores without spawning: each saved tab is
 * matched to a live PTY incarnation by durable Session identity, rebuilt as
 * an honest stopped tab when its process is gone, and never started until
 * the operator explicitly resumes it. A renderer reload re-adopts the PTYs
 * that are still live.
 *
 * Pure. The hydration hook does every read (the stored layout, `pty:list`,
 * the recovery marker, main's context store) and hands the answers in.
 */
import { isAgentSourceId, type AgentSourceId } from '../agent-sources';
import { pickDistinctColor, projectColor } from '../project-colors';
import type {
  GoalVisual,
  GoalVisualRef,
  PtyAttention,
  PtySessionInfo,
  ReconciledResumeIdentity,
  ResumeIdentityHint,
  SessionDelegation,
} from '@exawatt/core/desktop-bridge';
import type {
  Project,
  SessionTab,
  WorkspaceLayout,
  WorkspaceTab,
} from './workspace-model';
import type { PersistedSessionTab, PersistedV7 } from './persisted-layout';
import { readPersistedRecents, type RecentProject } from './recent-projects';

/**
 * The Agent tabs whose provider conversation main may be able to name.
 *
 * A coworker has no provider conversation of Exawatt's to reconcile: its
 * history is its source's, and Exawatt never holds a resume identity for it.
 * Shells and drafts have none either.
 */
export function resumeIdentityHints(
  persisted: PersistedV7
): ResumeIdentityHint[] {
  return persisted.projects.flatMap(project =>
    project.tabs.flatMap(tab =>
      tab.kind === 'remote-agent' ||
      tab.harness === 'shell' ||
      tab.lifecycle === 'draft'
        ? []
        : [
            {
              durableSessionId: tab.durableSessionId,
              harness: tab.harness,
              cwd: tab.cwd,
              initialTask: tab.initialTask ?? null,
              harnessSessionId: tab.harnessSessionId,
            },
          ]
    )
  );
}

/** Adopt the provider identities main recovered for tabs that lacked one. */
export function withReconciledIdentities(
  persisted: PersistedV7,
  reconciled: readonly ReconciledResumeIdentity[]
): PersistedV7 {
  const byDurableId = new Map(
    reconciled.map(identity => [
      identity.durableSessionId,
      identity.harnessSessionId,
    ])
  );
  return {
    ...persisted,
    projects: persisted.projects.map(project => ({
      ...project,
      tabs: project.tabs.map(tab =>
        tab.kind === 'remote-agent'
          ? tab
          : {
              ...tab,
              harnessSessionId:
                byDurableId.get(tab.durableSessionId) ?? tab.harnessSessionId,
            }
      ),
    })),
  };
}

/**
 * The goal subtitles the layout carried (D21), keyed by durable Session.
 * Goals are a durable SESSION's, keyed by an identity a coworker tab does not
 * have; its context lives on its own source.
 */
export function persistedContextSummaries(
  persisted: PersistedV7
): Array<readonly [string, string]> {
  return persisted.projects.flatMap(g =>
    g.tabs.flatMap(t =>
      t.kind !== 'remote-agent' && t.contextSummary
        ? [[t.durableSessionId, t.contextSummary] as const]
        : []
    )
  );
}

/** The goal visual REFERENCES the layout carried, keyed by durable Session. */
export function persistedGoalVisualRefs(
  persisted: PersistedV7
): Array<readonly [string, GoalVisualRef]> {
  return persisted.projects.flatMap(g =>
    g.tabs.flatMap(t =>
      t.kind !== 'remote-agent' && t.goalVisual
        ? [[t.durableSessionId, t.goalVisual] as const]
        : []
    )
  );
}

/**
 * Only main can turn a persisted REFERENCE back into pixels (the content
 * store is main's). Without that bridge a restored reference is honestly a
 * fallback, never a `ready` state with no image.
 */
export function unresolvedGoalVisual(visual: GoalVisualRef): GoalVisual {
  return { ...visual, state: 'fallback', dataUrl: null } as GoalVisual;
}

/**
 * Events that arrived between the `pty:list` snapshot resolving and the seed
 * merge. Main will not re-broadcast them, so a stale snapshot must not
 * overwrite what they said.
 */
export interface SeedRaces {
  /** attention cleared since the snapshot */
  attentionCleared: ReadonlySet<string>;
  /** activity went quiet since the snapshot (D29) */
  quiet: ReadonlySet<string>;
  /** the last delegated child ended since the snapshot (ENG-023 D3a) */
  settled: ReadonlySet<string>;
}

export interface SessionStoreSeeds {
  summaries: Record<string, string>;
  goalVisuals: Record<string, GoalVisual>;
  attention: Record<string, PtyAttention>;
  activity: Record<string, boolean>;
  engaged: Record<string, boolean>;
  delegation: Record<string, SessionDelegation>;
}

/**
 * What every Session-keyed store starts from.
 *
 * The persisted layout restores each Session's goal first; live truth from
 * main overrides it, all by durable id. Attention, activity, and started
 * flags adopt from live main truth (D22/D29), so renderer reloads cannot
 * regress any status surface.
 */
export function seedSessionStores(
  live: readonly PtySessionInfo[],
  restored: {
    summaries: ReadonlyArray<readonly [string, string | null]>;
    goalVisuals: ReadonlyArray<readonly [string, GoalVisual | null]>;
  },
  races: SeedRaces
): SessionStoreSeeds {
  const seeds: SessionStoreSeeds = {
    summaries: {},
    goalVisuals: {},
    attention: {},
    activity: {},
    engaged: {},
    delegation: {},
  };
  for (const [durableSessionId, summary] of restored.summaries) {
    if (summary) seeds.summaries[durableSessionId] = summary;
  }
  for (const [durableSessionId, visual] of restored.goalVisuals) {
    if (visual) seeds.goalVisuals[durableSessionId] = visual;
  }
  for (const s of live) {
    if (s.contextSummary)
      seeds.summaries[s.durableSessionId] = s.contextSummary;
    if (s.goalVisual) seeds.goalVisuals[s.durableSessionId] = s.goalVisual;
    if (s.attention && !races.attentionCleared.has(s.id)) {
      seeds.attention[s.id] = s.attention;
    }
    if (s.working && !races.quiet.has(s.id)) {
      seeds.activity[s.id] = true;
    }
    if (s.engaged) seeds.engaged[s.id] = true;
    // Reload and late-attach adopt live delegation immediately (ENG-023);
    // otherwise the dots would wait for the next child to start or stop.
    // Already filtered by main; a settled Session simply carries none.
    if (s.delegation && !races.settled.has(s.id)) {
      seeds.delegation[s.id] = s.delegation;
    }
  }
  return seeds;
}

export interface RestoreContext {
  /** Provider identities main announced before React committed their tabs. */
  observedIdentities: ReadonlyMap<string, string>;
  /** The previous run ended without a clean shutdown checkpoint. */
  previousRunInterrupted: boolean;
}

export interface RestoredLayout extends WorkspaceLayout {
  recentProjects: RecentProject[];
}

/** A persisted draft (D28) restores as a draft: no process, no resume
 *  identity — just the composer with the saved work. */
function restoreDraftTab(
  t: Omit<
    PersistedSessionTab,
    | 'draftTask'
    | 'draftSource'
    | 'draftModel'
    | 'draftEffort'
    | 'draftTouched'
    | 'draftWorktree'
    | 'draftBranch'
    | 'draftRoadmapItemId'
  >,
  {
    draftTask,
    draftSource,
    draftModel,
    draftEffort,
    draftTouched,
    draftWorktree,
    draftBranch,
    draftRoadmapItemId,
  }: PersistedSessionTab
): SessionTab {
  return {
    ...t,
    kind: 'session' as const,
    initialTask: t.initialTask ?? null,
    sessionId: null,
    exitCode: null,
    lifecycle: 'draft' as const,
    resumeState: 'identity-missing' as const,
    draftTask: draftTask ?? null,
    draftSource: isAgentSourceId(draftSource ?? '')
      ? (draftSource as AgentSourceId)
      : null,
    draftModel:
      typeof draftModel === 'string' &&
      draftModel.length <= 512 &&
      !/[\s\u0000-\u001f\u007f]/.test(draftModel)
        ? draftModel
        : null,
    draftEffort:
      typeof draftEffort === 'string' &&
      draftEffort.length <= 32 &&
      /^[a-z][a-z0-9_-]*$/.test(draftEffort)
        ? draftEffort
        : null,
    draftTouched: draftTouched === true,
    draftWorktree: draftWorktree === true,
    draftBranch:
      typeof draftBranch === 'string' &&
      draftBranch.length <= 512 &&
      !/[\u0000-\u001f\u007f]/.test(draftBranch)
        ? draftBranch
        : null,
    draftRoadmapItemId:
      typeof draftRoadmapItemId === 'string' &&
      draftRoadmapItemId.length <= 256 &&
      !/[\u0000-\u001f\u007f]/.test(draftRoadmapItemId)
        ? draftRoadmapItemId
        : null,
  };
}

/**
 * The layout a restart or reload lands on, and the live incarnations no saved
 * tab claimed.
 *
 * `unclaimed` keeps main's `pty:list` order: PTY incarnations unknown to the
 * persisted layout (created or exited since the last save), or the whole
 * fresh-start case. The caller appends them; it never selects the last one.
 */
export function restoreLayout(
  persisted: PersistedV7 | null,
  live: readonly PtySessionInfo[],
  { observedIdentities, previousRunInterrupted }: RestoreContext
): { restored: RestoredLayout | null; unclaimed: PtySessionInfo[] } {
  const liveByDurableId = new Map(live.map(s => [s.durableSessionId, s]));
  if (!persisted) {
    return { restored: null, unclaimed: [...liveByDurableId.values()] };
  }
  const assigned: Array<string | undefined> = persisted.projects.map(
    g => g.color
  );
  const projects: Project[] = persisted.projects.map((g, gi) => ({
    dir: g.dir,
    rootPath: g.rootPath,
    name: g.name,
    color:
      g.color ??
      (assigned[gi] = pickDistinctColor(assigned)) ??
      projectColor(g.dir),
    // belt-and-suspenders vs older/hand-edited files: an activeTabId
    // that matches no tab would blank the pane area
    activeTabId: g.tabs.some(t => t.id === g.activeTabId)
      ? g.activeTabId
      : (g.tabs[0]?.id ?? null),
    tabs: g.tabs.map<WorkspaceTab>(raw => {
      if (raw.kind === 'remote-agent') {
        // A coworker restores as identity and nothing else. There is no
        // process to adopt, no lifecycle to repair, and no cached
        // conversation: the surface re-reads the source on open, so a
        // relaunch can never present yesterday's transcript as current.
        return {
          kind: 'remote-agent',
          id: raw.id,
          title: raw.title,
          sourceId: raw.sourceId,
          nativeAgentId: raw.nativeAgentId,
          agentId: raw.agentId,
          projectLabel: raw.projectLabel,
        };
      }
      // the persisted draft fields stay OFF non-draft tabs (and the
      // untyped draftSource string never reaches WorkspaceTab)
      const {
        draftTask: _draftTask,
        draftSource: _draftSource,
        draftModel: _draftModel,
        draftEffort: _draftEffort,
        draftTouched: _draftTouched,
        draftWorktree: _draftWorktree,
        draftBranch: _draftBranch,
        draftRoadmapItemId: _draftRoadmapItemId,
        ...t
      } = raw;
      if (t.lifecycle === 'draft') return restoreDraftTab(t, raw);
      const s = liveByDurableId.get(t.durableSessionId);
      const initialTask = t.initialTask ?? null;
      const observedIdentity =
        observedIdentities.get(t.durableSessionId) ?? null;
      if (s && !s.exited) {
        liveByDurableId.delete(s.durableSessionId);
        return {
          ...t,
          kind: 'session' as const,
          initialTask,
          startedAt: s.startedAt,
          launchModel: s.launchModel,
          launchEffort: s.launchEffort,
          sessionId: s.id,
          harnessSessionId:
            s.harnessSessionId ?? observedIdentity ?? t.harnessSessionId,
          resumeState: 'live' as const,
          lifecycle: 'running' as const,
          exitCode: s.exited ? (s.exitCode ?? 0) : null,
          exitSignal: null,
        };
      }
      if (s?.exited) {
        liveByDurableId.delete(s.durableSessionId);
        return {
          ...t,
          kind: 'session' as const,
          initialTask,
          startedAt: s.startedAt,
          sessionId: null,
          harnessSessionId:
            s.harnessSessionId ?? observedIdentity ?? t.harnessSessionId,
          resumeState:
            s.harnessSessionId || observedIdentity || t.harnessSessionId
              ? ('ended-resumable' as const)
              : ('identity-missing' as const),
          lifecycle: 'exited' as const,
          exitCode: s.exitCode ?? t.exitCode,
          // Main's record of THIS exit; a persisted signal belongs to
          // an older incarnation.
          exitSignal: s.exitSignal,
        };
      }
      // App restart: process is gone. Restore history and identity, but
      // never spawn until the operator explicitly resumes.
      return {
        ...t,
        kind: 'session' as const,
        initialTask,
        harnessSessionId: observedIdentity ?? t.harnessSessionId,
        sessionId: null,
        exitCode: t.exitCode,
        lifecycle:
          previousRunInterrupted &&
          (t.lifecycle === 'running' || t.lifecycle === 'resuming')
            ? ('interrupted' as const)
            : t.lifecycle === 'running' || t.lifecycle === 'resuming'
              ? ('stopped-clean' as const)
              : t.lifecycle,
        resumeState:
          observedIdentity || t.harnessSessionId
            ? ('ended-resumable' as const)
            : ('identity-missing' as const),
      };
    }),
  }));
  // restore the split only if the pinned tab still exists
  const pinned = persisted.pinnedTabId ?? null;
  return {
    restored: {
      projects,
      activeDir: persisted.activeDir ?? projects[0]?.dir ?? null,
      lastUsedDir: persisted.lastUsedDir ?? '',
      pinnedTabId:
        pinned && projects.some(g => g.tabs.some(t => t.id === pinned))
          ? pinned
          : null,
      recentProjects: readPersistedRecents(persisted.recentProjects),
    },
    unclaimed: [...liveByDurableId.values()],
  };
}

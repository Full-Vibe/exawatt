/**
 * Writing the workspace layout (v7): what a save persists, and what it
 * deliberately leaves behind.
 *
 * Pure. The persistence hook decides WHEN to save and reads the live stores;
 * this module only decides WHAT the record says.
 */
import { tabIsPinnable } from '../split-layout';
import type {
  GoalVisual,
  GoalVisualRef,
  PtySessionRecord,
} from '@exawatt/core/desktop-bridge';
import {
  isRemoteAgentTab,
  isSessionTab,
  tabIsLive,
  type Project,
  type WorkspaceLayout,
} from './workspace-model';
import type { PersistedTab, PersistedV7 } from './persisted-layout';
import type { RecentProject } from './recent-projects';

/**
 * The layout's share of a goal visual: its identity, never its pixels
 * (BUG-031). A visual that has not settled `ready` persists as nothing at
 * all, exactly as before — transitional states are not layout.
 */
export function persistedGoalVisual(
  visual: GoalVisual | undefined
): GoalVisualRef | null {
  if (!visual || visual.state !== 'ready') return null;
  return {
    identityKey: visual.identityKey,
    revision: visual.revision,
    state: 'ready',
  };
}

export interface SerializeContext {
  /** the recency record this save writes (already merged with open Projects) */
  recentProjects: RecentProject[];
  /** goal subtitles keyed by durable Session (D21) */
  summaries: Readonly<Record<string, string>>;
  /** goal visuals keyed by durable Session; only their identity persists */
  goalVisuals: Readonly<Record<string, GoalVisual>>;
  /** the shutdown checkpoint's second stage: live Sessions stop with the app */
  cleanShutdown: boolean;
  /** durable Sessions the shutdown checkpoint parked */
  shutdownTargets: ReadonlySet<string>;
}

/**
 * The Sessions a shutdown checkpoint parks: everything with a process behind
 * it, including a resume still in flight.
 */
export function shutdownTargets(projects: readonly Project[]): Set<string> {
  return new Set(
    projects.flatMap(project =>
      project.tabs
        .filter(isSessionTab)
        .filter(tab => tabIsLive(tab) || tab.lifecycle === 'resuming')
        .map(tab => tab.durableSessionId)
    )
  );
}

/** The persisted record for one layout. Ended tabs remain as explicit resume
 *  targets; an untouched draft is pre-session UI and vanishes with the run. */
export function serializeLayout(
  {
    projects: gs,
    activeDir: ad,
    lastUsedDir: lu,
    pinnedTabId: pin,
  }: WorkspaceLayout,
  {
    recentProjects: recents,
    summaries,
    goalVisuals,
    cleanShutdown,
    shutdownTargets: parked,
  }: SerializeContext
): PersistedV7 {
  // the pin follows the tab (D26): it persists with a stopped tab and
  // reattaches to retained history on relaunch (drafts never persist)
  const pinSurvives =
    pin !== null &&
    gs.some(g => g.tabs.some(t => t.id === pin && tabIsPinnable(t)));
  return {
    v: 7,
    lastUsedDir: lu,
    activeDir: ad,
    pinnedTabId: pinSurvives ? pin : null,
    recentProjects: recents,
    projects: gs.map(g => {
      // An untouched draft is pre-session UI and vanishes with the run.
      // Any explicit composer choice is operator work, even when its task
      // is blank, and persists with the rest of the launch intent.
      const tabs = g.tabs
        .filter(
          tab =>
            // A coworker tab is identity, so it always persists: there is
            // no unstarted state for a view of someone else's work.
            isRemoteAgentTab(tab) ||
            tab.lifecycle !== 'draft' ||
            tab.draftTouched === true ||
            !!tab.draftTask?.trim()
        )
        .map<PersistedTab>(tab => {
          if (isRemoteAgentTab(tab)) {
            // Identity, and nothing the source owns. No transcript, no
            // work stack, no coworker state: all of it is re-read on open.
            return {
              kind: 'remote-agent',
              id: tab.id,
              title: tab.title,
              sourceId: tab.sourceId,
              nativeAgentId: tab.nativeAgentId,
              agentId: tab.agentId,
              projectLabel: tab.projectLabel,
            };
          }
          const stopped =
            cleanShutdown &&
            (parked.has(tab.durableSessionId) ||
              tabIsLive(tab) ||
              tab.lifecycle === 'resuming');
          return {
            kind: 'session' as const,
            id: tab.id,
            durableSessionId: tab.durableSessionId,
            harness: tab.harness,
            title: tab.title,
            titleKind: tab.titleKind,
            cwd: tab.cwd,
            sessionId: stopped ? null : tab.sessionId,
            launchModel: tab.launchModel,
            launchEffort: tab.launchEffort,
            harnessSessionId: tab.harnessSessionId,
            roadmapItemId: tab.roadmapItemId,
            lifecycle: stopped ? ('stopped-clean' as const) : tab.lifecycle,
            exitCode: tab.exitCode,
            // Exawatt's own stop signals the process; that is not how
            // it ended to the operator.
            exitSignal: stopped ? null : tab.exitSignal,
            initialTask: tab.initialTask ?? null,
            startedAt: tab.startedAt ?? null,
            contextSummary: summaries[tab.durableSessionId] ?? null,
            // A REFERENCE, never the pixels (BUG-031). The image is a
            // 265 KB data URL and this record is rewritten end to end
            // 400 ms after every composer keystroke burst and on every
            // tab switch; main keeps the bytes in a content-addressed
            // side store keyed by the same `identityKey` and resolves
            // them back through `pty:restore-goal-visual`.
            goalVisual: persistedGoalVisual(goalVisuals[tab.durableSessionId]),
            ...(tab.lifecycle === 'draft'
              ? {
                  draftTask: tab.draftTask ?? null,
                  draftSource: tab.draftSource ?? null,
                  draftModel: tab.draftModel ?? null,
                  draftEffort: tab.draftEffort ?? null,
                  draftTouched: tab.draftTouched ?? false,
                  draftWorktree: tab.draftWorktree ?? false,
                  draftBranch: tab.draftBranch ?? null,
                  draftRoadmapItemId: tab.draftRoadmapItemId ?? null,
                }
              : {}),
          };
        });
      return {
        dir: g.dir,
        ...(g.rootPath !== undefined ? { rootPath: g.rootPath } : {}),
        name: g.name,
        color: g.color,
        activeTabId: tabs.some(t => t.id === g.activeTabId)
          ? g.activeTabId
          : (tabs[0]?.id ?? null),
        tabs,
      };
    }),
  };
}

/**
 * The checkpoint's last word on provider identity: a conversation id main
 * learned after the renderer's copy was taken still reaches the record.
 */
export function withLiveHarnessIdentities(
  state: PersistedV7,
  live: readonly PtySessionRecord[]
): PersistedV7 {
  const byDurable = new Map(
    live.map(session => [session.durableSessionId, session])
  );
  return {
    ...state,
    projects: state.projects.map(project => ({
      ...project,
      tabs: project.tabs.map(tab => {
        if (tab.kind === 'remote-agent') return tab;
        const session = byDurable.get(tab.durableSessionId);
        return session?.harnessSessionId
          ? { ...tab, harnessSessionId: session.harnessSessionId }
          : tab;
      }),
    })),
  };
}

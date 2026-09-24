/**
 * The persisted workspace layout: every shape it has had on disk, and the
 * one reader that upgrades them all to the current one.
 *
 * Pure: parsing never touches the desktop bridge. What the bridge answers
 * (the stored JSON, the configured sources) is passed in.
 */
import { HARNESS_META, isDefaultHarnessTitle } from '../harnesses';
import type { PtyHarness } from '@exawatt/core';
import type { GoalVisualRef } from '@exawatt/core/desktop-bridge';
import {
  isLegacyCatalogTitleLeak,
  type SessionLifecycle,
  type TabTitleKind,
} from './workspace-model';

/** v6 layout on disk: every tab was a local Session. */
export interface PersistedV6 {
  v: 6;
  lastUsedDir: string;
  activeDir: string | null;
  /** split view (S2): tab pinned beside the active one; optional (pre-S2
   *  layouts lack it) */
  pinnedTabId?: string | null;
  /** durable recency record (ENG-016 D8): a Project whose tabs all closed
   *  stays reachable from ⌘K even offline or signed out; most recent first,
   *  capped. Optional — pre-D8 layouts lack it. */
  recentProjects?: Array<{
    dir: string;
    name: string;
    color?: string;
    lastOpenedAt: number;
  }>;
  projects: Array<{
    dir: string;
    /** Added without a schema bump: absent layouts used `dir` as their path. */
    rootPath?: string | null;
    name: string;
    color?: string;
    activeTabId: string | null;
    /** Written by pre-D45 builds; read by nothing now that the ribbon has
     *  exactly three presentations. Kept in the shape so existing layouts
     *  stay valid without a migration. */
    ribbonExpanded?: boolean;
    tabs: Array<{
      id: string;
      durableSessionId: string;
      harness: PtyHarness;
      title: string;
      titleKind: TabTitleKind;
      cwd: string;
      sessionId: string | null;
      harnessSessionId: string | null;
      roadmapItemId: string | null;
      lifecycle: SessionLifecycle;
      exitCode: number | null;
      /** Added without a schema bump (BUG-186): absent on every record
       *  written before it, and absence means "not recorded", never clean. */
      exitSignal?: string | null;
      /** goal statement + last goal subtitle (D21) — optional: pre-D21
       *  layouts lack them; both restore the context layer on relaunch */
      initialTask?: string | null;
      startedAt?: number | null;
      contextSummary?: string | null;
      /**
       * REFERENCE to the last accepted visual; transitional states do not
       * persist. The pixels live in main's content-addressed side store
       * (BUG-031) — a layout that inlined them was 4.84 MB, of which 4.81 MB
       * was nineteen base64 JPEGs on a keystroke-debounced write path.
       * Layouts written before that change still carry `dataUrl`; main strips
       * it on load, so this type stays a superset of what it accepts.
       */
      goalVisual?: GoalVisualRef | null;
      /** Draft new-tab composer state: any operator-authored launch choice
       * persists; an untouched ⌘T tile still vanishes without ceremony. */
      draftTask?: string | null;
      draftSource?: string | null;
      launchModel?: string;
      launchEffort?: string;
      draftModel?: string | null;
      draftEffort?: string | null;
      draftTouched?: boolean;
      draftWorktree?: boolean;
      draftBranch?: string | null;
      draftRoadmapItemId?: string | null;
    }>;
  }>;
}

/** A local Session's tab on disk. v7 is the first shape that says so. */
export type PersistedSessionTab = {
  kind: 'session';
} & PersistedV6['projects'][number]['tabs'][number];

/**
 * A connected coworker's tab on disk (ENG-033 H2).
 *
 * Identity only. No transcript, no work stack, no coworker state: all of that
 * belongs to the source and is re-read on open, so a layout can never present
 * yesterday's conversation as current.
 */
export interface PersistedRemoteAgentTab {
  kind: 'remote-agent';
  id: string;
  title: string;
  sourceId: string;
  nativeAgentId: string;
  agentId: string;
  projectLabel: string;
}

export type PersistedTab = PersistedSessionTab | PersistedRemoteAgentTab;

/** Current persisted layout (v7): two honest kinds of tab. */
export interface PersistedV7 extends Omit<PersistedV6, 'v' | 'projects'> {
  v: 7;
  projects: Array<
    Omit<PersistedV6['projects'][number], 'tabs'> & { tabs: PersistedTab[] }
  >;
}

/** v5 layout on disk: v6 before tab-title ownership was explicit. */
type PersistedV5 = Omit<PersistedV6, 'v' | 'projects'> & {
  v: 5;
  projects: Array<
    Omit<PersistedV6['projects'][number], 'tabs'> & {
      tabs: Array<
        Omit<PersistedV6['projects'][number]['tabs'][number], 'titleKind'>
      >;
    }
  >;
};

/** v4 layout on disk: v5 minus durable identity and lifecycle. */
type PersistedV4 = Omit<PersistedV5, 'v' | 'projects'> & {
  v: 4;
  projects: Array<
    Omit<PersistedV5['projects'][number], 'tabs'> & {
      tabs: Array<
        Omit<
          PersistedV5['projects'][number]['tabs'][number],
          'durableSessionId' | 'lifecycle' | 'exitCode'
        >
      >;
    }
  >;
};

/** v3 layout on disk: v4 minus the per-tab declared roadmap link. */
type PersistedV3 = Omit<PersistedV4, 'v' | 'projects'> & {
  v: 3;
  projects: Array<
    Omit<PersistedV4['projects'][number], 'tabs'> & {
      tabs: Array<
        Omit<PersistedV4['projects'][number]['tabs'][number], 'roadmapItemId'>
      >;
    }
  >;
};

type PersistedV2 = Omit<PersistedV3, 'v' | 'projects'> & {
  v: 2;
  projects: Array<
    Omit<PersistedV3['projects'][number], 'tabs'> & {
      tabs: Array<
        Omit<
          PersistedV3['projects'][number]['tabs'][number],
          'harnessSessionId'
        >
      >;
    }
  >;
};

/** v1 layout on disk: identical v2 shape under the old `initiatives` key. */
type PersistedV1 = Omit<PersistedV2, 'v' | 'projects'> & {
  v: 1;
  initiatives: PersistedV2['projects'];
};

function upgradeV5TabTitle(
  tab: PersistedV5['projects'][number]['tabs'][number]
): Pick<
  PersistedV6['projects'][number]['tabs'][number],
  'title' | 'titleKind'
> {
  const isDraft = tab.lifecycle === 'draft';
  if (
    isDraft ||
    isDefaultHarnessTitle(tab.harness, tab.title) ||
    isLegacyCatalogTitleLeak({
      ...tab,
      semanticSummary: tab.contextSummary,
      draft: isDraft,
    })
  ) {
    return {
      title: isDraft ? tab.title : HARNESS_META[tab.harness].label,
      titleKind: 'default',
    };
  }
  return { title: tab.title, titleKind: 'operator' };
}

/** A persisted remote tab is identity, so any missing piece of it is fatal:
 *  a coworker tab that cannot say which Agent on which source it is a view of
 *  is not a tab, and restoring it would mint an empty pane nothing can fill. */
function readRemoteAgentTab(tab: unknown): PersistedRemoteAgentTab | null {
  if (!tab || typeof tab !== 'object') return null;
  const record = tab as Record<string, unknown>;
  const text = (value: unknown): string | null =>
    typeof value === 'string' && value.trim().length > 0 && value.length <= 512
      ? value
      : null;
  const id = text(record.id);
  const sourceId = text(record.sourceId);
  const nativeAgentId = text(record.nativeAgentId);
  const agentId = text(record.agentId);
  if (!id || !sourceId || !nativeAgentId || !agentId) return null;
  return {
    kind: 'remote-agent',
    id,
    sourceId,
    nativeAgentId,
    agentId,
    // Names are the source's to own. A layout that lost them still restores;
    // the roster puts the real ones back the moment it answers.
    title: text(record.title) ?? nativeAgentId,
    projectLabel: text(record.projectLabel) ?? '',
  };
}

/** A persisted signal name, or null, or absent when the record has none.
 *  Anything else is unreadable and reads as absent, never as clean. */
function persistedExitSignal(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' &&
    /^(?:SIG[A-Z0-9+]{1,16}|signal \d{1,3})$/.test(value)
    ? value
    : undefined;
}

/** Read the persisted layout, upgrading older shapes in place: v1 (key
 *  `initiatives`) → v2 (key `projects`) → v3 (exact provider IDs) → v4
 *  (declared roadmap links) → v5 (durable lifecycle) → v6 (title ownership)
 *  → v7 (two kinds of tab). */
export function parsePersisted(raw: unknown): PersistedV7 | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as { v?: number; projects?: unknown; initiatives?: unknown };
  const toV5 = (p: PersistedV4): PersistedV5 => ({
    ...p,
    v: 5,
    projects: p.projects.map(project => ({
      ...project,
      tabs: project.tabs.map(tab => ({
        ...tab,
        durableSessionId: tab.id,
        lifecycle: 'stopped-clean' as const,
        exitCode: null,
      })),
    })),
  });
  const toV6 = (p: PersistedV5): PersistedV6 => ({
    ...p,
    v: 6,
    projects: p.projects.map(project => ({
      ...project,
      tabs: project.tabs.map(tab => ({
        ...tab,
        ...upgradeV5TabTitle(tab),
      })),
    })),
  });
  const toV7 = (p: PersistedV6): PersistedV7 => ({
    ...p,
    v: 7,
    // Every tab a v6 file holds is a local Session; that is what v6 could say.
    projects: p.projects.map(project => ({
      ...project,
      tabs: project.tabs.map(tab => ({ kind: 'session' as const, ...tab })),
    })),
  });
  const normalizeV7 = (parsed: PersistedV7): PersistedV7 => {
    const seen = new Set<string>();
    return {
      ...parsed,
      projects: parsed.projects.map(project => ({
        ...project,
        tabs: project.tabs.flatMap<PersistedTab>(tab => {
          if ((tab as { kind?: unknown }).kind === 'remote-agent') {
            const remote = readRemoteAgentTab(tab);
            return remote ? [remote] : [];
          }
          // Anything else is a Session tab, including one written by a v6
          // build straight into a v7 file by a hand edit.
          const session = tab as PersistedSessionTab;
          let durableSessionId = session.durableSessionId || session.id;
          if (seen.has(durableSessionId))
            durableSessionId = `${session.id}-session`;
          seen.add(durableSessionId);
          const lifecycle: SessionLifecycle = [
            'running',
            'stopped-clean',
            'interrupted',
            'exited',
            'resuming',
            'failed',
            'draft',
          ].includes(session.lifecycle)
            ? session.lifecycle
            : 'stopped-clean';
          return [
            {
              ...session,
              launchModel:
                typeof session.launchModel === 'string' &&
                session.launchModel.length <= 512 &&
                !/[\s\u0000-\u001f\u007f]/.test(session.launchModel)
                  ? session.launchModel
                  : undefined,
              launchEffort:
                typeof session.launchEffort === 'string' &&
                /^[a-z][a-z0-9_-]{0,31}$/.test(session.launchEffort)
                  ? session.launchEffort
                  : undefined,
              kind: 'session' as const,
              durableSessionId,
              titleKind:
                session.titleKind === 'default' ||
                session.titleKind === 'operator'
                  ? session.titleKind
                  : isDefaultHarnessTitle(session.harness, session.title)
                    ? 'default'
                    : 'operator',
              lifecycle,
              exitCode: session.exitCode ?? null,
              exitSignal: persistedExitSignal(session.exitSignal),
            },
          ];
        }),
      })),
    };
  };
  const normalizeV6 = (parsed: PersistedV6): PersistedV7 =>
    normalizeV7(toV7(parsed));
  if (d.v === 7 && Array.isArray(d.projects)) {
    return normalizeV7(raw as PersistedV7);
  }
  if (d.v === 6 && Array.isArray(d.projects)) {
    return normalizeV6(raw as PersistedV6);
  }
  if (d.v === 5 && Array.isArray(d.projects))
    return normalizeV6(toV6(raw as PersistedV5));
  if (d.v === 4 && Array.isArray(d.projects))
    return normalizeV6(toV6(toV5(raw as PersistedV4)));
  const toV4 = (p: Omit<PersistedV3, 'v'>): PersistedV4 => ({
    ...p,
    v: 4 as const,
    projects: p.projects.map(project => ({
      ...project,
      tabs: project.tabs.map(tab => ({ ...tab, roadmapItemId: null })),
    })),
  });
  if (d.v === 3 && Array.isArray(d.projects)) {
    const { v: _v, ...rest } = raw as PersistedV3;
    return normalizeV6(toV6(toV5(toV4(rest))));
  }
  const upgrade = (
    projects: PersistedV2['projects'],
    rest: Omit<PersistedV2, 'v' | 'projects'>
  ) =>
    normalizeV6(
      toV6(
        toV5(
          toV4({
            ...rest,
            projects: projects.map(project => ({
              ...project,
              tabs: project.tabs.map(tab => ({
                ...tab,
                harnessSessionId: null,
              })),
            })),
          })
        )
      )
    );
  if (d.v === 2 && Array.isArray(d.projects)) {
    const { projects, v: _v, ...rest } = raw as PersistedV2;
    return upgrade(projects, rest);
  }
  if (d.v === 1 && Array.isArray(d.initiatives)) {
    const { initiatives, v: _v, ...rest } = raw as PersistedV1;
    return upgrade(initiatives, rest);
  }
  return null;
}

/**
 * Drop coworker tabs whose source Exawatt no longer has a record of.
 *
 * Detach is an operator decision that removes Exawatt's projection, so its
 * tabs must not come back with the layout. An Agent the roster stops reporting
 * is a different question entirely, and one this function refuses to answer:
 * a source that is merely unreachable reports nothing, and losing the
 * connection is never evidence the coworker is gone. That tab survives and
 * resolves to a missing state on screen.
 */
export function dropDetachedRemoteTabs(
  persisted: PersistedV7 | null,
  configuredSourceIds: ReadonlySet<string> | null
): PersistedV7 | null {
  if (!persisted || configuredSourceIds === null) return persisted;
  return {
    ...persisted,
    projects: persisted.projects.map(project => ({
      ...project,
      tabs: project.tabs.filter(
        tab =>
          tab.kind !== 'remote-agent' || configuredSourceIds.has(tab.sourceId)
      ),
    })),
  };
}

import type { LocalSessionSnapshot } from '@exawatt/core';
import type { PtySessionInfo } from '@/types/electron';

function leaf(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

/**
 * Merge live main-process PTYs with the persisted tabs the workspace owns.
 * A restored tab has no PTY by design, but it is still a durable Session and
 * therefore remains part of the local fleet until the operator closes it.
 */
export function mergeLocalWorkspaceSessions(
  live: PtySessionInfo[],
  layout: unknown
): LocalSessionSnapshot[] {
  const rawLive = () =>
    live.map(session => ({
      ...session,
      ...(session.exited
        ? { sessionKey: session.durableSessionId }
        : { sessionKey: session.id }),
      sessionState: session.exited ? ('stopped' as const) : ('live' as const),
    }));
  if (!layout || typeof layout !== 'object') return rawLive();

  const root = layout as { projects?: unknown; initiatives?: unknown };
  const groups = Array.isArray(root.projects)
    ? root.projects
    : root.initiatives;
  if (!Array.isArray(groups)) return rawLive();

  const tabByRuntimeId = new Map<string, string>();
  const tabByDurableId = new Map<string, string>();
  for (const candidate of groups) {
    if (!candidate || typeof candidate !== 'object') continue;
    const tabs = (candidate as { tabs?: unknown }).tabs;
    if (!Array.isArray(tabs)) continue;
    for (const row of tabs) {
      if (!row || typeof row !== 'object') continue;
      const tab = row as {
        id?: unknown;
        sessionId?: unknown;
        durableSessionId?: unknown;
      };
      if (typeof tab.id !== 'string') continue;
      if (typeof tab.sessionId === 'string') {
        tabByRuntimeId.set(tab.sessionId, tab.id);
      }
      if (typeof tab.durableSessionId === 'string') {
        tabByDurableId.set(tab.durableSessionId, tab.id);
      }
    }
  }

  const merged: LocalSessionSnapshot[] = live.map(session => ({
    ...session,
    sessionKey: session.exited
      ? (tabByDurableId.get(session.durableSessionId) ??
        tabByRuntimeId.get(session.id) ??
        session.durableSessionId)
      : session.id,
    sessionState: session.exited ? 'stopped' : 'live',
  }));

  const liveIds = new Set(live.map(session => session.id));
  const liveDurableIds = new Set(
    live.map(session => session.durableSessionId).filter(Boolean)
  );

  for (const candidate of groups) {
    if (!candidate || typeof candidate !== 'object') continue;
    const group = candidate as {
      dir?: unknown;
      name?: unknown;
      tabs?: unknown;
    };
    if (typeof group.dir !== 'string' || !Array.isArray(group.tabs)) continue;
    const projectName =
      typeof group.name === 'string' && group.name.trim()
        ? group.name
        : leaf(group.dir);

    for (const row of group.tabs) {
      if (!row || typeof row !== 'object') continue;
      const tab = row as {
        id?: unknown;
        durableSessionId?: unknown;
        sessionId?: unknown;
        harness?: unknown;
        title?: unknown;
        cwd?: unknown;
        lifecycle?: unknown;
        exitCode?: unknown;
      };
      if (
        typeof tab.id !== 'string' ||
        typeof tab.harness !== 'string' ||
        typeof tab.cwd !== 'string'
      ) {
        continue;
      }
      const durableSessionId =
        typeof tab.durableSessionId === 'string'
          ? tab.durableSessionId
          : tab.id;
      if (
        liveDurableIds.has(durableSessionId) ||
        (typeof tab.sessionId === 'string' && liveIds.has(tab.sessionId))
      ) {
        continue;
      }

      const failed =
        tab.lifecycle === 'failed' ||
        (typeof tab.exitCode === 'number' && tab.exitCode !== 0);
      merged.push({
        id: `workspace:${durableSessionId}`,
        sessionKey: tab.id,
        harness: tab.harness,
        title:
          typeof tab.title === 'string' && tab.title.trim()
            ? tab.title
            : tab.harness,
        cwd: tab.cwd,
        projectDir: group.dir,
        projectName,
        startedAt: 0,
        exited: true,
        exitCode: failed ? 1 : 0,
        sessionState: 'stopped',
      });
    }
  }

  return merged;
}

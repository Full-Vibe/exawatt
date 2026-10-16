/**
 * The operator's reading position in each Project's chatter: the stamp of the
 * newest message he has seen. One position per Project, shared by every
 * surface that shows unread (the Chatter tab's badge, Fleet's selected-Agent
 * count), so reading in one place clears it in the other.
 *
 * Kept in this window's localStorage as a per-viewer convenience: losing it
 * only means messages read again as unread, never a lost message.
 */
import { useMemo, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'exawatt:bus-seen:v1';

let positions: Record<string, number> | null = null;
const listeners = new Set<() => void>();

function load(): Record<string, number> {
  if (positions) return positions;
  positions = {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') {
      for (const [projectId, at] of Object.entries(parsed)) {
        if (typeof at === 'number' && Number.isFinite(at)) {
          positions[projectId] = at;
        }
      }
    }
  } catch {
    // unreadable storage starts every Project unread; nothing is lost
  }
  return positions;
}

export function seenThrough(projectId: string): number {
  if (typeof window === 'undefined') return 0;
  return load()[projectId] ?? 0;
}

/** Moves the position forward only: a stale view can never re-mark read
 *  messages as unread. */
export function markSeenThrough(projectId: string, at: number): void {
  if (typeof window === 'undefined') return;
  const current = load();
  if (!(at > (current[projectId] ?? 0))) return;
  positions = { ...current, [projectId]: at };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
  } catch {
    // the in-memory position still holds for this window
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The reading position in each of several Projects, read as one value. */
export function useSeenThroughEach(
  projectIds: readonly string[]
): ReadonlyMap<string, number> {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => projectIds.map(projectId => seenThrough(projectId)).join(','),
    () => ''
  );
  return useMemo(() => {
    const positions = snapshot ? snapshot.split(',').map(Number) : [];
    return new Map(
      projectIds.map((projectId, index) => [projectId, positions[index] ?? 0])
    );
    // the snapshot string carries every position; ids are its key
  }, [projectIds, snapshot]);
}

export function useSeenThrough(projectId: string | null): number {
  return useSyncExternalStore(
    subscribe,
    () => (projectId ? seenThrough(projectId) : 0),
    () => 0
  );
}

/** Test seam: forget the in-memory positions so storage is read again. */
export function resetSeenThroughForTest(): void {
  positions = null;
}

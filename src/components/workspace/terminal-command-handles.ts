/**
 * What a mounted terminal can be asked to do, by Session.
 *
 * The terminal's verbs act on xterm state only the pane holds (its selection,
 * its focus). The pane registers a handle while it is mounted, and every
 * surface that runs a terminal command, its own right-click menu and ⌘K
 * alike, reaches the pane through this one lookup. A command whose terminal
 * is not mounted finds no handle and does nothing.
 */
import type { TerminalTarget } from './terminal-targets';

export interface TerminalCommandHandle {
  copySelection(): void;
  paste(): void;
  selectAll(): void;
  openLink(link: TerminalTarget): void;
  copyLink(link: TerminalTarget): void;
}

const handles = new Map<string, TerminalCommandHandle>();

/** Register the pane for its Session; returns the unregister. */
export function registerTerminalCommandHandle(
  sessionId: string,
  handle: TerminalCommandHandle
): () => void {
  handles.set(sessionId, handle);
  return () => {
    if (handles.get(sessionId) === handle) handles.delete(sessionId);
  };
}

export function terminalCommandHandle(
  sessionId: string
): TerminalCommandHandle | null {
  return handles.get(sessionId) ?? null;
}

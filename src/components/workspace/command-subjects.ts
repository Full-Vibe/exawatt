'use client';

import { useSyncExternalStore } from 'react';
import type { CommandTarget, TargetCommandScope } from './target-commands';

/**
 * The targets ⌘K addresses: what is selected in the workspace on screen (the
 * Agent tab, or the Team tile while Team is open; its Project; its terminal)
 * and the scope their commands run in. The workspace shell publishes this and
 * clears it on unmount; the palette resolves the same target commands a
 * right-click on those targets resolves.
 */
export interface CommandSubjects {
  subjects: readonly CommandTarget[];
  scope: TargetCommandScope | null;
}

const EMPTY_COMMAND_SUBJECTS: CommandSubjects = { subjects: [], scope: null };

let snapshot: CommandSubjects = EMPTY_COMMAND_SUBJECTS;
const listeners = new Set<() => void>();

export function publishCommandSubjects(next: CommandSubjects): void {
  snapshot = next;
  listeners.forEach(listener => listener());
}

/** Unmount reset: a shell that is gone must not leave targets behind. */
export function resetCommandSubjects(): void {
  publishCommandSubjects(EMPTY_COMMAND_SUBJECTS);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCommandSubjects(): CommandSubjects {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => EMPTY_COMMAND_SUBJECTS
  );
}

/**
 * Session operations in flight: a resume, a model change, or a Project pause.
 *
 * Two facts ride on them. A tab with an operation in flight refuses a second
 * one (and a close). And a PTY exit can arrive before the IPC reply that
 * introduces the replacement incarnation, so an exit for a Session with an
 * operation in flight is kept, by incarnation, until that operation ends —
 * otherwise the reply would adopt a process that is already gone.
 *
 * The exits live in a Session-scoped map the workspace declares through its
 * one owner (BUG-037), so a Session the layout forgets is released here too.
 */
import type { ObservedExit, Project } from './workspace-model';
import { isSessionTab } from './workspace-model';

export class SessionOperations {
  /** tab ids with an operation in flight */
  private readonly busy = new Set<string>();

  constructor(
    /** exits by durable Session, then by PTY incarnation id */
    private readonly exits: {
      readonly current: Map<string, Record<string, ObservedExit>>;
    }
  ) {}

  isBusy(tabId: string): boolean {
    return this.busy.has(tabId);
  }

  /** Admit an operation. Admission precedes every await in the verb. */
  begin(tabId: string): void {
    this.busy.add(tabId);
  }

  /** The operation settled: its tab is free and its raced exits are spent. */
  end(tabId: string, durableSessionId: string): void {
    this.busy.delete(tabId);
    this.exits.current.delete(durableSessionId);
  }

  /** Keep an exit only while its Session has an operation in flight. */
  recordExit(
    projects: readonly Project[],
    event: {
      id: string;
      durableSessionId: string;
      exitCode: number;
      exitSignal: string | null;
    }
  ): void {
    const { id, durableSessionId, exitCode, exitSignal } = event;
    if (
      projects.some(project =>
        project.tabs.some(
          tab =>
            isSessionTab(tab) &&
            tab.durableSessionId === durableSessionId &&
            this.busy.has(tab.id)
        )
      )
    ) {
      this.exits.current.set(durableSessionId, {
        ...this.exits.current.get(durableSessionId),
        [id]: { exitCode, exitSignal },
      });
    }
  }

  /** How that incarnation ended, if its exit beat the reply. */
  observedExit(
    durableSessionId: string,
    incarnationId: string
  ): ObservedExit | undefined {
    return this.exits.current.get(durableSessionId)?.[incarnationId];
  }
}

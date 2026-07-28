/**
 * Delegation monitor (ENG-023 D1).
 *
 * Owns per-Session delegation truth and publishes changes. Sits beside
 * `AttentionMonitor` rather than inside it: attention infers from the PTY byte
 * stream, this reads what the harness reported, and keeping them separate is
 * what lets the reported fact CORRECT the inferred one instead of competing
 * with it. Pure Node, no Electron, so it unit-tests directly.
 */
import { EventEmitter } from 'events';
import {
  applyHarnessEvent,
  delegationBusy,
  EMPTY_DELEGATION,
  type HarnessEvent,
  type SessionDelegation,
} from './delegation-state';

interface ChannelLike {
  on(
    event: 'event',
    handler: (sessionId: string, e: HarnessEvent) => void
  ): void;
}

interface ManagerLike {
  on(event: 'exit', handler: (id: string) => void): void;
}

export class DelegationMonitor extends EventEmitter {
  private state = new Map<string, SessionDelegation>();

  attach(channel: ChannelLike, manager?: ManagerLike): void {
    channel.on('event', (sessionId, event) => this.apply(sessionId, event));
    // A dead process reports nothing further; its children cannot outlive it.
    manager?.on('exit', (id: string) => this.drop(id));
  }

  apply(sessionId: string, event: HarnessEvent): void {
    const before = this.state.get(sessionId) ?? EMPTY_DELEGATION;
    const after = applyHarnessEvent(before, event);
    if (after === before) return;
    this.state.set(sessionId, after);
    this.emit('delegation', sessionId, after);
  }

  get(sessionId: string): SessionDelegation | null {
    return this.state.get(sessionId) ?? null;
  }

  /** "The team is working" — outstanding delegated children. */
  isBusy(sessionId: string): boolean {
    return delegationBusy(this.state.get(sessionId));
  }

  /**
   * Forget a Session. Emits once when there was something to forget so every
   * surface clears its dots; silent otherwise, because a Session that never
   * delegated has no state to publish.
   */
  drop(sessionId: string): void {
    const existing = this.state.get(sessionId);
    if (!existing) return;
    this.state.delete(sessionId);
    this.emit('delegation', sessionId, EMPTY_DELEGATION);
  }
}

export const delegationMonitor = new DelegationMonitor();

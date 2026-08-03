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
  delegationIsLive,
  EMPTY_LEDGER,
  type DelegationLedger,
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
  private state = new Map<string, DelegationLedger>();
  /** Cached published shape per Session, so unchanged truth keeps an
   *  unchanged reference and consumers can compare cheaply. */
  private projections = new Map<string, SessionDelegation>();

  attach(channel: ChannelLike, manager?: ManagerLike): void {
    channel.on('event', (sessionId, event) => this.apply(sessionId, event));
    // A dead process reports nothing further; its children cannot outlive it.
    manager?.on('exit', (id: string) => this.drop(id));
  }

  apply(sessionId: string, event: HarnessEvent): void {
    const before = this.state.get(sessionId) ?? EMPTY_LEDGER;
    const after = applyHarnessEvent(before, event);
    if (after === before) return;
    this.state.set(sessionId, after);
    // Staged labels are main-process bookkeeping (D3a). A change that touched
    // ONLY them is invisible to every surface, so nothing is broadcast — the
    // ledger's published fields are all preserved by reference on such edits.
    const visible =
      before.ownTurn !== after.ownTurn ||
      before.blockedOn !== after.blockedOn ||
      before.children !== after.children;
    if (!visible) return;
    const projected = this.projection(sessionId);
    this.emit(
      'delegation',
      sessionId,
      delegationIsLive(projected) ? projected : null
    );
  }

  /** The ledger projected to the published shape — `pending` never leaves
   *  the main process. */
  private projection(sessionId: string): SessionDelegation | null {
    const ledger = this.state.get(sessionId);
    if (!ledger) return null;
    const cached = this.projections.get(sessionId);
    if (
      cached &&
      cached.ownTurn === ledger.ownTurn &&
      cached.blockedOn === ledger.blockedOn &&
      cached.children === ledger.children
    )
      return cached;
    const next: SessionDelegation = {
      ownTurn: ledger.ownTurn,
      blockedOn: ledger.blockedOn,
      children: ledger.children,
    };
    this.projections.set(sessionId, next);
    return next;
  }

  /** Internal truth, including settled records. Attention rules read this. */
  get(sessionId: string): SessionDelegation | null {
    return this.projection(sessionId);
  }

  /**
   * What SURFACES may see. A settled record is published as null so every
   * surface returns to inference together instead of one of them holding a
   * stale reported answer.
   */
  getLive(sessionId: string): SessionDelegation | null {
    const current = this.projection(sessionId);
    return delegationIsLive(current) ? current : null;
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
    this.projections.delete(sessionId);
    this.emit('delegation', sessionId, null);
  }
}

export const delegationMonitor = new DelegationMonitor();

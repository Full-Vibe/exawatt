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

export interface DelegationReportSink {
  report(sessionId: string, event: HarnessEvent): void;
  clearReportedChildren(sessionId: string): void;
}

/** Bounds the dropped-session memory; ids are per-launch UUIDs, never
 *  reused, so this only needs to cover plausibly-in-flight stragglers. */
const DROPPED_CAP = 256;

export class DelegationMonitor extends EventEmitter {
  private state = new Map<string, DelegationLedger>();
  /** Cached published shape per Session, so unchanged truth keeps an
   *  unchanged reference and consumers can compare cheaply. */
  private projections = new Map<string, SessionDelegation>();
  /**
   * Sessions the manager already dropped. A hook POST is an in-flight HTTP
   * request, so a kill mid-turn can land events AFTER `exit` fired; without
   * this memory each one would recreate a Map entry that no second `exit`
   * will ever clean — a slow leak carrying a live-looking record for a dead
   * id. Insertion-ordered Set, trimmed at a cap.
   */
  private dropped = new Set<string>();

  attach(channel: ChannelLike, manager?: ManagerLike): void {
    channel.on('event', (sessionId, event) => this.report(sessionId, event));
    // A dead process reports nothing further; its children cannot outlive it.
    manager?.on('exit', (id: string) => this.drop(id));
  }

  /**
   * Source-owned events enter one shared path whether they arrive from push
   * hooks or a protocol adapter. Secondary truth consumers subscribe here,
   * after the reducer is current, instead of binding to one transport.
   */
  report(sessionId: string, event: HarnessEvent): void {
    if (this.dropped.has(sessionId)) return;
    this.apply(sessionId, event);
    this.emit('harness-event', sessionId, event);
  }

  apply(sessionId: string, event: HarnessEvent): void {
    if (this.dropped.has(sessionId)) return;
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
   * Withdraw an unavailable adapter's observation without claiming that any
   * child completed. Protocol loss must degrade to absent, never synthesize a
   * ready-result attention event.
   */
  clearReportedChildren(sessionId: string): void {
    const before = this.state.get(sessionId);
    if (!before || before.children.length === 0) return;
    this.state.set(sessionId, { ...before, children: [] });
    const projected = this.projection(sessionId);
    this.emit(
      'delegation',
      sessionId,
      delegationIsLive(projected) ? projected : null
    );
  }

  /**
   * Forget a Session. Emits once when the Session had ever PUBLISHED
   * something so every surface clears its dots; silent otherwise — a ledger
   * holding only internal bookkeeping (staged labels, tombstones) was never
   * visible, so there is nothing to withdraw.
   */
  drop(sessionId: string): void {
    this.dropped.add(sessionId);
    if (this.dropped.size > DROPPED_CAP) {
      const oldest = this.dropped.values().next().value;
      if (oldest !== undefined) this.dropped.delete(oldest);
    }
    const existing = this.state.get(sessionId);
    if (!existing) return;
    this.state.delete(sessionId);
    this.projections.delete(sessionId);
    if (delegationIsLive(existing)) this.emit('delegation', sessionId, null);
  }
}

export const delegationMonitor = new DelegationMonitor();

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
  type ReportedChildCensus,
} from './delegation-state';
import type {
  DelegatedChild,
  SessionDelegation,
} from '@exawatt/core/desktop-bridge';

/** What inference found when it closed a turn the source left open (D4). */
interface StaleTurnReclaim {
  /** the parent's own turn before the reclaim; null if nothing established it */
  ownTurn: SessionDelegation['ownTurn'] | null;
  /** reported children still outstanding; the reclaim leaves them to the source */
  children: number;
}

function censusOf(event: HarnessEvent): ReportedChildCensus | null {
  return 'census' in event && event.census ? event.census : null;
}

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
  reconcileReportedChildren(
    sessionId: string,
    children: DelegatedChild[],
    completedChildIds: readonly string[]
  ): void;
}

/** Bounds the dropped-session memory; ids are per-launch UUIDs, never
 *  reused, so this only needs to cover plausibly-in-flight stragglers. */
const DROPPED_CAP = 256;

/** What the monitor announces: projected delegation for the renderer, and
 *  every applied harness event for the turn-truth wiring. */
type DelegationMonitorEvents = {
  delegation: [sessionId: string, delegation: SessionDelegation | null];
  'harness-event': [sessionId: string, event: HarnessEvent];
};

export class DelegationMonitor extends EventEmitter<DelegationMonitorEvents> {
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
      before.request !== after.request ||
      before.requestId !== after.requestId ||
      before.requestCoverage !== after.requestCoverage ||
      before.children !== after.children ||
      before.backgroundTasks !== after.backgroundTasks;
    if (visible) {
      const projected = this.projection(sessionId);
      this.emit(
        'delegation',
        sessionId,
        delegationIsLive(projected) ? projected : null
      );
    }
    const census = censusOf(event);
    if (census)
      this.publishCensusLifecycle(sessionId, before, after, census, event);
  }

  /**
   * The lifecycle a census implies, published only after the ENTIRE census is
   * current: replacing one completed child with another live child must not
   * briefly announce done. A child the census admitted starts; a child the
   * census withdrew ends ONLY if the source itself listed it as completed —
   * withdrawal is not completion, and never raises a result. The child a
   * `child-end` boundary already reported is not reported twice.
   */
  private publishCensusLifecycle(
    sessionId: string,
    before: DelegationLedger,
    after: DelegationLedger,
    census: ReportedChildCensus,
    event: HarnessEvent
  ): void {
    for (const child of after.children) {
      if (!before.children.some(previous => previous.id === child.id)) {
        this.emit('harness-event', sessionId, {
          kind: 'child-start',
          childId: child.id,
          agentType: child.agentType,
          description: child.description,
          at: child.startedAt,
        } satisfies HarnessEvent);
      }
    }
    const completed = new Set(census.completed);
    const reported = event.kind === 'child-end' ? event.childId : null;
    for (const child of before.children) {
      if (
        child.id !== reported &&
        completed.has(child.id) &&
        !after.children.some(next => next.id === child.id)
      ) {
        this.emit('harness-event', sessionId, {
          kind: 'child-end',
          childId: child.id,
        } satisfies HarnessEvent);
      }
    }
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
      cached.request === ledger.request &&
      cached.requestId === ledger.requestId &&
      cached.requestCoverage === ledger.requestCoverage &&
      cached.children === ledger.children &&
      cached.backgroundTasks === ledger.backgroundTasks
    )
      return cached;
    const next: SessionDelegation = {
      ownTurn: ledger.ownTurn,
      blockedOn: ledger.blockedOn,
      ...(ledger.request ? { request: ledger.request } : {}),
      ...(ledger.requestId ? { requestId: ledger.requestId } : {}),
      ...(ledger.requestCoverage
        ? { requestCoverage: ledger.requestCoverage }
        : {}),
      children: ledger.children,
      ...(ledger.backgroundTasks
        ? { backgroundTasks: ledger.backgroundTasks }
        : {}),
    };
    this.projections.set(sessionId, next);
    return next;
  }

  /** Internal truth, including settled records. Attention rules read this. */
  get(sessionId: string): SessionDelegation | null {
    return this.projection(sessionId);
  }

  /**
   * The parent's own turn as something ESTABLISHED it: the source's boundary
   * or an inference reclaim. Null while the ledger holds only the default
   * nobody set (a census-only record), which must never read as "the parent
   * already finished" (BUG-257).
   */
  reportedOwnTurn(sessionId: string): SessionDelegation['ownTurn'] | null {
    const ledger = this.state.get(sessionId);
    return ledger?.ownTurnKnown ? ledger.ownTurn : null;
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

  /** Outstanding delegated Agents or non-Agent background work. */
  isBusy(sessionId: string): boolean {
    return delegationBusy(this.state.get(sessionId));
  }

  /**
   * Replace a source-authoritative census atomically (D5). A snapshot can
   * establish that a previously ended child resumed; delta-event tombstones
   * cannot veto that newer observation. Missing children are withdrawn, not
   * completed. Only explicitly completed IDs may offer a ready result to
   * attention. The same `census` event a Claude boundary carries (D7), so
   * both sources share one reconciliation and one set of tests.
   */
  reconcileReportedChildren(
    sessionId: string,
    children: DelegatedChild[],
    completedChildIds: readonly string[] = [],
    at: number = Date.now()
  ): void {
    this.apply(sessionId, {
      kind: 'census',
      census: { live: children, completed: [...completedChildIds], at },
    });
  }

  /** Withdraw unavailable observations without synthesizing completion. */
  clearReportedChildren(sessionId: string): void {
    this.reconcileReportedChildren(sessionId, []);
  }

  /**
   * Inference closed a turn the source left open (ENG-023 D4): silence past
   * the stale bound with no gate open, after an abort the harness never
   * reported. Closes the parent's OWN turn and nothing else. Reported children
   * stay exactly as the source last listed them: silence is not evidence
   * about a background child (BUG-258), and only the source's next census or
   * process exit may withdraw one. Returns what the record held so the caller
   * can leave evidence of the reclaim.
   */
  reclaimStaleTurn(sessionId: string): StaleTurnReclaim {
    const before = this.state.get(sessionId);
    const reclaim: StaleTurnReclaim = {
      ownTurn: before?.ownTurnKnown ? before.ownTurn : null,
      children: before?.children.length ?? 0,
    };
    if (before) this.apply(sessionId, { kind: 'turn-end' });
    return reclaim;
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

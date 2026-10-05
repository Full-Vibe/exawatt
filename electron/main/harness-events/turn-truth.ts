/**
 * Reported turn truth (ENG-023 D4, D7): the one place the harness's reported
 * record and the PTY's inferred one are coupled.
 *
 * The delegation monitor owns what the harness SAID; the attention monitor
 * owns what the bytes SHOWED. Each stays pure and separately testable, and
 * this module is the wiring between them — the same wiring `pty-ipc` runs in
 * the app and `turn-truth-pipeline.test.ts` runs against the render
 * derivation, so the contract under test is the contract that ships rather
 * than a second copy that can drift (the D4 review found exactly that drift
 * when a liveness rule was written on both sides of the IPC).
 *
 * Three couplings:
 *
 *   reported → inferred   a boundary the harness declares settles or reopens
 *                         the turn at once, 6–7 s ahead of quiescence; a gate
 *                         lights needs-you; the last child's end delivers the
 *                         result that was withheld while the team worked.
 *   inferred → reported   silence past the stale bound with no gate open
 *                         reclaims a turn the harness left open — an aborted
 *                         Claude Code turn emits no boundary — and closes the
 *                         parent's own turn only. Reported children are never
 *                         withdrawn by silence (BUG-258): a background child
 *                         renders nothing in its parent's PTY, so only the
 *                         source's next census or process exit retires one.
 *   evidence              a turn closed by inference rather than by the
 *                         harness's own boundary is written to the main
 *                         diagnostics log with the silence that closed it,
 *                         bounded like the stall trace.
 */
import type { AttentionMonitor } from '../pty/attention-monitor';
import type { StaleReportEvidence } from '../pty/attention-monitor';
import {
  boundDiagnosticRecorder,
  type DiagnosticRecorder,
} from '../diagnostics-log';
import type { DelegationMonitor } from './delegation-monitor';
import type { HarnessEvent } from './delegation-state';

/** Written to `logs/main.jsonl` when inference, not the harness, closed a
 *  reported turn. The next aborted-turn report is a file read, not a hunt. */
export const TURN_RECLAIMED_EVENT = 'delegation.turn-reclaimed';

const TURN_RECLAIM_LOG_BOUNDS = { perMinute: 30, perRun: 500 };

interface TurnTruthWiringOptions {
  attention: AttentionMonitor;
  delegation: DelegationMonitor;
  now?: () => number;
  /** Diagnostics sink for reclaims and boundaries; absent means no evidence kept. */
  record?: DiagnosticRecorder;
  /** Names the harness for the evidence line; absent reads as unknown. */
  harnessOf?: (sessionId: string) => string | null;
}

export function wireReportedTurnTruth({
  attention,
  delegation,
  now = Date.now,
  record,
  harnessOf = () => null,
}: TurnTruthWiringOptions): void {
  const reclaimed = record
    ? boundDiagnosticRecorder(record, { ...TURN_RECLAIM_LOG_BOUNDS, now })
    : null;

  // One reported-truth source for every inference guard. The monitor
  // subscribes to the record, not to a boolean, so a new reported fact
  // (D4's operator gate) corrects inference without a second wire.
  attention.setReportedTurnSource(id => delegation.get(id));

  // Snapshot adapters apply their census directly, without a harness-event.
  // Correct inference whenever published truth changes, for every source.
  delegation.on('delegation', (id: string) => {
    attention.noteReportedBackgroundWork(id);
  });

  const lifecycle = record
    ? boundDiagnosticRecorder(record, { perMinute: 120, perRun: 4000, now })
    : null;
  delegation.on('harness-event', (id: string, event: HarnessEvent) => {
    if (
      event.kind === 'turn-start' ||
      event.kind === 'request-coverage' ||
      event.kind === 'turn-settled' ||
      event.kind === 'turn-end' ||
      event.kind === 'turn-unknown' ||
      event.kind === 'blocked' ||
      event.kind === 'unblocked'
    ) {
      const truth = delegation.get(id);
      lifecycle?.('harness.turn-truth', {
        sessionId: id,
        harness: harnessOf(id),
        boundary: event.kind,
        ownTurn: truth?.ownTurn ?? null,
        blockedOn: truth?.blockedOn ?? null,
        childCount: truth?.children.length ?? 0,
        ...(truth?.requestCoverage
          ? { requestCoverage: truth.requestCoverage }
          : {}),
        backgroundTypes: truth?.backgroundTasks?.map(task => task.type) ?? [],
      });
    }
    // A reported turn boundary is stronger evidence than inferred quiescence,
    // and it arrives 6–7 s sooner. Turn-start also matters for the turn a
    // CHILD opens by returning its result: no keystroke precedes it, so
    // nothing else would reopen the turn.
    if (event.kind === 'turn-start') attention.noteHarnessTurnStart(id);
    if (event.kind === 'turn-unknown')
      attention.noteHarnessTurnUnknown(id, event.preserveResult);
    if (event.kind === 'turn-end') attention.noteHarnessTurnEnd(id);
    if (event.kind === 'turn-settled') attention.noteHarnessTurnSettled(id);
    // An Agent waiting on a question, a permission, or an elicitation is
    // neither working nor finished (D4). Reported, because no amount of
    // staring at the byte stream can tell a pause from a gate.
    if (event.kind === 'blocked')
      attention.noteHarnessBlocked(id, event.request, event.requestId);
    if (
      event.kind === 'unblocked' &&
      (event.requestId || !delegation.get(id)?.blockedOn)
    )
      attention.noteHarnessUnblocked(id, event.requestId);
    // The result of a DELEGATING Session arrives when its last child stops,
    // not when its own turn ended — that boundary was deliberately withheld
    // while the team was still working. Without this, a Session that fans out
    // and finishes never enters the attention queue at all, which is exactly
    // the Session most likely to be worth returning to. The delegation monitor
    // applies the event (and any census it carries) before emitting it, so
    // its record is already current here.
    //
    // "Ended" means something ESTABLISHED it: the source's own boundary or an
    // inference reclaim. A ledger that holds only children (a census-only
    // record) carries the default `available` nobody reported, and treating
    // that as a withheld result is how a Codex parent wore the green check
    // mid-turn every time its last live child finished a step (BUG-257).
    if (
      event.kind === 'child-end' &&
      !delegation.isBusy(id) &&
      delegation.reportedOwnTurn(id) === 'available'
    ) {
      attention.noteHarnessTurnEnd(id);
    }
  });

  // Inference reclaiming a turn nothing will ever close (D4). An aborted
  // Claude Code turn emits no boundary at all; silence past the stale bound
  // with no gate open is the evidence the harness itself has stopped
  // generating. Applied as one `turn-end` so the delegation record stays
  // owned by one module. The children the source listed stay listed: silence
  // says nothing about a background child (BUG-258), so the result follows
  // the ordinary path from here — the reclaiming sweep raises it from the
  // turn's own burst unless children still withhold it, and then the last
  // child's own end delivers it.
  attention.on(
    'reported-turn-stale',
    (id: string, evidence: StaleReportEvidence) => {
      const before = delegation.reclaimStaleTurn(id);
      if (before.ownTurn === null) return;
      reclaimed?.(TURN_RECLAIMED_EVENT, {
        sessionId: id,
        harness: harnessOf(id),
        ownTurn: before.ownTurn,
        childCount: before.children,
        quietMs: evidence.quietMs,
        staleMs: evidence.staleMs,
        evidence: 'pty-silence-past-stale-bound-with-no-gate',
      });
    }
  );
}

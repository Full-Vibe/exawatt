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
 *                         reclaims the record: the turn closes and the census
 *                         is withdrawn — never completed — as one change.
 *   evidence              a census that expired by inference rather than by
 *                         the harness's own boundary is written to the main
 *                         diagnostics log with the child ids and the silence
 *                         that expired it, bounded like the stall trace.
 */
import type { AttentionMonitor } from '../pty/attention-monitor';
import type { StaleReportEvidence } from '../pty/attention-monitor';
import {
  boundDiagnosticRecorder,
  type DiagnosticRecorder,
} from '../diagnostics-log';
import type { DelegationMonitor } from './delegation-monitor';
import type { HarnessEvent } from './delegation-state';

/** Written to `logs/main.jsonl` when inference, not the harness, ended a
 *  reported child. The next BUG-081 report is a file read, not a hunt. */
export const CENSUS_EXPIRED_EVENT = 'delegation.census-expired';

const CENSUS_EXPIRY_LOG_BOUNDS = { perMinute: 30, perRun: 500 };

interface TurnTruthWiringOptions {
  attention: AttentionMonitor;
  delegation: DelegationMonitor;
  now?: () => number;
  /** Diagnostics sink for census expiries; absent means no evidence kept. */
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
  const expired = record
    ? boundDiagnosticRecorder(record, { ...CENSUS_EXPIRY_LOG_BOUNDS, now })
    : null;

  // One reported-truth source for every inference guard. The monitor
  // subscribes to the record, not to a boolean, so a new reported fact
  // (D4's operator gate) corrects inference without a second wire.
  attention.setReportedTurnSource(id => delegation.get(id));

  delegation.on('harness-event', (id: string, event: HarnessEvent) => {
    // A reported turn boundary is stronger evidence than inferred quiescence,
    // and it arrives 6–7 s sooner. Turn-start also matters for the turn a
    // CHILD opens by returning its result: no keystroke precedes it, so
    // nothing else would reopen the turn.
    if (event.kind === 'turn-start') attention.noteHarnessTurnStart(id);
    if (event.kind === 'turn-end') attention.noteHarnessTurnEnd(id);
    // An Agent waiting on a question, a permission, or an elicitation is
    // neither working nor finished (D4). Reported, because no amount of
    // staring at the byte stream can tell a pause from a gate.
    if (event.kind === 'blocked') attention.noteHarnessBlocked(id);
    if (event.kind === 'unblocked') attention.noteHarnessUnblocked(id);
    // The result of a DELEGATING Session arrives when its last child stops,
    // not when its own turn ended — that boundary was deliberately withheld
    // while the team was still working. Without this, a Session that fans out
    // and finishes never enters the attention queue at all, which is exactly
    // the Session most likely to be worth returning to. The delegation monitor
    // applies the event (and any census it carries) before emitting it, so
    // its record is already current here.
    if (
      event.kind === 'child-end' &&
      !delegation.isBusy(id) &&
      delegation.get(id)?.ownTurn === 'available'
    ) {
      attention.noteHarnessTurnEnd(id);
    }
  });

  // Inference reclaiming a report nothing will ever close (D4/D7). An aborted
  // Claude Code turn emits no boundary at all, and a child killed with it
  // emits no `SubagentStop`; silence past the stale bound with no gate open is
  // the evidence the harness itself has stopped rendering anything. Applied
  // as one `turn-end` carrying an empty census so the delegation record stays
  // owned by one module and every surface changes once, together.
  attention.on(
    'reported-turn-stale',
    (id: string, evidence: StaleReportEvidence) => {
      const reclaimed = delegation.reclaimStaleReport(id, now());
      if (reclaimed.withdrawn.length === 0) return;
      expired?.(CENSUS_EXPIRED_EVENT, {
        sessionId: id,
        harness: harnessOf(id),
        childIds: reclaimed.withdrawn.map(child => child.id),
        agentTypes: reclaimed.withdrawn.map(child => child.agentType),
        ownTurn: reclaimed.ownTurn,
        quietMs: evidence.quietMs,
        staleMs: evidence.staleMs,
        evidence: 'pty-silence-past-stale-bound-with-no-gate',
      });
      // The parent's own boundary WAS reported; its result was withheld only
      // for children nothing now vouches for. Deliver it. (A parent still
      // reported generating is reclaimed the ordinary way: the sweep raises
      // the inferred boundary from the turn's own burst.)
      if (reclaimed.ownTurn === 'available') attention.noteHarnessTurnEnd(id);
    }
  );
}

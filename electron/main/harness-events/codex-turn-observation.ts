/** Root lifecycle and queued questions, read from Codex's paginated protocol.
 * A separate app-server calls a TUI-owned open turn interrupted/null. That is
 * unknown, never evidence of completion (BUG-257). No terminal prose is read.
 *
 * A queued question belongs to the turn that asked it (BUG-264). Read from
 * the installed 0.160.1 TUI's own source (`bottom_pane/async_questions/
 * state.rs`, `chatwidget/turn_runtime.rs`, `chatwidget/input_submission.rs`):
 * pending questions are cleared when the live turn completes and when the
 * operator submits a new prompt, and an answered or skipped id can never
 * reopen. So a question is outstanding only while its turn is the live one.
 * The operator's real threads hold questions from finished turns that were
 * never answered in the typed envelope (2 of 5 on 2026-09-30, 2 of 9 on
 * 2026-10-04); raising those at hydration lit three Codex tabs amber for
 * days-old questions the TUI had long dropped.
 */
import type { HarnessEvent } from './delegation-state';

export interface CodexRootQuestion {
  /** `<agentMessage id>:<question index>`, the TUI's own reply key */
  id: string;
  /** the turn the item row belongs to; null when the protocol omits it */
  turnId: string | null;
}

export interface CodexRootObservation {
  turn: { id: string; status: string; completedAt: number | null } | null;
  questions: CodexRootQuestion[];
  answered: string[];
  coverage?: 'complete' | 'partial';
}

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

/** Exact provider reply envelope, not natural-language answer detection.
 * The key is the source tool call plus question index; one answer cannot
 * accidentally resolve every question in a multi-question request. */
function answeredQuestions(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const answered: string[] = [];
  for (const part of content) {
    const text = record(part)?.text;
    if (typeof text !== 'string') continue;
    const match =
      /^<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>$/.exec(
        text.trim()
      );
    if (!match) continue;
    try {
      const replies: unknown = JSON.parse(match[1]);
      if (!Array.isArray(replies)) continue;
      for (const reply of replies) {
        const id = record(reply)?.questionItemId;
        if (typeof id !== 'string') continue;
        const key: unknown = JSON.parse(id);
        if (
          Array.isArray(key) &&
          key[0] === 'request_user_input_async' &&
          typeof key[1] === 'string' &&
          Number.isInteger(key[2]) &&
          key[2] >= 0
        )
          answered.push(`${key[1]}:${key[2]}`);
      }
    } catch {
      /* Malformed or unfamiliar replies resolve nothing. */
    }
  }
  return answered;
}

export function parseCodexRootObservation(
  turns: unknown,
  items: unknown
): CodexRootObservation {
  const turnRows = record(turns)?.data;
  const itemRows = record(items)?.data;
  if (!Array.isArray(turnRows) || !Array.isArray(itemRows))
    throw new Error('Codex root observation is missing protocol rows');
  const raw = record(turnRows[0]);
  let turn: CodexRootObservation['turn'] = null;
  if (raw) {
    if (
      typeof raw.id !== 'string' ||
      typeof raw.status !== 'string' ||
      !(raw.completedAt === null || typeof raw.completedAt === 'number')
    )
      throw new Error('Codex root observation has invalid turn identity');
    turn = { id: raw.id, status: raw.status, completedAt: raw.completedAt };
  }
  const questions: CodexRootQuestion[] = [];
  const answered: string[] = [];
  for (const rowValue of itemRows) {
    const row = record(rowValue);
    const item = record(row?.item);
    if (!item) continue;
    if (
      item.type === 'agentMessage' &&
      item.delivery === 'async' &&
      typeof item.id === 'string' &&
      Array.isArray(item.questions)
    ) {
      // The row, not the item, names the turn (0.160.1 `thread/items/list`).
      const turnId = typeof row?.turnId === 'string' ? row.turnId : null;
      item.questions.forEach((_, index) =>
        questions.push({ id: `${item.id}:${index}`, turnId })
      );
    }
    if (item.type === 'userMessage')
      answered.push(...answeredQuestions(item.content));
  }
  return {
    turn,
    questions,
    answered,
    coverage: record(items)?.nextCursor ? 'partial' : 'complete',
  };
}

/** The turn the TUI is still holding questions for: one the source has not
 *  closed. A separate app-server reads the TUI's own open turn as
 *  interrupted/null; a timestamped interruption, a failure or a completion
 *  is a turn whose queue the TUI has already cleared. */
function liveTurnId(turn: CodexRootObservation['turn']): string | null {
  if (!turn || turn.completedAt !== null) return null;
  return turn.status === 'inProgress' || turn.status === 'interrupted'
    ? turn.id
    : null;
}

/** Per-launch bounded ledger. A repeated snapshot is not a new boundary;
 * replies are tombstoned so overlapping pages cannot resurrect a question. */
export class CodexRootTruth {
  private turnKey: string | null = null;
  private initialized = false;
  /** outstanding question → the live turn it was asked in */
  private pending = new Map<string, string>();
  private answered = new Set<string>();
  private unknown = false;
  private coverage: 'complete' | 'partial' | 'unavailable' | null = null;
  private saturated = false;

  unavailable(): HarnessEvent[] {
    const events: HarnessEvent[] = [];
    if (this.coverage !== 'unavailable') {
      this.coverage = 'unavailable';
      events.push({ kind: 'request-coverage', coverage: 'unavailable' });
    }
    if (!this.unknown)
      events.push({ kind: 'turn-unknown', preserveResult: true });
    this.unknown = true;
    return events;
  }

  accept(observation: CodexRootObservation): HarnessEvent[] {
    const events: HarnessEvent[] = [];
    const turn = observation.turn;
    const key = turn ? `${turn.id}:${turn.status}:${turn.completedAt}` : 'none';
    if (
      key !== this.turnKey ||
      (this.unknown &&
        (turn?.status === 'inProgress' || turn?.status === 'completed'))
    ) {
      const completed =
        turn?.status === 'completed' && turn.completedAt !== null;
      // Initial old completed history is a baseline, not a fresh result.
      if (completed && this.initialized && key !== this.turnKey)
        events.push({ kind: 'turn-end' });
      else if (completed) events.push({ kind: 'turn-settled' });
      else if (!completed)
        events.push({
          kind: turn?.status === 'inProgress' ? 'turn-start' : 'turn-unknown',
        });
      this.turnKey = key;
      this.unknown = !completed && turn?.status !== 'inProgress';
    }
    this.initialized = true;
    for (const id of observation.answered) {
      const known = this.answered.has(id);
      if (this.answered.size < 4096 || known) this.answered.add(id);
      else this.saturated = true;
      const wasPending = this.pending.delete(id);
      // Restored attention may hold a request this process has never seen.
      // Exact source replies resolve it without requiring prior observation.
      if (!known || wasPending)
        events.push({ kind: 'unblocked', reason: 'question', requestId: id });
    }
    // The TUI drops its queue when the turn that asked ends or the operator
    // moves on to a new prompt; a question whose turn is no longer the live
    // one is released here on the same evidence, reply or no reply.
    const live = liveTurnId(turn);
    for (const [id, askedIn] of [...this.pending]) {
      if (live !== null && askedIn === live) continue;
      this.pending.delete(id);
      events.push({ kind: 'unblocked', reason: 'question', requestId: id });
    }
    // Only the live turn's questions are outstanding. History pages carry
    // questions from finished turns; they are hydration, never a needs-you.
    for (const question of observation.questions) {
      if (live === null) break;
      if (question.turnId !== null && question.turnId !== live) continue;
      const id = question.id;
      if (this.saturated || this.answered.has(id) || this.pending.has(id))
        continue;
      if (this.pending.size >= 256) {
        this.saturated = true;
        break;
      }
      this.pending.set(id, live);
      events.push({
        kind: 'blocked',
        reason: 'question',
        request: 'working',
        requestId: id,
      });
    }
    // Never evict a reply tombstone while older pages can still arrive. At
    // the explicit capacity limit, fail closed instead of resurrecting an
    // answered request. Existing requests can still resolve.
    const coverage = this.saturated
      ? 'unavailable'
      : (observation.coverage ?? 'complete');
    if (this.coverage !== coverage) {
      this.coverage = coverage;
      events.push({ kind: 'request-coverage', coverage });
    }
    return events;
  }
}

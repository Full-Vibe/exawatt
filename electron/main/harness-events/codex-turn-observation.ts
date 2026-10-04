/** Root lifecycle and queued questions, read from Codex's paginated protocol.
 * A separate app-server calls a TUI-owned open turn interrupted/null. That is
 * unknown, never evidence of completion (BUG-257). No terminal prose is read.
 */
import { createHash } from 'crypto';
import type { HarnessEvent } from './delegation-state';

export interface CodexRootObservation {
  turn: { id: string; status: string; completedAt: number | null } | null;
  questions: string[];
  answered: string[];
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
  const questions: string[] = [];
  const answered: string[] = [];
  for (const row of itemRows) {
    const item = record(record(row)?.item);
    if (!item) continue;
    if (
      item.type === 'agentMessage' &&
      item.delivery === 'async' &&
      typeof item.id === 'string' &&
      Array.isArray(item.questions)
    ) {
      item.questions.forEach((_, index) =>
        questions.push(`${item.id}:${index}`)
      );
    }
    if (item.type === 'userMessage')
      answered.push(...answeredQuestions(item.content));
  }
  return { turn, questions, answered };
}

/** Per-launch bounded ledger. A repeated snapshot is not a new boundary;
 * replies are tombstoned so overlapping pages cannot resurrect a question. */
export class CodexRootTruth {
  private turnKey: string | null = null;
  private initialized = false;
  private pending = new Set<string>();
  private answered = new Set<string>();
  private unknown = false;

  unavailable(): HarnessEvent[] {
    if (this.unknown) return [];
    this.unknown = true;
    return [{ kind: 'turn-unknown', preserveResult: true }];
  }

  accept(observation: CodexRootObservation): HarnessEvent[] {
    const events: HarnessEvent[] = [];
    const turn = observation.turn;
    const key = turn ? `${turn.id}:${turn.status}:${turn.completedAt}` : 'none';
    if (
      key !== this.turnKey ||
      (this.unknown && turn?.status === 'inProgress')
    ) {
      const completed =
        turn?.status === 'completed' && turn.completedAt !== null;
      // Initial old completed history is a baseline, not a fresh result.
      if (completed && this.initialized && key !== this.turnKey)
        events.push({ kind: 'turn-end' });
      else if (!completed)
        events.push({
          kind: turn?.status === 'inProgress' ? 'turn-start' : 'turn-unknown',
        });
      this.turnKey = key;
      this.unknown = !completed && turn?.status !== 'inProgress';
    }
    this.initialized = true;
    const hadRequest = this.pending.size > 0;
    for (const id of observation.answered) {
      this.answered.add(id);
      this.pending.delete(id);
    }
    let newQuestion = false;
    for (const id of observation.questions) {
      if (
        !this.answered.has(id) &&
        !this.pending.has(id) &&
        this.pending.size < 4096
      ) {
        this.pending.add(id);
        newQuestion = true;
      }
    }
    // Bounded by the protocol observation window, never by elapsed time.
    while (this.answered.size > 4096)
      this.answered.delete(this.answered.values().next().value!);
    if (this.pending.size && newQuestion)
      events.push({
        kind: 'blocked',
        reason: 'question',
        request: 'working',
        requestId: createHash('sha256')
          .update([...this.pending].sort().join('|'))
          .digest('hex'),
      });
    if (!this.pending.size && hadRequest)
      events.push({ kind: 'unblocked', reason: 'question' });
    return events;
  }
}

import { describe, expect, it } from 'vitest';
import {
  CodexRootTruth,
  parseCodexRootObservation,
} from './codex-turn-observation';
const turn = (
  status = 'interrupted',
  completedAt: number | null = null,
  id = 'turn'
) => ({ id, status, completedAt });
const question = (id = 'call', count = 2) => ({
  item: {
    type: 'agentMessage',
    id,
    delivery: 'async',
    questions: Array.from({ length: count }, () => ({ title: 'Choose' })),
  },
});
const reply = (index: number, id = 'call') => ({
  item: {
    type: 'userMessage',
    content: [
      {
        type: 'text',
        text: `<send_user_message_question_reply>\n${JSON.stringify([{ questionItemId: JSON.stringify(['request_user_input_async', id, index]), answer: 'answer' }])}\n</send_user_message_question_reply>`,
      },
    ],
  },
});
const snapshot = (t = turn(), items: unknown[] = []) =>
  parseCodexRootObservation({ data: [t] }, { data: items });

describe('Codex TUI root observations', () => {
  it('never treats interrupted/null, compaction, child work or silence as completion', () => {
    const truth = new CodexRootTruth();
    expect(truth.accept(snapshot())).toEqual([{ kind: 'turn-unknown' }]);
    expect(
      truth.accept(
        snapshot(turn(), [
          { item: { type: 'contextCompaction' } },
          { item: { type: 'subAgentActivity', kind: 'started' } },
        ])
      )
    ).toEqual([]);
    expect(truth.accept(snapshot(turn('completed', 12)))).toEqual([
      { kind: 'turn-end' },
    ]);
    expect(truth.accept(snapshot(turn('completed', 12)))).toEqual([]);
    expect(truth.accept(snapshot(turn('interrupted', null, 'next')))).toEqual([
      { kind: 'turn-unknown' },
    ]);
  });
  it('does not replay old completion on attach, read failure or recovery', () => {
    const truth = new CodexRootTruth();
    expect(truth.accept(snapshot(turn('completed', 1)))).toEqual([]);
    expect(truth.unavailable()).toEqual([
      { kind: 'turn-unknown', preserveResult: true },
    ]);
    expect(truth.unavailable()).toEqual([]);
    expect(truth.accept(snapshot(turn('completed', 1)))).toEqual([]);
  });
  it('questions coexist with work and resolve individually by source identity', () => {
    const truth = new CodexRootTruth();
    expect(truth.accept(snapshot(turn('inProgress'), [question()]))).toEqual([
      { kind: 'turn-start' },
      {
        kind: 'blocked',
        reason: 'question',
        request: 'working',
        requestId: expect.any(String),
      },
    ]);
    expect(
      truth.accept(snapshot(turn('inProgress'), [reply(0), question()]))
    ).toEqual([]);
    expect(
      truth.accept(snapshot(turn('completed', 2), [reply(0), question()]))
    ).toEqual([{ kind: 'turn-end' }]);
    expect(
      truth.accept(snapshot(turn('completed', 2), [reply(1), question()]))
    ).toEqual([{ kind: 'unblocked', reason: 'question' }]);
    expect(truth.accept(snapshot(turn('completed', 2), [question()]))).toEqual(
      []
    );
  });
  it('does not mistake arbitrary user text for an answer, or hide a fresh question', () => {
    const truth = new CodexRootTruth();
    truth.accept(snapshot(turn(), [question('first', 1)]));
    expect(
      truth.accept(
        snapshot(turn(), [
          {
            item: {
              type: 'userMessage',
              content: [{ type: 'text', text: 'I answered everything' }],
            },
          },
          question('second', 1),
        ])
      )
    ).toEqual([
      {
        kind: 'blocked',
        reason: 'question',
        request: 'working',
        requestId: expect.any(String),
      },
    ]);
  });
});

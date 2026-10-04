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

const accept = (
  truth: CodexRootTruth,
  observation: ReturnType<typeof snapshot>
) =>
  truth.accept(observation).filter(event => event.kind !== 'request-coverage');

describe('Codex TUI root observations', () => {
  it('never treats interrupted/null, compaction, child work or silence as completion', () => {
    const truth = new CodexRootTruth();
    expect(accept(truth, snapshot())).toEqual([{ kind: 'turn-unknown' }]);
    expect(
      accept(
        truth,
        snapshot(turn(), [
          { item: { type: 'contextCompaction' } },
          { item: { type: 'subAgentActivity', kind: 'started' } },
        ])
      )
    ).toEqual([]);
    expect(accept(truth, snapshot(turn('completed', 12)))).toEqual([
      { kind: 'turn-end' },
    ]);
    expect(accept(truth, snapshot(turn('completed', 12)))).toEqual([]);
    expect(accept(truth, snapshot(turn('interrupted', null, 'next')))).toEqual([
      { kind: 'turn-unknown' },
    ]);
  });
  it('does not replay old completion on attach, read failure or recovery', () => {
    const truth = new CodexRootTruth();
    expect(accept(truth, snapshot(turn('completed', 1)))).toEqual([
      { kind: 'turn-settled' },
    ]);
    expect(
      truth.unavailable().filter(event => event.kind !== 'request-coverage')
    ).toEqual([{ kind: 'turn-unknown', preserveResult: true }]);
    expect(
      truth.unavailable().filter(event => event.kind !== 'request-coverage')
    ).toEqual([]);
    expect(accept(truth, snapshot(turn('completed', 1)))).toEqual([
      { kind: 'turn-settled' },
    ]);
  });
  it('questions coexist with work and resolve individually by source identity', () => {
    const truth = new CodexRootTruth();
    expect(accept(truth, snapshot(turn('inProgress'), [question()]))).toEqual([
      { kind: 'turn-start' },
      {
        kind: 'blocked',
        reason: 'question',
        request: 'working',
        requestId: 'call:0',
      },
      {
        kind: 'blocked',
        reason: 'question',
        request: 'working',
        requestId: 'call:1',
      },
    ]);
    expect(
      accept(truth, snapshot(turn('inProgress'), [reply(0), question()]))
    ).toEqual([{ kind: 'unblocked', reason: 'question', requestId: 'call:0' }]);
    expect(
      accept(truth, snapshot(turn('completed', 2), [reply(0), question()]))
    ).toEqual([{ kind: 'turn-end' }]);
    expect(
      accept(truth, snapshot(turn('completed', 2), [reply(1), question()]))
    ).toEqual([{ kind: 'unblocked', reason: 'question', requestId: 'call:1' }]);
    expect(accept(truth, snapshot(turn('completed', 2), [question()]))).toEqual(
      []
    );
  });
  it('keeps coverage partial until older pages arrive and never evicts reply evidence', () => {
    const truth = new CodexRootTruth();
    const newest = {
      ...snapshot(),
      coverage: 'partial' as const,
      answered: Array.from({ length: 4097 }, (_, i) => `old:${i}`),
    };
    expect(truth.accept(newest)).toContainEqual({
      kind: 'request-coverage',
      coverage: 'unavailable',
    });
    expect(
      accept(truth, { ...snapshot(), questions: ['old:0', 'old:4096'] })
    ).toEqual([]);
  });

  it('resolves an exact restored request even if its question predates this process', () => {
    const truth = new CodexRootTruth();
    expect(accept(truth, snapshot(turn(), [reply(1)]))).toContainEqual({
      kind: 'unblocked',
      reason: 'question',
      requestId: 'call:1',
    });
    expect(accept(truth, snapshot(turn(), [question()]))).toEqual([
      {
        kind: 'blocked',
        reason: 'question',
        request: 'working',
        requestId: 'call:0',
      },
    ]);
  });

  it('does not mistake arbitrary user text for an answer, or hide a fresh question', () => {
    const truth = new CodexRootTruth();
    accept(truth, snapshot(turn(), [question('first', 1)]));
    expect(
      accept(
        truth,
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
        requestId: 'second:0',
      },
    ]);
  });
});

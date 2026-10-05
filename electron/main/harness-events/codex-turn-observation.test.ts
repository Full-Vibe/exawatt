import { describe, expect, it } from 'vitest';
import {
  CodexRootTruth,
  parseCodexRootObservation,
} from './codex-turn-observation';

/** Shapes as the installed 0.160.1 `thread/turns/list` and `thread/items/list`
 *  return them (read-only probe of the operator's own threads, 2026-10-05):
 *  the item ROW names the turn; the async question is an `agentMessage` with
 *  `delivery: 'async'`; the reply is a `userMessage` carrying the TUI's typed
 *  envelope keyed by `[tool, message id, question index]`. */
const turn = (
  status = 'interrupted',
  completedAt: number | null = null,
  id = 'turn'
) => ({ id, status, completedAt });
const question = (id = 'call', count = 2, turnId: string | null = 'turn') => ({
  turnId,
  item: {
    type: 'agentMessage',
    id,
    delivery: 'async',
    questions: Array.from({ length: count }, () => ({ title: 'Choose' })),
  },
});
const reply = (index: number, id = 'call', turnId: string | null = 'turn') => ({
  turnId,
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

const blocked = (requestId: string) => ({
  kind: 'blocked',
  reason: 'question',
  request: 'working',
  requestId,
});
const unblocked = (requestId: string) => ({
  kind: 'unblocked',
  reason: 'question',
  requestId,
});

describe('Codex TUI root observations', () => {
  it('reads the turn a question belongs to from its row', () => {
    expect(snapshot(turn(), [question('call', 1, 'turn-a')]).questions).toEqual(
      [{ id: 'call:0', turnId: 'turn-a' }]
    );
    expect(snapshot(turn(), [question('call', 1, null)]).questions).toEqual([
      { id: 'call:0', turnId: null },
    ]);
  });

  it('never treats interrupted/null, compaction, child work or silence as completion', () => {
    const truth = new CodexRootTruth();
    expect(accept(truth, snapshot())).toEqual([{ kind: 'turn-unknown' }]);
    expect(
      accept(
        truth,
        snapshot(turn(), [
          { turnId: 'turn', item: { type: 'contextCompaction' } },
          {
            turnId: 'turn',
            item: { type: 'subAgentActivity', kind: 'started' },
          },
          {
            turnId: 'turn',
            item: { type: 'subAgentActivity', kind: 'completed' },
          },
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
      blocked('call:0'),
      blocked('call:1'),
    ]);
    expect(
      accept(truth, snapshot(turn('inProgress'), [reply(0), question()]))
    ).toEqual([unblocked('call:0')]);
    // The turn ends with call:1 unanswered: the TUI clears its queue with
    // the turn, so the question is released on the same boundary.
    expect(
      accept(truth, snapshot(turn('completed', 2), [reply(0), question()]))
    ).toEqual([{ kind: 'turn-end' }, unblocked('call:1')]);
    expect(accept(truth, snapshot(turn('completed', 2), [question()]))).toEqual(
      []
    );
  });

  it('a question is outstanding only while the turn that asked it is live (BUG-264)', () => {
    const truth = new CodexRootTruth();
    const asked = question('call', 1, 'turn-a');
    expect(
      accept(truth, snapshot(turn('interrupted', null, 'turn-a'), [asked]))
    ).toEqual([{ kind: 'turn-unknown' }, blocked('call:0')]);
    // Repeated polls while the turn runs: nothing new.
    expect(
      accept(truth, snapshot(turn('interrupted', null, 'turn-a'), [asked]))
    ).toEqual([]);
    // The operator moves on: a new prompt starts turn-b, and the TUI drops
    // the queued question (`input_submission.rs`). The old item is still in
    // the history pages; it must neither stay outstanding nor be re-raised.
    expect(
      accept(truth, snapshot(turn('interrupted', null, 'turn-b'), [asked]))
    ).toEqual([{ kind: 'turn-unknown' }, unblocked('call:0')]);
    expect(
      accept(truth, snapshot(turn('interrupted', null, 'turn-b'), [asked]))
    ).toEqual([]);
    // turn-b's own question is a fresh request.
    expect(
      accept(
        truth,
        snapshot(turn('interrupted', null, 'turn-b'), [
          question('later', 1, 'turn-b'),
          asked,
        ])
      )
    ).toEqual([blocked('later:0')]);
  });

  it('questions from finished turns never raise at hydration (the three amber Codex tabs)', () => {
    // The operator's live threads on 2026-10-05: nine questions across six
    // completed turns, two never answered in the typed envelope. The TUI had
    // dropped them with their turns; attaching to the Session must not light
    // needs-you for them.
    const truth = new CodexRootTruth();
    expect(
      accept(
        truth,
        snapshot(turn('completed', 1791173149, 'turn-z'), [
          question('call_JP8W', 1, 'turn-z'),
          reply(0, 'call_JP8W', 'turn-z'),
          question('call_M7oI', 1, 'turn-y'),
          question('call_RiBb', 2, 'turn-x'),
        ])
      )
    ).toEqual([{ kind: 'turn-settled' }, unblocked('call_JP8W:0')]);
  });

  it('a question row without a turn id rides the live turn and leaves with it', () => {
    const truth = new CodexRootTruth();
    expect(
      accept(truth, snapshot(turn('inProgress'), [question('call', 1, null)]))
    ).toEqual([{ kind: 'turn-start' }, blocked('call:0')]);
    expect(
      accept(truth, snapshot(turn('completed', 3), [question('call', 1, null)]))
    ).toEqual([{ kind: 'turn-end' }, unblocked('call:0')]);
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
      accept(truth, {
        ...snapshot(),
        questions: [
          { id: 'old:0', turnId: 'turn' },
          { id: 'old:4096', turnId: 'turn' },
        ],
      })
    ).toEqual([]);
  });

  it('resolves an exact restored request even if its question predates this process', () => {
    const truth = new CodexRootTruth();
    expect(accept(truth, snapshot(turn(), [reply(1)]))).toContainEqual(
      unblocked('call:1')
    );
    expect(accept(truth, snapshot(turn(), [question()]))).toEqual([
      blocked('call:0'),
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
            turnId: 'turn',
            item: {
              type: 'userMessage',
              content: [{ type: 'text', text: 'I answered everything' }],
            },
          },
          question('second', 1),
        ])
      )
    ).toEqual([blocked('second:0')]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  createRecipientStateSource,
  recipientState,
  type RecipientFacts,
} from './recipient-state';

const ready: RecipientFacts = {
  exited: false,
  starting: false,
  attention: null,
  reportedOwnTurn: null,
  blockedOn: null,
  working: false,
};

describe('recipientState', () => {
  it.each<[string, Partial<RecipientFacts>, string]>([
    ['a dead process', { exited: true, working: true }, 'ended'],
    [
      'a program still starting, even mid-turn',
      { starting: true, working: true },
      'starting',
    ],
    [
      'an open permission gate',
      { attention: { kind: 'blocked', since: 1, request: 'blocking' } },
      'blocked',
    ],
    [
      'a reported question',
      { blockedOn: 'question', reportedOwnTurn: 'generating' },
      'blocked',
    ],
    ['a reported running turn', { reportedOwnTurn: 'generating' }, 'running'],
    [
      'a reported finished turn, bytes still drawing',
      { reportedOwnTurn: 'available', working: true },
      'ready',
    ],
    ['byte inference only', { working: true }, 'running'],
    [
      'a bell of unknown meaning',
      { attention: { kind: 'bell', since: 1, request: 'unknown' } },
      'ready',
    ],
    [
      'a result waiting to be read',
      { attention: { kind: 'turn-end', since: 1 } },
      'ready',
    ],
  ])('reads %s', (_case, facts, expected) => {
    expect(recipientState({ ...ready, ...facts })).toBe(expected);
  });
});

describe('createRecipientStateSource', () => {
  function harness() {
    const facts = new Map<string, RecipientFacts>();
    let notify: (id: string, reported: boolean) => void = () => {};
    const source = createRecipientStateSource({
      facts: id => facts.get(id) ?? ready,
      watch: listener => {
        notify = listener;
        return () => {};
      },
    });
    const seen: string[] = [];
    source.subscribe((id, change) => seen.push(`${id}:${change}`));
    return {
      source,
      seen,
      set(id: string, value: Partial<RecipientFacts>, reported = false) {
        facts.set(id, { ...ready, ...value });
        notify(id, reported);
      },
    };
  }

  it('announces a turn start on a ready-to-running edge, once', () => {
    const world = harness();
    expect(world.source.state('pty-1')).toBe('ready');
    world.set('pty-1', { working: true });
    world.set('pty-1', { working: true });
    expect(world.seen).toEqual([
      'pty-1:state',
      'pty-1:turn-start',
      'pty-1:state',
    ]);
  });

  it('announces a reported turn start even with no idle gap between turns', () => {
    const world = harness();
    world.set('pty-1', { reportedOwnTurn: 'generating' });
    world.set('pty-1', { reportedOwnTurn: 'generating' }, true);
    expect(
      world.seen.filter(entry => entry.endsWith('turn-start'))
    ).toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';
import {
  attentionNeedsOperator,
  mergeSessionAttentionMaps,
  mergeSessionAttentionSignals,
  orderedAttentionTargets,
  sessionStatusLightState,
} from './session-status';

describe('sessionStatusLightState', () => {
  it('distinguishes results from human gates without replacing Session truth', () => {
    expect(sessionStatusLightState({ state: 'fresh' })).toBe('off');
    expect(sessionStatusLightState({ state: 'quiet' })).toBe('off');
    expect(sessionStatusLightState({ state: 'working' })).toBe('active');
    expect(sessionStatusLightState({ state: 'done' })).toBe('result');
    expect(
      sessionStatusLightState({
        state: 'done',
        attention: { kind: 'turn-end', since: 1 },
      })
    ).toBe('result');
    expect(
      sessionStatusLightState({
        state: 'working',
        attention: { kind: 'bell', since: 1 },
      })
    ).toBe('needs-you');
    expect(
      sessionStatusLightState({
        state: 'done',
        attention: { kind: 'roadmap-blocked', since: 1 },
      })
    ).toBe('needs-you');
    expect(sessionStatusLightState({ state: 'working', fault: true })).toBe(
      'fault'
    );
  });

  it('puts only visible human gates into the attention queue', () => {
    expect(attentionNeedsOperator(null)).toBe(false);
    expect(attentionNeedsOperator({ kind: 'turn-end' })).toBe(false);
    expect(attentionNeedsOperator({ kind: 'bell' })).toBe(true);
    expect(attentionNeedsOperator({ kind: 'roadmap-blocked' })).toBe(true);
    expect(attentionNeedsOperator({})).toBe(true);
  });

  it('keeps an operator gate visible when a quiet result arrives too', () => {
    expect(
      mergeSessionAttentionSignals(
        { kind: 'turn-end', since: 20 },
        { kind: 'roadmap-blocked', since: 10 }
      )
    ).toEqual({ kind: 'roadmap-blocked', since: 10 });
    expect(
      mergeSessionAttentionSignals(
        { kind: 'turn-end', since: 20 },
        { kind: 'bell', since: 30 }
      )
    ).toEqual({ kind: 'bell', since: 30 });
    expect(
      mergeSessionAttentionMaps(
        { shared: { kind: 'turn-end', since: 20 } },
        { shared: { kind: 'roadmap-blocked', since: 10 } }
      )
    ).toEqual({ shared: { kind: 'roadmap-blocked', since: 10 } });
  });

  it('orders only visible operator targets and skips the active Session', () => {
    expect(
      orderedAttentionTargets(
        {
          result: { kind: 'turn-end', since: 1 },
          active: { kind: 'bell', since: 2 },
          later: { kind: 'roadmap-blocked', since: 4 },
          earlier: { kind: 'bell', since: 3 },
        },
        'active'
      )
    ).toEqual(['earlier', 'later']);
  });
});

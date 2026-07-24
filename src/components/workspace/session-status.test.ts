import { describe, expect, it } from 'vitest';
import {
  attentionNeedsOperator,
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
});

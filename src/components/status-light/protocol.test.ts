import { describe, expect, it } from 'vitest';
import { deriveStatusLightState } from './protocol';

describe('deriveStatusLightState', () => {
  it('keeps a quiet Agent off', () => {
    expect(deriveStatusLightState({})).toBe('off');
  });

  it('maps each isolated signal to its light state', () => {
    expect(deriveStatusLightState({ active: true })).toBe('active');
    expect(deriveStatusLightState({ hasResult: true })).toBe('result');
    expect(deriveStatusLightState({ needsOperator: true })).toBe('needs-you');
    expect(deriveStatusLightState({ fault: true })).toBe('fault');
  });

  it('uses fault → human gate → result → active priority', () => {
    expect(
      deriveStatusLightState({
        active: true,
        hasResult: true,
        needsOperator: true,
        fault: true,
      })
    ).toBe('fault');
    expect(
      deriveStatusLightState({
        active: true,
        hasResult: true,
        needsOperator: true,
      })
    ).toBe('needs-you');
    expect(deriveStatusLightState({ active: true, hasResult: true })).toBe(
      'result'
    );
  });
});

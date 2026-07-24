import { describe, expect, it } from 'vitest';
import {
  deriveStatusLightState,
  statusLightStateForAgentStatus,
} from './protocol';

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

describe('statusLightStateForAgentStatus', () => {
  it('projects Fleet lifecycle states into the five-light protocol', () => {
    expect(statusLightStateForAgentStatus('idle')).toBe('off');
    expect(statusLightStateForAgentStatus('working')).toBe('active');
    expect(statusLightStateForAgentStatus('reviewing')).toBe('active');
    expect(statusLightStateForAgentStatus('complete')).toBe('result');
    expect(statusLightStateForAgentStatus('blocked')).toBe('needs-you');
    expect(statusLightStateForAgentStatus('error')).toBe('fault');
  });
});

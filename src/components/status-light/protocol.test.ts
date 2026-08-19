import { describe, expect, it } from 'vitest';
import { AGENT_STATUSES, type AgentStatus } from '@exawatt/core';
import {
  deriveStatusLightState,
  isUnreported,
  STATUS_LIGHT_META,
  STATUS_LIGHT_READINGS,
  STATUS_LIGHT_STATES,
  statusLightStateForAgentStatus,
  statusLightWord,
  workStateReading,
  type StatusLightReading,
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

/*
 * The unlit light used to mean two opposite things: an Agent quietly waiting,
 * and an Agent nobody had heard from. These pin the second one apart from the
 * first without letting it become a sixth signal.
 */
describe('the unreported reading (ENG-010)', () => {
  const CLAIM_WORDS = /stopped|paused|lost|ended|finished|complete|waiting/i;

  it('reads a null work state as unreported, never as a work state', () => {
    expect(workStateReading(null)).toBe('unreported');
    expect(workStateReading(undefined)).toBe('unreported');
    for (const status of AGENT_STATUSES) {
      expect(workStateReading(status)).not.toBe('unreported');
      expect(workStateReading(status)).toBe(
        statusLightStateForAgentStatus(status)
      );
    }
  });

  it('keeps a genuinely idle Agent reading idle', () => {
    expect(workStateReading('idle')).toBe('off');
    expect(statusLightWord(workStateReading('idle'))).toBe('Idle');
  });

  it('gives it its own word, distinct from every signal a source can send', () => {
    const word = statusLightWord('unreported');
    expect(word).toBe('Not reported');
    expect(word).not.toBe(statusLightWord('off'));
    for (const state of STATUS_LIGHT_STATES) {
      expect(word).not.toBe(statusLightWord(state));
    }
    // Product copy, matching the rules the five signals are held to.
    expect(word.trim()).toBe(word);
    expect(word).not.toBe(word.toUpperCase());
    expect(word).not.toContain('—');
  });

  it('never claims anything about the Agent or its work', () => {
    const meta = STATUS_LIGHT_META.unreported;
    expect(meta.label).not.toMatch(CLAIM_WORDS);
    expect(meta.description).not.toMatch(CLAIM_WORDS);
    // It reports on the SOURCE's silence, not on the coworker.
    expect(meta.description).toMatch(/source/i);
    // Nor does it borrow the connection's vocabulary: freshness is a
    // separate readout and this word is not it.
    expect(`${meta.label} ${meta.description}`).not.toMatch(
      /stale|reconnect|unavailable|offline|disconnected/i
    );
  });

  it('shares the unlit register rather than minting a sixth colour', () => {
    expect(STATUS_LIGHT_META.unreported.color).toBe(
      STATUS_LIGHT_META.off.color
    );
    // Which is exactly why the word has to differ: with colour switched off,
    // the word and the mark are the only channels left.
    expect(STATUS_LIGHT_META.unreported.label).not.toBe(
      STATUS_LIGHT_META.off.label
    );
    expect(STATUS_LIGHT_META.unreported.description).not.toBe(
      STATUS_LIGHT_META.off.description
    );
  });

  it('stays out of the five-signal protocol the surfaces enumerate', () => {
    // Legends, filters, and count rows walk STATUS_LIGHT_STATES. Silence is
    // not something a source can say, so it is not one of them.
    expect(STATUS_LIGHT_STATES).toHaveLength(5);
    expect([...STATUS_LIGHT_STATES]).not.toContain('unreported');
    expect([...STATUS_LIGHT_READINGS]).toEqual([
      ...STATUS_LIGHT_STATES,
      'unreported',
    ]);
  });

  it('keeps the runtime vocabularies exhaustive over their unions', () => {
    // Compile-time: a Record over the union cannot be built from a list that
    // is missing a member, so these fail to compile if a state is added
    // without visiting this file.
    const readings: Record<StatusLightReading, true> = {
      off: true,
      active: true,
      result: true,
      'needs-you': true,
      fault: true,
      unreported: true,
    };
    const statuses: Record<AgentStatus, true> = {
      working: true,
      blocked: true,
      idle: true,
      reviewing: true,
      complete: true,
      error: true,
    };
    // Run-time: the arrays the unions are READ OFF cover the same names, so
    // neither can drift from the other.
    expect(Object.keys(readings).sort()).toEqual(
      [...STATUS_LIGHT_READINGS].sort()
    );
    expect(Object.keys(statuses).sort()).toEqual([...AGENT_STATUSES].sort());
    // Every reading has a word and a description; none can render blank.
    for (const reading of STATUS_LIGHT_READINGS) {
      expect(STATUS_LIGHT_META[reading].label.length).toBeGreaterThan(0);
      expect(STATUS_LIGHT_META[reading].description.length).toBeGreaterThan(0);
    }
    expect(new Set(STATUS_LIGHT_READINGS.map(statusLightWord)).size).toBe(
      STATUS_LIGHT_READINGS.length
    );
  });

  it('ranks silence below everything a source actually said', () => {
    for (const state of STATUS_LIGHT_STATES) {
      expect(STATUS_LIGHT_META.unreported.priority).toBeLessThanOrEqual(
        STATUS_LIGHT_META[state].priority
      );
    }
  });

  it('flags the one reading that is an absence', () => {
    expect(isUnreported('unreported')).toBe(true);
    for (const state of STATUS_LIGHT_STATES)
      expect(isUnreported(state)).toBe(false);
  });
});

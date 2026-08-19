import { describe, expect, it } from 'vitest';
import {
  GOAL_VISUAL_SCHEMA_VERSION,
  goalVisualDataUrl,
  parseGoalVisualRequest,
  parseGoalVisualResponse,
} from './contract';

const IDENTITY_KEY = 'a3f1'.repeat(16);

describe('goal visual transport contract', () => {
  it('accepts an opaque identity and nothing else', () => {
    expect(
      parseGoalVisualRequest(
        JSON.stringify({
          schemaVersion: GOAL_VISUAL_SCHEMA_VERSION,
          identityKey: IDENTITY_KEY,
        })
      )
    ).toEqual({ schemaVersion: 1, identityKey: IDENTITY_KEY });
  });

  it('refuses every field that could carry operator text', () => {
    // BUG-091: `label` was a real field until 2026-08-19, and the label is
    // text an operator may have typed. A closed object means a client that
    // regresses is refused rather than quietly transmitting it.
    for (const extra of [
      { label: 'Improve agent context summaries' },
      { projectKey: 'project:deadbeef' },
      { recentInstructions: ['secret raw instruction'] },
    ]) {
      expect(() =>
        parseGoalVisualRequest(
          JSON.stringify({
            schemaVersion: 1,
            identityKey: IDENTITY_KEY,
            ...extra,
          })
        )
      ).toThrow('unsupported fields');
    }
  });

  it('rejects an identity that is not a SHA-256 digest', () => {
    for (const identityKey of [
      'Improve agent context summaries',
      IDENTITY_KEY.toUpperCase(),
      `${IDENTITY_KEY}0`,
      IDENTITY_KEY.slice(1),
      42,
    ]) {
      expect(() =>
        parseGoalVisualRequest(
          JSON.stringify({ schemaVersion: 1, identityKey })
        )
      ).toThrow('Identity key is invalid');
    }
  });

  it('bounds the request far below a sentence', () => {
    expect(() =>
      parseGoalVisualRequest(
        JSON.stringify({
          schemaVersion: 1,
          identityKey: IDENTITY_KEY,
          transcript: 'x'.repeat(600),
        })
      )
    ).toThrow('too large');
  });

  it('round-trips the bounded private data URL response', () => {
    const dataUrl = goalVisualDataUrl(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    expect(
      parseGoalVisualResponse({ identityKey: 'a'.repeat(64), dataUrl })
    ).toEqual({ identityKey: 'a'.repeat(64), dataUrl });
    expect(() =>
      parseGoalVisualResponse({
        identityKey: 'not-a-hash',
        dataUrl,
      })
    ).toThrow('response is invalid');
  });
});

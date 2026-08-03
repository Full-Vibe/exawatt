import { describe, expect, it } from 'vitest';
import {
  GOAL_VISUAL_SCHEMA_VERSION,
  goalVisualDataUrl,
  parseGoalVisualRequest,
  parseGoalVisualResponse,
} from './contract';

describe('goal visual transport contract', () => {
  it('accepts only a bounded project key and accepted context label', () => {
    expect(
      parseGoalVisualRequest(
        JSON.stringify({
          schemaVersion: GOAL_VISUAL_SCHEMA_VERSION,
          projectKey: '  Exawatt  ',
          label: 'Improve agent context summaries',
        })
      )
    ).toEqual({
      schemaVersion: 1,
      projectKey: 'Exawatt',
      label: 'Improve agent context summaries',
    });
  });

  it('rejects raw instructions, invalid accepted labels, and oversized keys', () => {
    expect(() =>
      parseGoalVisualRequest(
        JSON.stringify({
          schemaVersion: 1,
          projectKey: 'project',
          label: 'A durable goal',
          recentInstructions: ['secret raw instruction'],
        })
      )
    ).toThrow('unsupported fields');
    expect(() =>
      parseGoalVisualRequest(
        JSON.stringify({
          schemaVersion: 1,
          projectKey: 'project',
          label: '/tmp/operator-private-context.txt',
        })
      )
    ).toThrow('Accepted label');
    expect(() =>
      parseGoalVisualRequest(
        JSON.stringify({
          schemaVersion: 1,
          projectKey: 'x'.repeat(241),
          label: 'A durable goal',
        })
      )
    ).toThrow('Project key');
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

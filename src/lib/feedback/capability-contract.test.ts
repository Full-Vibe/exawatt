import { describe, expect, it } from 'vitest';
import { parseFeedbackTriageCapability } from './capability-contract';

describe('FeedbackTriageCapabilityV1', () => {
  it('accepts capability without carrying an identity', () => {
    expect(
      parseFeedbackTriageCapability({
        schemaVersion: 1,
        canTriage: true,
        untriagedCount: 3,
      })
    ).toEqual({ schemaVersion: 1, canTriage: true, untriagedCount: 3 });
  });

  it('rejects mismatched, negative, or contradictory values', () => {
    expect(
      parseFeedbackTriageCapability({
        schemaVersion: 2,
        canTriage: true,
        untriagedCount: 3,
      })
    ).toBeNull();
    expect(
      parseFeedbackTriageCapability({
        schemaVersion: 1,
        canTriage: true,
        untriagedCount: -1,
      })
    ).toBeNull();
    expect(
      parseFeedbackTriageCapability({
        schemaVersion: 1,
        canTriage: false,
        untriagedCount: 0,
      })
    ).toBeNull();
  });
});

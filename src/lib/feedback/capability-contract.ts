export const FEEDBACK_CAPABILITY_SCHEMA_VERSION = 1 as const;

/** Browser-safe capability result; no operator identity crosses the seam. */
export interface FeedbackTriageCapabilityV1 {
  schemaVersion: typeof FEEDBACK_CAPABILITY_SCHEMA_VERSION;
  canTriage: boolean;
  untriagedCount: number | null;
}

export function parseFeedbackTriageCapability(
  value: unknown
): FeedbackTriageCapabilityV1 | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (
    input.schemaVersion !== FEEDBACK_CAPABILITY_SCHEMA_VERSION ||
    typeof input.canTriage !== 'boolean' ||
    (input.untriagedCount !== null &&
      (!Number.isSafeInteger(input.untriagedCount) ||
        Number(input.untriagedCount) < 0))
  ) {
    return null;
  }
  if (!input.canTriage && input.untriagedCount !== null) return null;
  return {
    schemaVersion: FEEDBACK_CAPABILITY_SCHEMA_VERSION,
    canTriage: input.canTriage,
    untriagedCount: input.untriagedCount as number | null,
  };
}

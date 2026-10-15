import { BUS_OPERATOR_ID, type BusSender } from '@exawatt/core';

/**
 * The operator as a sender: every `kind: operator` message (Send as operator
 * in Chatter, Direct on the Fleet board). Not a Session, so never a
 * recipient and never unread.
 */
export const BUS_OPERATOR: BusSender = Object.freeze({
  sessionId: BUS_OPERATOR_ID,
  name: 'You',
  harness: BUS_OPERATOR_ID,
  kind: 'operator' as const,
});

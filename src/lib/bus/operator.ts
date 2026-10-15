import type { BusEndpoint } from './types';

/**
 * The operator as a bus endpoint: the sender of every `kind: operator`
 * message (Send as operator in Chatter, Direct on the Fleet board). Not a
 * Session, so it is never a recipient and never carries unread.
 */
export const BUS_OPERATOR: BusEndpoint = Object.freeze({
  sessionId: 'operator',
  name: 'You',
  harness: 'operator',
});

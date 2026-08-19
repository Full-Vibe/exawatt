import type { OCGatewayOperatorScope, SourceAuthority } from '@exawatt/core';

/**
 * What Exawatt is allowed to ask a source for, and what it may do with what it
 * was granted (ENG-010 H1, ENG-033 H2).
 *
 * This is the whole security vocabulary of a connected source, on one screen,
 * with no session state anywhere near it. Two locks are declared here and a
 * third is not: the scopes Exawatt presents on the handshake, and the method
 * allowlists that stop a typo or a future edit from ever forming a wider
 * request. The real enforcement is the source's own scope grant on the device
 * record, and it is deliberately not represented here at all, because a lock
 * Exawatt owns can be edited by whoever edits this file.
 *
 * Every union below is derived from the runtime tuple beside it, so the check
 * a request passes through and the type a call site is written against cannot
 * drift apart.
 */

/**
 * Exactly the scopes H1 needs. This is the real read-only enforcement: the
 * Gateway stores the requested scopes on the device record, so a device paired
 * with these cannot send, steer, abort, or mutate a schedule no matter what
 * Exawatt later asks.
 */
export const H1_READ_SCOPES = ['operator.read'] as const;

/** Every Gateway method H1 is allowed to call. */
export const H1_READ_METHODS = [
  'health',
  'status',
  'agents.list',
  'sessions.list',
  'chat.history',
  'cron.list',
  'cron.runs',
  'tasks.list',
  // Subscriptions are observation, not command: the Gateway classifies all
  // four as `operator.read`, so following a conversation as it arrives needs
  // no authority beyond what H1 already holds.
  'sessions.subscribe',
  'sessions.unsubscribe',
  'sessions.messages.subscribe',
  'sessions.messages.unsubscribe',
] as const;

export type H1ReadMethod = (typeof H1_READ_METHODS)[number];

/**
 * Scopes a source granted write authority presents. Read travels with it
 * because a write-authorised session still observes; asking for write alone
 * would trade one authority for another rather than add one.
 */
export const H2_WRITE_SCOPES = ['operator.read', 'operator.write'] as const;

/**
 * Every Gateway method the write surface allows, and the complete set the
 * Gateway classifies as `operator.write`. Nothing here mutates a schedule,
 * changes configuration, or creates or deletes an Agent: those are
 * `operator.admin`, which Exawatt does not request, cannot represent as an
 * authority, and has no surface for.
 *
 * There is deliberately no Pause, Resume, or Stop. The project doc defers a
 * generic remote Pause until the source can name the halted scope and prove
 * resumable continuity, and a verb assembled out of these four methods would
 * be exactly the approximation it forbids.
 */
export const H2_WRITE_METHODS = [
  'chat.send',
  'chat.abort',
  'sessions.steer',
  'tasks.cancel',
] as const;

export type H2WriteMethod = (typeof H2_WRITE_METHODS)[number];

/*
 * Sets so each guard is a cheap lookup on an untrusted string, built from the
 * exported tuples so the runtime checks cannot drift from the unions.
 */
const H1_READ_METHOD_SET: ReadonlySet<string> = new Set(H1_READ_METHODS);
const H2_WRITE_METHOD_SET: ReadonlySet<string> = new Set(H2_WRITE_METHODS);

/**
 * The guards, as type predicates rather than bare booleans.
 *
 * Narrowing is the point: past one of these the method is a member of the
 * vocabulary, so the one function that hands a name to the client can require
 * that type and the compiler proves no call reached it around a guard.
 */
export function isH1ReadMethod(method: string): method is H1ReadMethod {
  return H1_READ_METHOD_SET.has(method);
}

export function isH2WriteMethod(method: string): method is H2WriteMethod {
  return H2_WRITE_METHOD_SET.has(method);
}

/** The scopes each authority presents on the handshake. One table, both tiers. */
export const SCOPES_FOR_AUTHORITY: Readonly<
  Record<SourceAuthority, readonly OCGatewayOperatorScope[]>
> = {
  read: H1_READ_SCOPES,
  write: H2_WRITE_SCOPES,
};

/**
 * The authority a set of granted scopes actually buys. Write requires the
 * write scope to be present; anything else, including an unrecognised scope
 * vocabulary from a future Gateway, is observation.
 */
export function authorityForGrantedScopes(
  scopes: readonly string[]
): SourceAuthority {
  return scopes.includes('operator.write') ? 'write' : 'read';
}

/** The narrower of two authorities. Used to intersect asked with granted. */
export function narrowerAuthority(
  left: SourceAuthority,
  right: SourceAuthority
): SourceAuthority {
  return left === 'write' && right === 'write' ? 'write' : 'read';
}

/**
 * What became of an operator's request to change a source's authority.
 *
 * `approval-required` is a first-class answer, not an error. Verified against a
 * live Gateway 2026-08-18: a device already approved at `operator.read` that
 * reconnects asking for `operator.write` is refused whether it presents its own
 * device token (`device token scope mismatch`) or the admin-capable shared
 * secret (`pairing required: device is asking for more scopes than currently
 * approved`), and the device record keeps its narrower scopes either way.
 * Raising an approved device's scope is a decision taken on the source, by the
 * person who owns it, with the source's own device tooling. Exawatt asks; it
 * cannot grant.
 *
 * `refused` is every other no. `unchanged` means Exawatt already holds the
 * authority asked for and put no question to the Gateway.
 */
export const AUTHORITY_REQUEST_OUTCOMES = [
  'granted',
  'approval-required',
  'refused',
  'unchanged',
] as const;
export type AuthorityRequestOutcome =
  (typeof AUTHORITY_REQUEST_OUTCOMES)[number];

export interface AuthorityRequestResult {
  outcome: AuthorityRequestOutcome;
  /**
   * The authority Exawatt holds now that the attempt is over. It is the
   * granted truth in every branch, so a caller that reads nothing else still
   * cannot act on authority the source did not give.
   */
  authority: SourceAuthority;
  /** One operator-facing sentence: what happened, and what to do about it. */
  message: string;
}

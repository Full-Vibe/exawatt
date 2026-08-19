import type { SourceFailureClass } from '@exawatt/core';
import type { GatewayBootstrapFailure } from './gateway-bootstrap';
import type { SshTunnelFailureClass } from './ssh-tunnel';

/**
 * What kind of no was that (ENG-010)?
 *
 * Every layer under a configured source refuses in its own vocabulary — the
 * tunnel owner's failure classes, the bootstrap's, and whatever sentence the
 * Gateway itself chose — and each of those has to become one of the product's
 * `SourceFailureClass` values, because the class is what decides the operator's
 * next step. Getting it wrong is expensive in exactly one direction: a refused
 * credential reported as `gateway-down` sends someone to check a server that is
 * answering perfectly well.
 *
 * One owner, because the mechanism was already written twice. Two independent
 * lists of remote wording, each with its own loop, decided two different
 * questions, and the lists overlapped in four entries that were maintained
 * apart. The lists stay separate below — they answer genuinely different
 * questions — but the matching is one function, and both are used in one
 * direction only: a matched signal can make a refusal more informative, never
 * more permissive.
 */

/**
 * Transport failures classified by the tunnel owner, translated into the
 * product's own failure vocabulary.
 *
 * `invalid-target` becomes `unknown` on purpose: it is a configuration fault on
 * this machine, not an observation about the server, and calling it
 * `host-unreachable` would send the operator to check a network that is fine.
 */
export const TUNNEL_FAILURE_TO_SOURCE_FAILURE: Readonly<
  Record<SshTunnelFailureClass, SourceFailureClass>
> = {
  'invalid-target': 'unknown',
  'host-unreachable': 'host-unreachable',
  'auth-rejected': 'auth-rejected',
  'gateway-down': 'gateway-down',
  unknown: 'unknown',
};

/**
 * Bootstrap failures translated the same way.
 *
 * `openclaw-missing` is `gateway-down`: the login worked and nothing is serving
 * a Gateway there. `token-unavailable` is `auth-rejected`: the source declares
 * no shared secret, so Exawatt has no credential to present, and the operator
 * resolves it the same way as any other credential problem (the documented
 * paste-a-token fallback). `unreadable-config` stays `unknown` rather than
 * guessing which of several causes applied.
 */
export const BOOTSTRAP_FAILURE_TO_SOURCE_FAILURE: Readonly<
  Record<GatewayBootstrapFailure, SourceFailureClass>
> = {
  'invalid-target': 'unknown',
  unreachable: 'host-unreachable',
  'auth-rejected': 'auth-rejected',
  'openclaw-missing': 'gateway-down',
  'token-unavailable': 'auth-rejected',
  'unreadable-config': 'unknown',
  unknown: 'unknown',
};

/**
 * Does a source's refusal mention any of these?
 *
 * Matching a remote string is weak evidence, which is why every caller below
 * uses it in one direction. No branch reachable from here grants authority or
 * keeps a credential that would otherwise be discarded, so a Gateway that
 * phrases a refusal differently costs the operator a clearer sentence and
 * nothing else.
 */
function refusalMentions(
  sentence: string,
  signals: readonly string[]
): boolean {
  const text = sentence.toLowerCase();
  return signals.some(signal => text.includes(signal));
}

/**
 * Words a Gateway uses when it is refusing a credential rather than failing
 * to serve one.
 *
 * Confirmed against a live Gateway: a device token presented by a device the
 * Gateway did not issue it to comes back as "unauthorized: device token
 * mismatch (rotate/reissue device token)", and a mis-encoded public key as
 * "device identity mismatch". Both were being reported to the operator as
 * `gateway-down`, which is a sentence about a healthy server and a next step
 * that leads nowhere.
 */
const CREDENTIAL_REFUSAL_SIGNALS = [
  'device token',
  'device identity',
  'unauthorized',
  'not_paired',
  'not paired',
  'pairing required',
  'pairing_required',
  'forbidden',
  'invalid token',
  'token mismatch',
  'credential',
  'scope mismatch',
] as const;

/**
 * Signals that a no meant "a human must approve this on the source" rather
 * than "this failed".
 *
 * Deliberately a shorter list than the credential one, and not a subset of it.
 * They answer different questions: this one asks whether an operator has
 * something to go and do, the other asks whether the credential Exawatt saved
 * is still worth keeping.
 */
const APPROVAL_REQUIRED_SIGNALS = [
  'not_paired',
  'pairing required',
  'pairing_required',
  'scope mismatch',
  'scope upgrade',
  'approval',
] as const;

/**
 * What a refused handshake actually was.
 *
 * `auth-rejected` only when the source said something about the credential.
 * Everything else stays `gateway-down`, including a refusal with no sentence
 * at all: guessing "credential" over an unexplained refusal would send the
 * operator to re-pair a device that was never the problem, and would make
 * Exawatt discard a credential that still works.
 */
export function classifyHandshakeFailure(
  sentence: string | null
): SourceFailureClass {
  if (sentence === null) return 'gateway-down';
  return refusalMentions(sentence, CREDENTIAL_REFUSAL_SIGNALS)
    ? 'auth-rejected'
    : 'gateway-down';
}

/**
 * Whether a refused authority request left an approval standing on the source.
 *
 * `approval-required` is a better answer than `refused` because it tells the
 * operator there is something to go and do; it never widens what Exawatt may
 * do, because the authority a caller records still comes from a completed
 * handshake and not from this.
 */
export function classifyAuthorityRefusal(
  message: string
): 'approval-required' | 'refused' {
  return refusalMentions(message, APPROVAL_REQUIRED_SIGNALS)
    ? 'approval-required'
    : 'refused';
}

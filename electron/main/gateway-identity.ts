import type { AgentSourceTopologySnapshot } from '@exawatt/core';
import { MAX_ID_LENGTH, MAX_TEXT_LENGTH, isRecord } from './untrusted-input';

/**
 * Which installation is behind a configured source (ENG-010 C3).
 *
 * The concept had two owners and they disagreed. `ConnectedGatewaySession`
 * observed an identity, sanitised it one way, and compared it for drift;
 * `ConnectedSourceRuntime` persisted the same object into the projection plan,
 * sanitised it a second, weaker way on the way back off disk, and compared it
 * field by field to decide whether to rewrite the file. Two sanitisers over one
 * shape is how a value that reads as equal in one place and different in
 * another gets born, and the whole point of a bound identity is that both
 * places agree about it.
 *
 * So identity lives here: what it is, how it is read from anywhere untrusted,
 * when two of them are the same installation, and when a new one is a
 * different installation wearing the same address.
 */

/**
 * Gateway identity, as observed. Only the source's own version string and its
 * configured native Agent ids: display names are never part of identity,
 * because renaming a coworker on the source must not read as a different
 * installation, and two installations may legitimately use the same names.
 */
export interface GatewayIdentity {
  /** The source's reported version, or '' when it declared none. */
  version: string;
  /** Sorted configured native Agent ids. */
  nativeAgentIds: readonly string[];
}

export interface GatewayIdentityDrift {
  previous: GatewayIdentity;
  observed: GatewayIdentity;
}

/** A roster larger than this is a hostile or broken peer, not an installation. */
const MAX_IDENTITY_AGENTS = 500;

/**
 * An identity from anywhere Exawatt does not control, made safe to compare.
 *
 * It arrives either from a remote peer or from a file on disk, so it is read
 * like any other untrusted input: non-strings, blanks, over-long ids, and
 * duplicates are dropped, and the roster is sorted the way an observed one is,
 * so a writer that stored the ids in another order cannot read as a different
 * installation. Nothing usable collapses to null, which is the same as never
 * having seen this source: no drift rather than a false one.
 */
export function normalizeGatewayIdentity(
  value: unknown
): GatewayIdentity | null {
  if (!isRecord(value)) return null;
  const version =
    typeof value.version === 'string'
      ? value.version.trim().slice(0, MAX_TEXT_LENGTH)
      : '';
  const candidates = Array.isArray(value.nativeAgentIds)
    ? value.nativeAgentIds
    : [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates.slice(0, MAX_IDENTITY_AGENTS)) {
    if (typeof candidate !== 'string') continue;
    if (candidate.trim().length === 0 || candidate.length > MAX_ID_LENGTH) {
      continue;
    }
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    ids.push(candidate);
  }
  if (ids.length === 0 && version.length === 0) return null;
  return { version, nativeAgentIds: ids.sort() };
}

/** The identity one authoritative snapshot reports, with the version beside it. */
export function gatewayIdentityOf(
  snapshot: AgentSourceTopologySnapshot,
  version: string
): GatewayIdentity {
  return {
    version,
    nativeAgentIds: snapshot.agents
      .filter(agent => agent.discoveryState === 'configured')
      .map(agent => agent.nativeAgentId)
      .sort(),
  };
}

/**
 * Two observations of the same installation, in every field identity carries.
 * Both rosters are sorted by construction, so this is an ordered comparison on
 * purpose rather than a set comparison that would hide a duplicate.
 */
export function sameGatewayIdentity(
  left: GatewayIdentity,
  right: GatewayIdentity
): boolean {
  return (
    left.version === right.version &&
    left.nativeAgentIds.length === right.nativeAgentIds.length &&
    left.nativeAgentIds.every((id, index) => id === right.nativeAgentIds[index])
  );
}

/**
 * Is the Gateway behind this source a different installation than the one the
 * projection was bound to?
 *
 * The brief leaves the threshold to the implementation, and the two candidate
 * signals mean different things:
 *
 * - A changed **version** is an ordinary upgrade. Treating it as drift would
 *   ask the operator to remap every time they update OpenClaw, which trains
 *   them to dismiss the one prompt that matters. It is carried in the reported
 *   identity so the operator sees it, but it never decides on its own.
 * - A changed **roster** is ordinary source-side work: Agents get added and
 *   retired, and the authoritative resnapshot already replaces the old tree.
 *
 * What no ordinary change explains is a roster with *nothing* in common with
 * the one Exawatt was observing. That is a different installation wearing the
 * same alias, and rebinding to it would silently move the operator's coworkers
 * onto a machine they never connected. So drift is disjointness, and the caller
 * only reports it: remap or detach is the operator's decision.
 */
export function gatewayIdentityDrifted(
  previous: GatewayIdentity,
  observed: GatewayIdentity
): boolean {
  if (previous.nativeAgentIds.length === 0) return false;
  if (observed.nativeAgentIds.length === 0) return true;
  const known = new Set(previous.nativeAgentIds);
  return !observed.nativeAgentIds.some(id => known.has(id));
}

/**
 * Open a coworker the roster names, reading the roster again when it must
 * (ENG-033 H2).
 *
 * Two gestures land here: Connect finishing with "open this Agent", and a
 * request to open a coworker by id that the last-known roster may not have
 * yet. Both wait on a roster read that crosses to the main process and can
 * take seconds, and both then move the operator to the coworker's tab.
 *
 * The move is the gesture's, so the claim that authorises it is taken HERE,
 * before the read (BUG-018). Taken after it, as it once was, the claim
 * recorded wherever the operator had gone in the meantime, and the coworker
 * tab pulled him back from the Agent he had moved on to (BUG-192). A stale
 * claim still opens the tab, quietly, where it belongs.
 */
import {
  operatorPosition,
  type OperatorMoveClaim,
} from '@/components/nav/operator-position';
import type {
  RemoteCoworkerTile,
  RemoteRoster,
} from './remote-agent/remote-agent-roster';
import type { RemoteAgentOpenRef } from './use-workspace-state';

/** Which coworker is wanted, asked of either shape the roster comes in. */
type RosterCoworkerMatch = (candidate: {
  agentId: string;
  sourceId: string;
  nativeAgentId: string;
}) => boolean;

export interface RosterCoworkerOpener {
  /** The last-known roster, read at the moment it is consulted. */
  known: () => readonly RemoteCoworkerTile[];
  /** Re-read the roster. Null is a failed read, never "not there". */
  refresh: () => Promise<RemoteRoster | null>;
  open: (ref: RemoteAgentOpenRef, claim: OperatorMoveClaim) => Promise<string>;
}

export interface RosterCoworkerOptions {
  /**
   * Open straight from the last-known roster when it already names the
   * coworker. Connect does not: it has just rewritten the mapping, and the
   * known row may still carry the old Project.
   */
  preferKnown: boolean;
  /** False once the asker has gone away; the read's answer is then dropped. */
  stillWanted?: () => boolean;
}

function refFromTile(tile: RemoteCoworkerTile): RemoteAgentOpenRef {
  return {
    agentId: tile.agentId,
    nativeAgentId: tile.nativeAgentId,
    sourceId: tile.sourceId,
    displayName: tile.name,
    projectId: tile.projectId,
    projectLabel: tile.projectLabel,
  };
}

/** Resolves to the opened tab's id, or null when no roster names the coworker. */
export async function openRosterCoworker(
  match: RosterCoworkerMatch,
  opener: RosterCoworkerOpener,
  options: RosterCoworkerOptions
): Promise<string | null> {
  const claim = operatorPosition.claimHere();
  const fromKnown = (): RemoteAgentOpenRef | null => {
    const tile = opener.known().find(candidate => match(candidate));
    return tile ? refFromTile(tile) : null;
  };
  if (options.preferKnown) {
    const known = fromKnown();
    if (known) return opener.open(known, claim);
  }
  const refreshed = await opener.refresh();
  if (options.stillWanted && !options.stillWanted()) return null;
  const agent = refreshed?.agents.find(candidate =>
    match({
      agentId: candidate.id,
      sourceId: candidate.source.id,
      nativeAgentId: candidate.nativeAgentId,
    })
  );
  // A failed read is not "not there": a change tick's read may have landed
  // the coworker in the last-known roster while this one was in flight.
  const ref: RemoteAgentOpenRef | null = agent
    ? {
        agentId: agent.id,
        nativeAgentId: agent.nativeAgentId,
        sourceId: agent.source.id,
        displayName: agent.displayName,
        projectId: agent.projectId,
        projectLabel: agent.projectLabel,
      }
    : fromKnown();
  return ref ? opener.open(ref, claim) : null;
}

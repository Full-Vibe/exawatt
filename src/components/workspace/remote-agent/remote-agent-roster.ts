/**
 * The connected roster, as the workspace reads it (ENG-033 H2).
 *
 * Pure: no React, no IPC, no clock. It turns what the source reported into
 * what a tile and a pane may say, and it keeps three things apart the way the
 * project doc keeps them apart — placement is infrastructure, connection is
 * Exawatt's observation freshness, and work state is the coworker's own D40
 * signal. Nothing here may conclude anything about a coworker's work from
 * Exawatt's connection to its source.
 *
 * The one judgement it does make is about ABSENCE, and it makes it narrowly:
 * a source Exawatt no longer has a record of was detached by the operator and
 * its coworkers are gone; a source that is still configured but reports no
 * such Agent has told Exawatt nothing, which is not the same as telling it
 * the Agent ended.
 */

import { statusLightStateForAgentStatus } from '@/components/status-light';
import type { StatusLightState } from '@/components/status-light';
import type {
  AgentSourcePlacement,
  ConnectedSourceView,
  SourceConnectionState,
  SourceFailureClass,
} from '@exawatt/core';
import type {
  RemoteAgentView,
  SourceCommandAuthorityView,
} from '@/types/electron';
import type {
  RemoteConnectionView,
  WriteAuthority,
} from './remote-agent-model';

/**
 * One connected coworker, projected for the surfaces that paint it.
 *
 * Every field is the source's own report. `workState` is D40, in the same
 * vocabulary a local Agent uses, so Team can put a coworker beside a Session
 * without a second status language.
 */
export interface RemoteCoworkerTile {
  /** Exawatt's id for the projected coworker; the bridge's address. */
  agentId: string;
  nativeAgentId: string;
  sourceId: string;
  name: string;
  /** The Project this Agent was mapped to at Connect time. */
  projectId: string;
  projectLabel: string;
  sourceName: string;
  placement: AgentSourcePlacement;
  /** `Local` | `Remote` | `Exawatt Cloud`. Quiet metadata, never a status. */
  placementLabel: string;
  workState: StatusLightState;
  connection: RemoteConnectionView;
  /** What the source says this device may do. Read, never assumed. */
  authority: WriteAuthority;
}

/** Everything the workspace has read about connected sources right now. */
export interface RemoteRoster {
  /** Sources Exawatt still holds a record of. */
  sources: readonly ConnectedSourceView[];
  agents: readonly RemoteAgentView[];
  authorities: readonly SourceCommandAuthorityView[];
  /**
   * False until the first read answers. An empty roster before that is
   * "nothing read yet", not "no coworkers", and the surfaces say so.
   */
  loaded: boolean;
}

export const EMPTY_REMOTE_ROSTER: RemoteRoster = {
  sources: [],
  agents: [],
  authorities: [],
  loaded: false,
};

/**
 * Where the source stands on this device's authority to write.
 *
 * A source with no authority row has not been read, which is its own state:
 * `unobserved` offers Reconnect, where `not-requested` offers to ask. Reading
 * the absence as "read-only" would put a request button in front of an
 * operator whose device may already hold write access.
 */
export function writeAuthorityFor(
  sourceId: string,
  authorities: readonly SourceCommandAuthorityView[]
): WriteAuthority {
  const row = authorities.find(entry => entry.sourceId === sourceId);
  if (!row) return 'unobserved';
  if (row.authority === 'write') return 'granted';
  return row.awaitingApproval ? 'approval-pending' : 'not-requested';
}

function connectionViewOf(agent: RemoteAgentView): RemoteConnectionView {
  return {
    state: agent.connection.state as SourceConnectionState,
    label: agent.connection.label,
    stalePresentation: agent.connection.stalePresentation,
    failure: agent.connection.failure as SourceFailureClass | null,
  };
}

/** The roster's coworkers, ordered by name so the grid is scannable. */
export function projectCoworkers(roster: RemoteRoster): RemoteCoworkerTile[] {
  return roster.agents
    .map(agent => ({
      agentId: agent.id,
      nativeAgentId: agent.nativeAgentId,
      sourceId: agent.source.id,
      name: agent.displayName,
      projectId: agent.projectId,
      projectLabel: agent.projectLabel,
      sourceName: agent.source.displayName,
      placement: agent.placement,
      placementLabel: agent.placementLabel,
      // D40, from the source. Not derived from the connection, ever.
      workState: statusLightStateForAgentStatus(agent.workState),
      connection: connectionViewOf(agent),
      authority: writeAuthorityFor(agent.source.id, roster.authorities),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * What a coworker tab resolves to right now.
 *
 * `reading` is the honest state before the first roster read answers: the tab
 * is real, and Exawatt has not yet asked. It is not a missing Agent.
 */
export type RemoteAgentResolution =
  | { kind: 'reading' }
  | { kind: 'present'; agent: RemoteCoworkerTile }
  | {
      kind: 'missing';
      /**
       * `source-detached`: the operator removed Exawatt's record of the
       * source, so this coworker has no way back and the tab is a leftover.
       * `agent-not-reported`: the source is still configured and did not name
       * this Agent. That is silence, not an ending, and the copy must not
       * turn it into one.
       */
      reason: 'source-detached' | 'agent-not-reported';
      name: string;
      sourceName: string | null;
    };

export function resolveRemoteAgentTab(
  tab: { agentId: string; sourceId: string; title: string },
  roster: RemoteRoster
): RemoteAgentResolution {
  if (!roster.loaded) return { kind: 'reading' };
  const agent = projectCoworkers(roster).find(
    candidate => candidate.agentId === tab.agentId
  );
  if (agent) return { kind: 'present', agent };
  const source = roster.sources.find(entry => entry.id === tab.sourceId);
  return {
    kind: 'missing',
    reason: source ? 'agent-not-reported' : 'source-detached',
    name: tab.title,
    sourceName: source?.displayName ?? null,
  };
}

/** One line per missing state: what is true, and what completes it. */
export const REMOTE_MISSING_COPY: Readonly<
  Record<
    Extract<RemoteAgentResolution, { kind: 'missing' }>['reason'],
    { headline: string; detail: string }
  >
> = {
  'source-detached': {
    headline: 'This source is no longer connected to Exawatt',
    detail:
      'The Agent, its history, and its automations are untouched on the machine that runs it. Connect the source again to read it here.',
  },
  'agent-not-reported': {
    headline: 'The source is not reporting this Agent right now',
    detail:
      'Its work is unaffected. Open source details to reconnect, remap, or detach it.',
  },
};

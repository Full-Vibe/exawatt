'use client';

/**
 * A coworker tab's pane (ENG-033 H2).
 *
 * The workspace stage renders exactly one thing per tab. For a Session that is
 * a terminal; for a coworker it is this, and never a terminal — there is no
 * process here to attach to.
 *
 * The pane's whole job is to decide which of three honest states the tab is
 * in before the surface ever mounts:
 *
 * - Exawatt has not read the roster yet, and says only that;
 * - the roster names this Agent, and the surface takes over;
 * - the roster does not, which is a missing state with a reason and a next
 *   step, not an empty pane.
 */

import {
  RemoteAgentSurface,
  type RemoteAgentBridge,
} from './remote-agent-surface';
import {
  REMOTE_MISSING_COPY,
  resolveRemoteAgentTab,
  type RemoteRoster,
} from './remote-agent-roster';
import { WORKSPACE_HUD as HUD, withThemeAlpha } from '../workspace-theme';

export interface RemoteAgentPaneProps {
  tab: {
    id: string;
    title: string;
    agentId: string;
    sourceId: string;
    projectLabel: string;
  };
  roster: RemoteRoster;
  /** Injected in tests and previews; defaults to the Electron bridge. */
  bridge?: RemoteAgentBridge | null;
  onRequestWriteAccess?: (sourceId: string) => void;
  onReconnect?: (sourceId: string) => void;
}

export function RemoteAgentPane({
  tab,
  roster,
  bridge,
  onRequestWriteAccess,
  onReconnect,
}: RemoteAgentPaneProps) {
  const resolution = resolveRemoteAgentTab(tab, roster);

  if (resolution.kind === 'present') {
    const agent = resolution.agent;
    return (
      <div
        className="h-full min-h-0 overflow-y-auto p-3"
        data-remote-agent-pane={tab.agentId}
      >
        <RemoteAgentSurface
          agent={{
            id: agent.agentId,
            name: agent.name,
            project: agent.projectLabel || agent.sourceName,
            workState: agent.workState,
            placement: agent.placement,
            sourceName: agent.sourceName,
          }}
          authority={agent.authority}
          bridge={bridge}
          connection={agent.connection}
          onReconnect={
            onReconnect ? () => onReconnect(agent.sourceId) : undefined
          }
          onRequestWriteAccess={
            onRequestWriteAccess
              ? () => onRequestWriteAccess(agent.sourceId)
              : undefined
          }
        />
      </div>
    );
  }

  const copy =
    resolution.kind === 'reading'
      ? {
          headline: `Opening ${tab.title}`,
          detail: 'Reading what this source reports.',
        }
      : REMOTE_MISSING_COPY[resolution.reason];

  return (
    <div
      className="flex h-full min-h-0 items-center justify-center p-6"
      data-remote-agent-pane={tab.agentId}
      data-remote-agent-state={
        resolution.kind === 'reading' ? 'reading' : resolution.reason
      }
    >
      <section
        className="flex max-w-md flex-col gap-2 rounded-lg border p-4"
        style={{
          borderColor: withThemeAlpha(HUD.textDim, 0.18),
          background: HUD.bg.panelFill,
        }}
      >
        <p className="text-base font-semibold" style={{ color: HUD.text }}>
          {tab.title}
        </p>
        <p className="text-sm" style={{ color: HUD.text }}>
          {copy.headline}
        </p>
        <p className="text-chrome-meta" style={{ color: HUD.textDim }}>
          {copy.detail}
        </p>
      </section>
    </div>
  );
}

'use client';

/**
 * A coworker tab's pane (ENG-033 H2).
 *
 * The workspace stage renders exactly one thing per tab. For a Session that is
 * a terminal; for a coworker it is this, and never a terminal — there is no
 * process here to attach to.
 *
 * The pane sits on the stage the way a terminal pane does: it takes its
 * `layout` and stays mounted while hidden. The operator's draft, the outbox
 * that has not been delivered yet, and the transcript already read all live
 * in the surface below, so unmounting on a tab switch threw all three away
 * and re-read the history over the tunnel on the way back (BUG-148).
 *
 * Its own job is to decide which of three honest states the tab is in before
 * the surface ever mounts:
 *
 * - Exawatt has not read the roster yet, and says only that;
 * - the roster names this Agent, and the surface takes over;
 * - the roster does not, which is a missing state with a reason and a next
 *   step, not an empty pane.
 */

import {
  RemoteAgentSurface,
  type RemoteAgentBridge,
  type WriteAccessAnswer,
} from './remote-agent-surface';
import {
  REMOTE_MISSING_COPY,
  resolveRemoteAgentTab,
  type RemoteRoster,
} from './remote-agent-roster';
import { LAYOUT_CLASS, type PaneLayout } from '../pane-layout';
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
  /** Where the pane sits on the stage. Hidden keeps it mounted. */
  layout?: PaneLayout;
  /** Pressing an inactive pane selects its tab, as it does for a terminal. */
  onActivate?: () => void;
  /** Injected in tests and previews; defaults to the Electron bridge. */
  bridge?: RemoteAgentBridge | null;
  onRequestWriteAccess?: (
    sourceId: string
  ) => void | Promise<WriteAccessAnswer | null>;
  /** Runs the server's own approval of Exawatt's own request, then asks. */
  onApproveWriteAccess?: (
    sourceId: string
  ) => Promise<WriteAccessAnswer | null>;
  onReconnect?: (sourceId: string) => void;
}

export function RemoteAgentPane({
  tab,
  roster,
  layout = 'full',
  onActivate,
  bridge,
  onRequestWriteAccess,
  onApproveWriteAccess,
  onReconnect,
}: RemoteAgentPaneProps) {
  return (
    <div
      data-pane={layout}
      className={LAYOUT_CLASS[layout]}
      style={
        layout === 'right'
          ? { borderLeft: `1px solid ${HUD.strokeSoft}` }
          : undefined
      }
      onMouseDown={layout !== 'hidden' ? onActivate : undefined}
    >
      <div className="absolute inset-0 min-h-0">
        <RemoteAgentPaneBody
          bridge={bridge}
          onApproveWriteAccess={onApproveWriteAccess}
          onReconnect={onReconnect}
          onRequestWriteAccess={onRequestWriteAccess}
          roster={roster}
          tab={tab}
        />
      </div>
    </div>
  );
}

function RemoteAgentPaneBody({
  tab,
  roster,
  bridge,
  onRequestWriteAccess,
  onApproveWriteAccess,
  onReconnect,
}: Omit<RemoteAgentPaneProps, 'layout' | 'onActivate'>) {
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
          onApproveWriteAccess={
            onApproveWriteAccess
              ? () => onApproveWriteAccess(agent.sourceId)
              : undefined
          }
          onRequestWriteAccess={
            onRequestWriteAccess
              ? () => onRequestWriteAccess(agent.sourceId)
              : undefined
          }
          sendAccess={agent.sendAccess}
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

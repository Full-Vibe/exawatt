import {
  STATUS_LIGHT_META,
  type StatusLightState,
} from '@/components/status-light/protocol';
import { STATUS_THEME_COLOR } from '@/components/status-light/status-light';
import type { SessionDelegation } from '@/types/electron';
import {
  sessionGlyphState,
  sessionStatusLightState,
  sessionTurnFacts,
} from './session-status';
import { tabIsLive, type Project } from './use-workspace-state';
import type { FleetAttentionSignals } from './status-glyphs';
import { withThemeAlpha } from './workspace-theme';

export type ProjectRibbonSignal =
  | 'fault'
  | 'needs-you'
  | 'working'
  | 'result'
  | 'quiet';

export const PROJECT_RIBBON_SIGNAL_COPY: Record<ProjectRibbonSignal, string> = {
  fault: 'Agent fault',
  'needs-you': 'Needs your attention',
  working: 'Work in progress',
  result: 'Results ready',
  quiet: 'Quiet',
};

export function deriveProjectRibbonSignal({
  project,
  summaries,
  attention,
  activity,
  engaged,
  delegation,
}: {
  project: Project;
  summaries: Record<string, string>;
  attention: FleetAttentionSignals;
  activity: Record<string, boolean>;
  engaged: Record<string, boolean>;
  delegation: Record<string, SessionDelegation>;
}): ProjectRibbonSignal {
  // The Project dot is the ONLY signal a collapsed Project shows, so it must
  // be the same truth its Sessions would show if expanded. It used to
  // re-derive that truth from raw activity/attention here, and drifted: it
  // could read "Results ready" for a Session whose harness reported a turn
  // still open, or one parked on a question the operator had not answered.
  // Route every tab through the shared derivation and encode the strongest.
  let strongest: StatusLightState = 'off';
  for (const tab of project.tabs) {
    const light = tabStatusLight({
      tab,
      summaries,
      attention,
      activity,
      engaged,
      delegation,
    });
    if (STATUS_LIGHT_META[light].priority > STATUS_LIGHT_META[strongest].priority) {
      strongest = light;
    }
  }
  return strongest === 'off'
    ? 'quiet'
    : strongest === 'active'
      ? 'working'
      : strongest;
}

/** One Session's light, derived exactly as the tab strip derives it. */
function tabStatusLight({
  tab,
  summaries,
  attention,
  activity,
  engaged,
  delegation,
}: {
  tab: Project['tabs'][number];
  summaries: Record<string, string>;
  attention: FleetAttentionSignals;
  activity: Record<string, boolean>;
  engaged: Record<string, boolean>;
  delegation: Record<string, SessionDelegation>;
}): StatusLightState {
  // The ribbon's per-tab light reads local Session truth, and every input
  // here is keyed by a PTY incarnation a coworker does not have. It takes the
  // neutral mark rather than one derived from signals that were never about
  // it; its real D40 state comes from the roster, and Team and its own pane
  // are where that is read.
  if (tab.kind === 'remote-agent') return 'off';
  if (tab.lifecycle === 'failed') return 'fault';
  // A stopped Session carries no live turn state; its own row says so, and at
  // Project altitude it must not masquerade as a pending result.
  if (!tabIsLive(tab) || !tab.sessionId) return 'off';
  return sessionStatusLightState({
    state: sessionGlyphState(
      sessionTurnFacts(tab, { activity, engaged, summaries, delegation })
    ),
    attention: attention[tab.sessionId],
  });
}

/** Constant footprint: signal churn never moves later close targets. */
export function ProjectRibbonSignalMark({
  signal,
}: {
  signal: ProjectRibbonSignal;
}) {
  const protocolState: StatusLightState =
    signal === 'quiet' ? 'off' : signal === 'working' ? 'active' : signal;
  const signalColor = STATUS_THEME_COLOR[protocolState];
  return (
    <span
      data-project-signal={signal}
      aria-hidden
      title={
        signal === 'quiet' ? undefined : PROJECT_RIBBON_SIGNAL_COPY[signal]
      }
      className={`inline-block size-1.5 shrink-0 rounded-full ${
        signal === 'working' ? 'delegation-dot' : ''
      }`}
      style={{
        color: signalColor,
        background: signalColor,
        opacity: signal === 'quiet' ? 0 : 1,
        boxShadow:
          signal === 'needs-you' || signal === 'fault'
            ? `0 0 0 2px ${withThemeAlpha(signalColor, 0.14)}`
            : undefined,
      }}
    />
  );
}

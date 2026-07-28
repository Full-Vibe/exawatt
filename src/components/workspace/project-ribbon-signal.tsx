import {
  deriveStatusLightState,
  STATUS_LIGHT_META,
  type StatusLightState,
} from '@/components/status-light/protocol';
import type { SessionDelegation } from '@/types/electron';
import { attentionNeedsOperator } from './status-glyphs';
import { sessionDelegationBusy } from './session-status';
import type { Project } from './use-workspace-state';
import type { SessionAttentionSignal } from './status-glyphs';

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
  attention: Record<string, SessionAttentionSignal>;
  activity: Record<string, boolean>;
  engaged: Record<string, boolean>;
  delegation: Record<string, SessionDelegation>;
}): ProjectRibbonSignal {
  let fault = false;
  let needsOperator = false;
  let result = false;
  let working = false;

  for (const tab of project.tabs) {
    if (tab.lifecycle === 'failed') fault = true;
    if (tab.sessionId && attentionNeedsOperator(attention[tab.sessionId])) {
      needsOperator = true;
    }
    const tabWorking = !!(
      tab.sessionId &&
      (activity[tab.sessionId] ||
        sessionDelegationBusy(delegation[tab.sessionId]))
    );
    if (tabWorking) working = true;
    if (
      tab.sessionId &&
      !tabWorking &&
      (engaged[tab.sessionId] || !!summaries[tab.durableSessionId])
    ) {
      result = true;
    }
  }

  const encoded = deriveStatusLightState({
    fault,
    needsOperator,
    hasResult: result,
    active: working,
  });
  return encoded === 'off'
    ? 'quiet'
    : encoded === 'active'
      ? 'working'
      : encoded;
}

/** Constant footprint: signal churn never moves later close targets. */
export function ProjectRibbonSignalMark({
  signal,
}: {
  signal: ProjectRibbonSignal;
}) {
  const protocolState: StatusLightState =
    signal === 'quiet' ? 'off' : signal === 'working' ? 'active' : signal;
  const signalColor = STATUS_LIGHT_META[protocolState].color;
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
            ? `0 0 0 2px ${signalColor}24`
            : undefined,
      }}
    />
  );
}

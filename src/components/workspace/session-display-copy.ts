import { sessionSource } from './harnesses';
import {
  isSessionLifecyclePhase,
  sessionLifecyclePresentation,
} from '@exawatt/ui-model';
import {
  attentionNeedsOperator,
  type SessionAttentionSignal,
  type SessionGlyphState,
} from './session-status';

export {
  NEW_AGENT_TITLE,
  sessionDisplayCopy,
  type SessionDisplayCopy,
  type SessionDisplayCopyInput,
} from '@exawatt/ui-model';

/**
 * Truthful, source-agnostic current-state copy for a comparison card. A
 * Session with no process behind it reads its line from the shared
 * lifecycle vocabulary (ENG-015 S6.4), the same line the pane prints.
 */
export function sessionCurrentStateCopy(input: {
  harness: string;
  live: boolean;
  lifecycle: string;
  exitCode?: number | null;
  exitSignal?: string | null;
  harnessSessionId?: string | null;
  glyphState: SessionGlyphState;
  attention?: SessionAttentionSignal;
}): string {
  const source = sessionSource(input.harness);
  if (source.unavailableReason) return source.unavailableReason;
  const lifecycle = isSessionLifecyclePhase(input.lifecycle)
    ? sessionLifecyclePresentation({
        lifecycle: input.lifecycle,
        exitCode: input.exitCode ?? null,
        exitSignal: input.exitSignal,
        harness: input.harness,
        harnessSessionId: input.harnessSessionId ?? null,
      })
    : null;
  if (
    lifecycle?.line &&
    (input.lifecycle === 'failed' || input.lifecycle === 'resuming')
  ) {
    return lifecycle.line;
  }
  if (attentionNeedsOperator(input.attention)) {
    return input.attention?.kind === 'roadmap-blocked'
      ? 'Roadmap work is blocked'
      : 'Waiting for your response';
  }
  if (!input.live) {
    if (input.lifecycle === 'draft') return 'Ready to start';
    return lifecycle?.line ?? 'Stopped · history kept';
  }
  if (input.glyphState === 'working') {
    return input.harness === 'shell' ? 'Shell is active' : 'Agent is working';
  }
  if (input.glyphState === 'done') return 'Turn complete';
  if (input.glyphState === 'fresh') return 'Ready for instructions';
  return 'Shell is idle';
}

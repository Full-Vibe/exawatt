import {
  isSessionLifecyclePhase,
  sessionLifecyclePresentation,
} from '@exawatt/ui-model';
import type { PtyHarness } from '@/types/electron';
import {
  attentionNeedsOperator,
  type SessionAttentionSignal,
  type SessionGlyphState,
} from './session-status';

export const NEW_AGENT_TITLE = 'New agent';

export interface SessionDisplayCopyInput {
  harness: PtyHarness;
  title: string;
  titleKind: 'default' | 'operator';
  lifecycle: string;
  summary?: string | null;
}

export interface SessionDisplayCopy {
  /** The copy every Session surface must render as its visible identity. */
  primary: string;
  /** A durable context cue beneath an operator-authored title, when distinct. */
  context: string | null;
  primaryKind: 'context' | 'fallback' | 'operator' | 'shell';
}

function clean(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  return normalized || null;
}

/**
 * Total Session identity projection.
 *
 * Agent Source already has its glyph, so provider labels such as `Codex` and
 * `Claude Code` are not useful primary copy. A server-owned context label wins;
 * an explicit operator rename stays primary; and the final fallback is always
 * `New agent`. No tab or Sessions card is allowed to collapse to icons alone.
 */
export function sessionDisplayCopy(
  input: SessionDisplayCopyInput
): SessionDisplayCopy {
  const title = clean(input.title);
  const summary = clean(input.summary);

  if (input.lifecycle === 'draft') {
    return {
      primary: NEW_AGENT_TITLE,
      context: null,
      primaryKind: 'fallback',
    };
  }

  if (input.harness === 'shell') {
    return {
      primary: title ?? 'Shell',
      context: summary && summary !== title ? summary : null,
      primaryKind: 'shell',
    };
  }

  if (input.titleKind === 'operator' && title) {
    return {
      primary: title,
      context: summary && summary !== title ? summary : null,
      primaryKind: 'operator',
    };
  }

  if (summary) {
    return { primary: summary, context: null, primaryKind: 'context' };
  }

  return {
    primary: NEW_AGENT_TITLE,
    context: null,
    primaryKind: 'fallback',
  };
}

/**
 * Truthful, source-agnostic current-state copy for a comparison card. A
 * Session with no process behind it reads its line from the shared
 * lifecycle vocabulary (ENG-015 S6.4), the same line the pane prints.
 */
export function sessionCurrentStateCopy(input: {
  harness: PtyHarness;
  live: boolean;
  lifecycle: string;
  exitCode?: number | null;
  harnessSessionId?: string | null;
  glyphState: SessionGlyphState;
  attention?: SessionAttentionSignal;
}): string {
  const lifecycle = isSessionLifecyclePhase(input.lifecycle)
    ? sessionLifecyclePresentation({
        lifecycle: input.lifecycle,
        exitCode: input.exitCode ?? null,
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

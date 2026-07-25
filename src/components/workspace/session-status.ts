/**
 * Shared live-Session turn state (ENG-016 D22/D29).
 *
 * Keep this module render-free: the strip, Sessions overview, and command
 * switcher all consume the same derivation and language, while their visual
 * components remain free to choose the appropriate footprint.
 */
export type SessionGlyphState = 'working' | 'done' | 'fresh' | 'quiet';

export interface SessionAttentionSignal {
  kind?: 'bell' | 'turn-end' | 'roadmap-blocked';
  since: number;
}

/** Turn completion is a ready result, not an operator gate. Presence-only
 *  legacy signals remain conservative needs-you state. Every consumer that
 *  exposes or navigates attention must use this same predicate. */
export function attentionNeedsOperator(
  attention?: Pick<SessionAttentionSignal, 'kind'> | null
): boolean {
  return Boolean(attention && attention.kind !== 'turn-end');
}

/**
 * Attention sources are independent facts, not last-writer-wins state. A
 * harness result can arrive while the same Session remains roadmap-blocked;
 * in that collision the operator gate must stay visible. Within the winning
 * class, retain the oldest signal so the jump queue remains stable.
 */
export function mergeSessionAttentionSignals(
  ...signals: Array<SessionAttentionSignal | null | undefined>
): SessionAttentionSignal | undefined {
  const present = signals.filter(
    (signal): signal is SessionAttentionSignal =>
      signal !== null && signal !== undefined
  );
  if (present.length === 0) return undefined;
  const operatorGates = present.filter(attentionNeedsOperator);
  const candidates = operatorGates.length > 0 ? operatorGates : present;
  return candidates.reduce((oldest, signal) =>
    signal.since < oldest.since ? signal : oldest
  );
}

/** Compose independent attention producers by Session identity. Keeping this
 * next to signal precedence prevents render and navigation surfaces from
 * accidentally reintroducing object-spread/last-writer semantics. */
export function mergeSessionAttentionMaps(
  ...sources: Array<Readonly<Record<string, SessionAttentionSignal>>>
): Record<string, SessionAttentionSignal> {
  const sessionIds = new Set(sources.flatMap(source => Object.keys(source)));
  const merged: Record<string, SessionAttentionSignal> = {};
  for (const sessionId of sessionIds) {
    const signal = mergeSessionAttentionSignals(
      ...sources.map(source => source[sessionId])
    );
    if (signal) merged[sessionId] = signal;
  }
  return merged;
}

/** One ordering function feeds both command availability and navigation. */
export function orderedAttentionTargets(
  attention: Record<string, SessionAttentionSignal>,
  activeSessionId: string | null
): string[] {
  return Object.entries(attention)
    .filter(
      ([sessionId, signal]) =>
        sessionId !== activeSessionId && attentionNeedsOperator(signal)
    )
    .sort((a, b) => a[1].since - b[1].since)
    .map(([sessionId]) => sessionId);
}

/** Working wins; agents split on whether they were ever given work; shells
 * are simply quiet between output because they do not have turns. */
export function sessionGlyphState({
  working,
  agent,
  started,
}: {
  working: boolean;
  /** false for shells — they have no turn state */
  agent: boolean;
  started: boolean;
}): SessionGlyphState {
  if (working) return 'working';
  if (!agent) return 'quiet';
  return started ? 'done' : 'fresh';
}

/**
 * Project durable Session truth into the approved five-light vocabulary.
 * A quiet turn boundary is a ready result; an explicit bell or roadmap block
 * is a human gate. Presence-only legacy flags remain conservative needs-you.
 */
export function sessionStatusLightState({
  state,
  attention,
  fault = false,
}: {
  state: SessionGlyphState;
  attention?: SessionAttentionSignal | null;
  fault?: boolean;
}): StatusLightState {
  if (fault) return 'fault';
  if (attention?.kind === 'turn-end') return 'result';
  return deriveStatusLightState({
    needsOperator: attentionNeedsOperator(attention),
    hasResult: state === 'done',
    active: state === 'working',
  });
}

/** Tooltip copy — one voice across every Session surface. */
export const SESSION_GLYPH_COPY: Record<SessionGlyphState, string> = {
  working: 'working — output streaming',
  done: 'result ready — turn finished',
  fresh: 'new — not given a task yet',
  quiet: 'quiet — waiting or between turns',
};

/** Attention is intentionally calm: it means unseen, not necessarily bad. */
export const ATTENTION_GLYPH_COPY =
  'Needs you — Agent requested input or hit a roadmap block. Open this Session to respond.';

export const FAULT_GLYPH_COPY =
  'Agent failed — open the Session for error details or recovery.';

/** Compact state words for visible labels and accessible names. */
export const SESSION_GLYPH_LABEL: Record<SessionGlyphState, string> = {
  working: 'working',
  done: 'result ready',
  fresh: 'new',
  quiet: 'quiet',
};
import {
  deriveStatusLightState,
  type StatusLightState,
} from '@/components/status-light/protocol';

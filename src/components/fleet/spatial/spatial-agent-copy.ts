/**
 * Elapsed copy for a source-reported start time, shared by the board's child
 * controls and the selection panel so the two never drift. The clock is
 * injected: a component that reads `Date.now()` mid-render is neither
 * deterministic under test nor consistent across a single paint.
 *
 * Minute granularity is deliberate — second-granularity timers are out of
 * scope for Fleet (ENG-023 D3c content boundary). Absent stays absent.
 */
export function delegationElapsedLabel(
  startedAt: number | null | undefined,
  now: number
): string | null {
  if (startedAt === null || startedAt === undefined) return null;
  if (!Number.isFinite(startedAt)) return null;
  const minutes = Math.floor((now - startedAt) / 60_000);
  if (minutes < 0) return null;
  if (minutes < 1) return 'under 1m';
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export interface AgentGoalDisplay {
  summary: string;
  context: string | null;
  contextTitle: string | null;
}

export function agentGoalDisplay(goal: string): AgentGoalDisplay {
  const value = goal.trim();
  const session = value.match(/^(.*?\bsession)\s+in\s+(\/.*)$/i);
  if (!session) {
    return {
      summary: value || 'No goal set',
      context: null,
      contextTitle: null,
    };
  }

  const fullPath = session[2];
  const segments = fullPath.split('/').filter(Boolean);
  const tail = segments.slice(-2).join('/');
  return {
    summary: session[1],
    context: tail ? `…/${tail}` : fullPath,
    contextTitle: fullPath,
  };
}

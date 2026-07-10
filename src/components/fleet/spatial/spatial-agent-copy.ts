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

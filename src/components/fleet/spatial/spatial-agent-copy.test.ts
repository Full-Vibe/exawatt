import { describe, expect, it } from 'vitest';
import { agentGoalDisplay } from './spatial-agent-copy';

describe('agentGoalDisplay', () => {
  it('separates a session description from a long filesystem path', () => {
    expect(
      agentGoalDisplay(
        'Interactive Claude Code session in /Users/example/Code/Projects/photo-studio'
      )
    ).toEqual({
      summary: 'Interactive Claude Code session',
      context: '…/Projects/photo-studio',
      contextTitle: '/Users/example/Code/Projects/photo-studio',
    });
  });

  it('preserves ordinary goals and supplies useful empty copy', () => {
    expect(agentGoalDisplay('Ship the spatial composition')).toEqual({
      summary: 'Ship the spatial composition',
      context: null,
      contextTitle: null,
    });
    expect(agentGoalDisplay('')).toEqual({
      summary: 'No goal set',
      context: null,
      contextTitle: null,
    });
  });
});

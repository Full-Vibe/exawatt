import { describe, expect, it } from 'vitest';
import { demoShellAgents, demoShellAgentTypes } from './model';

describe('demoShellAgentTypes (ENG-028 T1)', () => {
  it('names an authored Type for every base-tier demo Session', () => {
    const types = demoShellAgentTypes();
    const agents = demoShellAgents();
    expect(agents.length).toBeGreaterThan(0);
    for (const agent of agents) {
      expect(types[agent.id], agent.id).toBeTruthy();
    }
    // only fixture-authored Type names appear
    expect(new Set(Object.values(types))).toEqual(
      new Set(['Engineer', 'Researcher', 'Marketer', 'Support'])
    );
  });
});

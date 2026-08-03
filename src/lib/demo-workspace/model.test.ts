import { describe, expect, it } from 'vitest';
import { demoFleetAgents } from '@exawatt/core';
import {
  demoPaneContent,
  demoShellAgents,
  demoShellAgentTypes,
  demoShellFleetAgentById,
} from './model';

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

describe('demoShellFleetAgentById (closing fix: Fleet-board jumps)', () => {
  it('resolves EVERY board agent — scale tier included — to an honest pane', () => {
    const board = demoFleetAgents('scale');
    const scaleTier = board.filter(agent => agent.tier === 'scale');
    expect(scaleTier.length).toBeGreaterThan(100);
    for (const agent of board) {
      const resolved = demoShellFleetAgentById(agent.id);
      expect(resolved, agent.id).toBeDefined();
      // A scale-tier Session has no authored transcript: its pane is the
      // honest readable work log, never a silent fallback to the hero.
      if (agent.tier === 'scale') {
        const content = demoPaneContent(resolved!);
        expect(content.kind).toBe('log');
        if (content.kind === 'log') {
          expect(content.lines.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('returns undefined for an unknown id (only THEN may the default hero show)', () => {
    expect(demoShellFleetAgentById('vgs-not-a-real-agent')).toBeUndefined();
  });
});

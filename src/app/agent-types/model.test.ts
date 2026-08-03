import { describe, expect, it } from 'vitest';
import {
  DEMO_BASE_AGENTS,
  DEMO_PROJECTS,
  isCodingFunction,
} from '@exawatt/core';
import { demoAgentTypeRoster } from './model';

describe('demoAgentTypeRoster (ENG-028 T1)', () => {
  const roster = demoAgentTypeRoster();

  it('derives exactly the Types the Voltaic fixtures author', () => {
    expect(roster.map(profile => profile.name).sort()).toEqual([
      'Engineer',
      'Marketer',
      'Researcher',
      'Support',
    ]);
  });

  it('is a partition: every fixture Project and base Agent appears exactly once', () => {
    const projectKeys = roster.flatMap(profile =>
      profile.projects.map(project => project.key)
    );
    expect(projectKeys.sort()).toEqual(
      DEMO_PROJECTS.map(project => project.key).sort()
    );
    const agentIds = roster.flatMap(profile =>
      profile.agents.map(agent => agent.id)
    );
    expect(agentIds.sort()).toEqual(
      DEMO_BASE_AGENTS.map(agent => agent.id).sort()
    );
  });

  it('capability honesty: coding Types are live, desks are preview', () => {
    for (const profile of roster) {
      const coding = profile.projects.every(project =>
        isCodingFunction(project.function)
      );
      expect(profile.capability).toBe(coding ? 'live' : 'preview');
    }
    // The shipped capability leads the roster.
    expect(roster[0].name).toBe('Engineer');
    expect(roster[0].capability).toBe('live');
  });

  it('engines are observed from fixture truth, never asserted', () => {
    for (const profile of roster) {
      const observed = new Set(profile.agents.map(agent => agent.source));
      expect(new Set(profile.sources)).toEqual(observed);
    }
    // The portability claim needs the Engineer running on both engines.
    const engineer = roster.find(profile => profile.name === 'Engineer')!;
    expect(engineer.sources.sort()).toEqual(['claude-code', 'codex']);
  });

  it('every Type carries authored identity content and derived defaults', () => {
    for (const profile of roster) {
      expect(profile.identity.length).toBeGreaterThan(0);
      expect(profile.responsibilities.length).toBeGreaterThan(0);
      expect(profile.tools.length).toBeGreaterThan(0);
      expect(profile.defaults).not.toBeNull();
      expect(
        profile.agents.some(
          agent =>
            agent.model === profile.defaults!.model &&
            agent.effort === profile.defaults!.effort
        )
      ).toBe(true);
    }
  });

  it('is deterministic', () => {
    expect(demoAgentTypeRoster()).toEqual(roster);
  });
});

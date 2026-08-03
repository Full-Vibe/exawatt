import { describe, expect, it } from 'vitest';
import { demoCloudHero } from './model';

describe('demoCloudHero (ENG-026 N3, previewing ENG-033)', () => {
  it('tells the push story about a live, working, delegating Claude Code Session', () => {
    const { agent, project } = demoCloudHero();
    expect(agent.readiness).toBe('live');
    expect(agent.status).toBe('working');
    expect(agent.source).toBe('claude-code');
    expect(agent.delegated.length).toBeGreaterThan(0);
    expect(project.key).toBe(agent.projectKey);
  });

  it('is deterministic', () => {
    expect(demoCloudHero().agent.id).toBe(demoCloudHero().agent.id);
  });
});

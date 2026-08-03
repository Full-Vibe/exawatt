/**
 * Demo Workspace fixture contract (ENG-027 W3/W4).
 *
 * These tests are the packet's acceptance criteria as executable checks:
 *
 * - every demo roadmap parses under the PUBLISHED convention with zero
 *   warnings, zero unparsed lines, and declared conformance — validated
 *   through the real `parseRoadmap`, never by eyeballing;
 * - the fleet spans the full five-signal status protocol (ENG-016 D40),
 *   including delegation, at both tiers;
 * - non-coding Agents are always `preview` (ENG-026) — the demo may show
 *   the future but may not fake the present;
 * - consumption is real `ConsumptionSample`s that core's own rollups
 *   consume, with source-capability honesty intact;
 * - the scale tier is honest structure, not cloned filler: unique
 *   assignments that trace to real roadmap items;
 * - everything is deterministic, so the Workspace is resettable.
 */

import { describe, expect, it } from 'vitest';
import type { AgentStatus } from '../types/agent';
import { SOURCE_CAPABILITIES } from '../consumption/types';
import { rollupByProject, rollupWorkspace } from '../consumption/rollup';
import { isOperatorEntrypoint } from '../consumption/types';
import {
  CODING_FUNCTIONS,
  DEMO_BASE_AGENTS,
  DEMO_INITIATIVES,
  DEMO_PROJECTS,
  DEMO_PROJECTS_BY_KEY,
  DEMO_ROADMAP_MARKDOWN,
  DEMO_TRANSCRIPTS,
  demoDelegatedRunCount,
  demoFleetAgents,
  demoProjectRoadmap,
  demoRoadmapItemIds,
  demoWorkspaceConsumption,
  demoWorkspaceProjectResolver,
  isCodingFunction,
} from '../demo/index';

/** ENG-016 D40 five-signal projection of the shared AgentStatus union.
 * Mirrors `AGENT_STATUS_LIGHT_STATE` in the app's status-light protocol. */
const FIVE_SIGNAL: Record<AgentStatus, string> = {
  idle: 'off',
  working: 'active',
  reviewing: 'active',
  complete: 'result',
  blocked: 'needs-you',
  error: 'fault',
};

describe('demo workspace shape (W3)', () => {
  it('has 6-12 Projects with a coding majority', () => {
    expect(DEMO_PROJECTS.length).toBeGreaterThanOrEqual(6);
    expect(DEMO_PROJECTS.length).toBeLessThanOrEqual(12);
    const coding = DEMO_PROJECTS.filter(p => isCodingFunction(p.function));
    expect(coding.length).toBeGreaterThan(DEMO_PROJECTS.length / 2);
    // and a non-coding minority exists to carry the Agent Types vision
    expect(coding.length).toBeLessThan(DEMO_PROJECTS.length);
  });

  it('gives every Project a distinct identity', () => {
    const keys = new Set(DEMO_PROJECTS.map(p => p.key));
    const colors = new Set(DEMO_PROJECTS.map(p => p.color));
    const dirs = new Set(DEMO_PROJECTS.map(p => p.dir));
    expect(keys.size).toBe(DEMO_PROJECTS.length);
    expect(colors.size).toBe(DEMO_PROJECTS.length);
    expect(dirs.size).toBe(DEMO_PROJECTS.length);
  });

  it('marks exactly the non-coding functions as preview', () => {
    for (const project of DEMO_PROJECTS) {
      expect(project.readiness).toBe(
        isCodingFunction(project.function) ? 'live' : 'preview'
      );
    }
    expect(CODING_FUNCTIONS).not.toContain('research');
  });

  it('initiatives reference only real Projects', () => {
    for (const initiative of DEMO_INITIATIVES) {
      for (const key of initiative.projectKeys) {
        expect(DEMO_PROJECTS_BY_KEY.has(key), `initiative ${initiative.id} → ${key}`).toBe(true);
      }
    }
  });
});

describe('demo roadmaps parse under the published convention (W3)', () => {
  it('every Project has a roadmap', () => {
    for (const project of DEMO_PROJECTS) {
      expect(DEMO_ROADMAP_MARKDOWN[project.key], project.key).toBeTruthy();
    }
  });

  for (const project of DEMO_PROJECTS) {
    it(`${project.key}: declared conformance, ZERO warnings, zero unparsed lines`, () => {
      const doc = demoProjectRoadmap(project.key);
      expect(doc.conformance).toBe('declared');
      const warnings = doc.diagnostics.filter(d => d.level === 'warn');
      expect(warnings, JSON.stringify(warnings, null, 2)).toEqual([]);
      expect(doc.unparsedLineCount).toBe(0);
      // real roadmaps, not stubs: several items, ids on all of them,
      // milestones on the active item
      expect(doc.items.length).toBeGreaterThanOrEqual(4);
      for (const item of doc.items) {
        expect(item.declaredId, item.title).not.toBeNull();
        expect(item.statusNote, item.title).not.toBeNull();
      }
      const nowItems = doc.items.filter(i => i.status === 'now');
      expect(nowItems.length).toBeGreaterThanOrEqual(1);
      expect(nowItems[0].milestones.length).toBeGreaterThanOrEqual(3);
      const done = nowItems[0].milestones.filter(m => m.done);
      const open = nowItems[0].milestones.filter(m => !m.done && !m.retired);
      expect(done.length).toBeGreaterThanOrEqual(1);
      expect(open.length).toBeGreaterThanOrEqual(1);
    });
  }

  it('item ids are unique across the whole workspace', () => {
    const seen = new Set<string>();
    for (const project of DEMO_PROJECTS) {
      for (const id of demoRoadmapItemIds(project.key)) {
        expect(seen.has(id), id).toBe(false);
        seen.add(id);
      }
    }
  });
});

describe('five-signal status protocol coverage (W3, ENG-016 D40)', () => {
  it('base tier spans all six agent statuses and all five signals', () => {
    const statuses = new Set(DEMO_BASE_AGENTS.map(a => a.status));
    expect([...statuses].sort()).toEqual(
      ['blocked', 'complete', 'error', 'idle', 'reviewing', 'working'].sort()
    );
    const signals = new Set(DEMO_BASE_AGENTS.map(a => FIVE_SIGNAL[a.status]));
    expect([...signals].sort()).toEqual(
      ['active', 'fault', 'needs-you', 'off', 'result'].sort()
    );
  });

  it('needs-you agents carry a real blocker; faults carry a fault note', () => {
    for (const agent of demoFleetAgents('scale')) {
      if (agent.status === 'blocked') {
        expect(agent.blocker, agent.id).toBeDefined();
        expect(agent.blocker!.title.length).toBeGreaterThan(10);
      } else {
        expect(agent.blocker, agent.id).toBeUndefined();
      }
      if (agent.status === 'error') {
        expect(agent.faultNote, agent.id).toBeTruthy();
      }
    }
  });

  it('base tier exercises all three needs-you stories', () => {
    const types = new Set(
      DEMO_BASE_AGENTS.filter(a => a.blocker).map(a => a.blocker!.type)
    );
    expect(types).toContain('approval_required');
    expect(types).toContain('input_needed');
    expect(types).toContain('credentials_needed');
  });

  it('delegation exists and respects source capability truth', () => {
    const parents = demoFleetAgents('scale').filter(a => a.delegated.length > 0);
    expect(parents.length).toBeGreaterThanOrEqual(6);
    for (const agent of demoFleetAgents('scale')) {
      if (agent.delegated.length > 0) {
        // Codex records no delegation; a Codex parent would be a fake record
        expect(agent.source, agent.id).toBe('claude-code');
        const childIds = new Set(agent.delegated.map(c => c.agentId));
        expect(childIds.size).toBe(agent.delegated.length);
      }
    }
    // the base tier includes multiple delegated agent types
    const types = new Set(
      DEMO_BASE_AGENTS.flatMap(a => a.delegated.map(c => c.agentType))
    );
    expect(types).toContain('Explore');
    expect(types).toContain('general-purpose');
    expect(types).toContain('fork');
  });
});

describe('honesty boundaries (ENG-026 / ENG-028)', () => {
  it('every Agent in a non-coding Project is preview, at every tier', () => {
    for (const agent of demoFleetAgents('scale')) {
      const project = DEMO_PROJECTS_BY_KEY.get(agent.projectKey)!;
      expect(project, agent.id).toBeDefined();
      expect(agent.readiness, agent.id).toBe(project.readiness);
      if (!isCodingFunction(project.function)) {
        expect(agent.readiness, agent.id).toBe('preview');
      }
    }
  });

  it('transcripts exist only for base-tier agents and are readable', () => {
    const baseIds = new Set(DEMO_BASE_AGENTS.map(a => a.id));
    for (const [agentId, lines] of Object.entries(DEMO_TRANSCRIPTS)) {
      expect(baseIds.has(agentId), agentId).toBe(true);
      expect(lines.length).toBeGreaterThanOrEqual(5);
      expect(lines[0].role).toBe('operator');
      for (let i = 1; i < lines.length; i++) {
        expect(lines[i].atMs).toBeGreaterThanOrEqual(lines[i - 1].atMs);
      }
    }
    // the preview-desk hero transcript exists (Agent Types story is readable)
    expect(DEMO_TRANSCRIPTS['vg-res-nprr']).toBeDefined();
  });

  it('session links point at items that exist in that Project roadmap', () => {
    for (const agent of demoFleetAgents('scale')) {
      if (agent.roadmapItemId !== null) {
        const ids = demoRoadmapItemIds(agent.projectKey);
        expect(ids.has(agent.roadmapItemId), `${agent.id} → ${agent.roadmapItemId}`).toBe(true);
        expect(agent.link, agent.id).not.toBeNull();
      }
    }
  });
});

describe('scale tier (W4) — honest structure, not cloned filler', () => {
  const fleet = demoFleetAgents('scale');
  const scaleOnly = fleet.filter(a => a.tier === 'scale');

  it('reaches the Fleet-altitude entity count', () => {
    expect(fleet.length).toBeGreaterThanOrEqual(150);
    // rendered entities include delegated child runs
    expect(fleet.length + demoDelegatedRunCount('scale')).toBeGreaterThanOrEqual(170);
    // base tier is contained, unchanged, in the scale tier
    expect(fleet.filter(a => a.tier === 'base').length).toBe(DEMO_BASE_AGENTS.length);
  });

  it('every agent has a unique id, name, and goal — no clones', () => {
    const ids = new Set(fleet.map(a => a.id));
    const names = new Set(fleet.map(a => a.name));
    const goals = new Set(fleet.map(a => a.goal));
    expect(ids.size).toBe(fleet.length);
    expect(names.size).toBe(fleet.length);
    expect(goals.size).toBe(fleet.length);
  });

  it('every Project keeps a populated cluster at scale', () => {
    for (const project of DEMO_PROJECTS) {
      const members = fleet.filter(a => a.projectKey === project.key);
      expect(members.length, project.key).toBeGreaterThanOrEqual(5);
    }
    // coding work dominates the fleet, matching the startup's shape
    const codingCount = fleet.filter(a =>
      isCodingFunction(DEMO_PROJECTS_BY_KEY.get(a.projectKey)!.function)
    ).length;
    expect(codingCount / fleet.length).toBeGreaterThan(0.7);
  });

  it('the generated tier still spans all five signals', () => {
    const signals = new Set(scaleOnly.map(a => FIVE_SIGNAL[a.status]));
    expect([...signals].sort()).toEqual(
      ['active', 'fault', 'needs-you', 'off', 'result'].sort()
    );
    // and does not read uniformly busy or uniformly idle
    const working = scaleOnly.filter(a => a.status === 'working').length;
    expect(working / scaleOnly.length).toBeGreaterThan(0.15);
    expect(working / scaleOnly.length).toBeLessThan(0.6);
  });

  it('is deterministic — reset means identical data', () => {
    expect(demoFleetAgents('scale')).toEqual(demoFleetAgents('scale'));
  });

  it('rebasing shifts every timestamp without changing structure', () => {
    const shifted = demoFleetAgents('scale', {
      nowMs: Date.parse('2026-09-01T12:00:00.000Z'),
    });
    expect(shifted.length).toBe(fleet.length);
    const delta =
      Date.parse('2026-09-01T12:00:00.000Z') - Date.parse('2026-08-02T16:00:00.000Z');
    expect(shifted[0].startedAtMs - fleet[0].startedAtMs).toBe(delta);
    expect(shifted.map(a => a.id)).toEqual(fleet.map(a => a.id));
  });
});

describe('consumption history (W3, over the real ENG-008 shapes)', () => {
  const corpus = demoWorkspaceConsumption();

  it('emits a plausible multi-day corpus of valid samples', () => {
    expect(corpus.samples.length).toBeGreaterThan(500);
    const days = new Set(corpus.samples.map(s => s.at.slice(0, 10)));
    expect(days.size).toBeGreaterThanOrEqual(10);
    for (const sample of corpus.samples) {
      const u = sample.usage;
      for (const value of Object.values(u)) {
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
      // reasoning is a subset of output, never an addend
      expect(u.reasoningTokens).toBeLessThanOrEqual(u.outputTokens);
      // idempotency keys are the dedupe contract
      expect(sample.idempotencyKey.length).toBeGreaterThan(0);
    }
    const keys = new Set(corpus.samples.map(s => s.idempotencyKey));
    expect(keys.size).toBe(corpus.samples.length);
  });

  it('keeps source-capability honesty', () => {
    for (const sample of corpus.samples) {
      if (sample.source === 'codex') {
        // Codex cannot record delegation or git branches
        expect(sample.delegation).toBeNull();
        expect(sample.gitBranch).toBeNull();
      } else {
        // Claude Code never reports reasoning tokens separately
        expect(sample.usage.reasoningTokens).toBe(0);
      }
      if (sample.delegation) {
        expect(sample.delegation.parentSessionId).toBe(sample.providerSessionId);
        expect(SOURCE_CAPABILITIES[sample.source].delegation).toBe(true);
      }
    }
    // plan windows exist for Codex only; Claude Code is absent, never zero
    expect(corpus.planWindows.length).toBeGreaterThan(0);
    expect(corpus.planWindows.every(w => w.source === 'codex')).toBe(true);
  });

  it('contains delegated spend and machine overhead, separably', () => {
    const delegated = corpus.samples.filter(s => s.delegation !== null);
    expect(delegated.length).toBeGreaterThan(20);
    const machine = corpus.samples.filter(s => !isOperatorEntrypoint(s.entrypoint));
    expect(machine.length).toBeGreaterThan(10);
    expect(machine.every(s => s.entrypoint === 'sdk-cli')).toBe(true);
  });

  it('rolls up through core to every Project — no demo-only shape', () => {
    const operator = corpus.samples.filter(s => isOperatorEntrypoint(s.entrypoint));
    const workspace = rollupWorkspace(operator, {
      id: 'demo-voltaic',
      label: 'Voltaic (Demo)',
    });
    expect(workspace).not.toBeNull();
    expect(workspace!.totals.cacheReadTokens).toBeGreaterThan(
      workspace!.totals.inputTokens * 5
    );
    const byProject = rollupByProject(operator, {
      projectResolver: demoWorkspaceProjectResolver,
    });
    for (const project of DEMO_PROJECTS) {
      const rollup = byProject.rollups.find(r => r.scope.id === project.key);
      expect(rollup, project.key).toBeDefined();
      expect(rollup!.weightedTokens).toBeGreaterThan(0);
    }
  });

  it('is deterministic — reset means identical data', () => {
    expect(demoWorkspaceConsumption().samples).toEqual(corpus.samples);
  });
});

describe('fixture cross-consistency', () => {
  it('agents reference real projects and initiatives', () => {
    const initiativeIds = new Set(DEMO_INITIATIVES.map(i => i.id));
    for (const agent of demoFleetAgents('scale')) {
      expect(DEMO_PROJECTS_BY_KEY.has(agent.projectKey), agent.id).toBe(true);
      if (agent.initiativeId !== null) {
        expect(initiativeIds.has(agent.initiativeId), agent.id).toBe(true);
      }
    }
  });

  it('times are coherent: started before last activity, children after parent start', () => {
    for (const agent of demoFleetAgents('scale')) {
      expect(agent.lastActivityAtMs, agent.id).toBeGreaterThanOrEqual(agent.startedAtMs);
      for (const child of agent.delegated) {
        expect(child.startedAtMs, `${agent.id}/${child.agentId}`).toBeGreaterThanOrEqual(
          agent.startedAtMs
        );
      }
    }
  });

  it('six-word context labels hold the D33 subtitle contract', () => {
    for (const agent of demoFleetAgents('scale')) {
      const words = agent.contextLabel.trim().split(/\s+/);
      expect(words.length, `${agent.id}: "${agent.contextLabel}"`).toBeLessThanOrEqual(6);
      expect(words.length).toBeGreaterThanOrEqual(2);
    }
  });
});

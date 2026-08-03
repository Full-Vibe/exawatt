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
  demoAgentSessionId,
  demoDelegatedRunCount,
  demoFleetAgents,
  demoProjectRoadmap,
  demoRoadmapItemIds,
  demoWorkspaceConsumption,
  demoWorkspaceProjectResolver,
  isCodingFunction,
  rebuildConsumptionForTest,
  rebuildScaleTierForTest,
} from '../demo/index';
import type { DemoProjectFunction } from '../demo/index';

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
    // pin EVERY preview function: silently promoting one into
    // CODING_FUNCTIONS would flip its Projects to `live` and fake the present
    const previewFunctions: DemoProjectFunction[] = ['research', 'marketing', 'support'];
    for (const fn of previewFunctions) {
      expect(CODING_FUNCTIONS).not.toContain(fn);
    }
    // and the two lists partition the whole union
    expect(new Set([...CODING_FUNCTIONS, ...previewFunctions]).size).toBe(
      CODING_FUNCTIONS.length + previewFunctions.length
    );
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

  it('every needs-you row is distinct, authored copy — no clone filler', () => {
    const blocked = demoFleetAgents('scale').filter(a => a.blocker);
    expect(blocked.length).toBeGreaterThanOrEqual(10);
    const titles = blocked.map(a => a.blocker!.title);
    const descriptions = blocked.map(a => a.blocker!.description);
    expect(new Set(titles).size).toBe(blocked.length);
    expect(new Set(descriptions).size).toBe(blocked.length);
    for (const agent of blocked) {
      // written like the base tier: a concrete description and suggested
      // responses, not a generic stem
      expect(agent.blocker!.description.length, agent.id).toBeGreaterThan(80);
      expect(agent.blocker!.suggestedResponses?.length, agent.id).toBeGreaterThanOrEqual(2);
      // investor-visible copy: month names are proper nouns
      expect(agent.blocker!.title, agent.id).not.toMatch(/\bjuly\b/);
      expect(agent.blocker!.description, agent.id).not.toMatch(/\bjuly\b/);
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

  it('interventions are authored fixture truth, consistent with transcripts', () => {
    // An intervention is an operator message AFTER launch (ENG-026 N2). An
    // agent with an authored transcript must match it exactly — the record
    // and the count are the same story told twice.
    for (const [agentId, lines] of Object.entries(DEMO_TRANSCRIPTS)) {
      const agent = DEMO_BASE_AGENTS.find(a => a.id === agentId)!;
      const operatorAfterLaunch = lines.filter(
        (line, index) => index > 0 && line.role === 'operator'
      ).length;
      expect(agent.interventions, agentId).toBe(operatorAfterLaunch);
    }
    // Every tier authors a sane count: an integer, never negative, and
    // inside the measured E4 shape (0-6 per session).
    for (const agent of demoFleetAgents('scale')) {
      expect(Number.isInteger(agent.interventions), agent.id).toBe(true);
      expect(agent.interventions, agent.id).toBeGreaterThanOrEqual(0);
      expect(agent.interventions, agent.id).toBeLessThanOrEqual(6);
    }
    // …and the base tier is not uniformly touched or untouched — the
    // untouched-session share the surface reports must be a real spread.
    const touched = DEMO_BASE_AGENTS.filter(a => a.interventions > 0).length;
    expect(touched).toBeGreaterThanOrEqual(5);
    expect(touched).toBeLessThan(DEMO_BASE_AGENTS.length);
  });

  it('preview desks delegate function-appropriate work, never coding tasks', () => {
    const childStems: Record<string, string[]> = {
      research: ['Primary source sweep', 'Citation and figure check'],
      marketing: ['Prior campaign scan', 'Claim fact-check'],
      support: ['Ticket sample pull', 'Macro tone audit'],
    };
    let previewParents = 0;
    for (const agent of demoFleetAgents('scale')) {
      const project = DEMO_PROJECTS_BY_KEY.get(agent.projectKey)!;
      if (isCodingFunction(project.function)) continue;
      if (agent.delegated.length > 0) previewParents += 1;
      for (const child of agent.delegated) {
        expect(child.task, `${agent.id}: ${child.task}`).not.toMatch(
          /^(Survey prior art|Test coverage)/
        );
        const stems = childStems[project.function];
        expect(
          stems.some(stem => child.task.startsWith(stem)),
          `${agent.id}: "${child.task}" does not fit a ${project.function} desk`
        ).toBe(true);
      }
    }
    // at least one preview desk actually delegates, so this test bites
    expect(previewParents).toBeGreaterThanOrEqual(1);
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

  it('every git branch is unique and never truncated mid-word', () => {
    const branches = fleet
      .map(a => a.gitBranch)
      .filter((b): b is string => b !== null);
    expect(branches.length).toBeGreaterThanOrEqual(50);
    expect(new Set(branches).size).toBe(branches.length);
    for (const agent of fleet) {
      // the word-shape rules below target the GENERATED tier (base-tier
      // branches are hand-authored and may abbreviate deliberately)
      if (agent.gitBranch === null || agent.tier !== 'scale') continue;
      // a fan-out partition's branch keeps its distinguishing partition
      // token, so parallel partitions can never collapse onto one branch
      const partition = agent.name.match(/(\d+)\/(\d+)$/);
      if (partition) {
        expect(agent.gitBranch, agent.id).toMatch(
          new RegExp(`-${partition[1]}-${partition[2]}$`)
        );
      }
      // no branch segment is a truncated word: every hyphen-separated token
      // must appear whole in the agent's name or roadmap item id
      const sourceWords = new Set(
        `${agent.roadmapItemId ?? ''} ${agent.projectKey} ${agent.name}`
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter(Boolean)
      );
      for (const token of agent.gitBranch.replace(/^agent\//, '').split('-')) {
        expect(sourceWords.has(token), `${agent.id}: "${token}" in ${agent.gitBranch}`).toBe(true);
      }
    }
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

  it('is deterministic — an INDEPENDENT rebuild is deeply identical', () => {
    // rebuildScaleTierForTest bypasses the module cache, so this compares
    // two separate generation runs, not a cached object to itself
    const cachedScaleTier = demoFleetAgents('scale').filter(a => a.tier === 'scale');
    expect(rebuildScaleTierForTest()).toEqual(cachedScaleTier);
    expect(rebuildScaleTierForTest()).toEqual(rebuildScaleTierForTest());
  });

  it('fixtures are deep-frozen — consumer mutation cannot corrupt reset', () => {
    const first = demoFleetAgents('scale');
    expect(Object.isFrozen(first[0])).toBe(true);
    expect(Object.isFrozen(first[0].usage)).toBe(true);
    expect(() => {
      (first[0] as { name: string }).name = 'mutated';
    }).toThrow(TypeError);
    expect(() => {
      (first[0].delegated as unknown[]).push('bogus');
    }).toThrow(TypeError);
    // and a second read is byte-identical to the first
    expect(demoFleetAgents('scale')).toEqual(first);
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
      id: 'demo',
      label: 'Demo',
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

  it('matches the measured corpus properties the header cites', () => {
    // measured (consumption-spine.md): 61 Claude vs 302 Codex operator
    // sessions — Codex sessions are the majority, Claude sessions are
    // individually larger
    const operator = corpus.samples.filter(s => isOperatorEntrypoint(s.entrypoint));
    const sessionsOf = (source: string) =>
      new Set(
        operator.filter(s => s.source === source).map(s => s.providerSessionId)
      );
    const claudeSessions = sessionsOf('claude-code');
    const codexSessions = sessionsOf('codex');
    expect(codexSessions.size).toBeGreaterThan(claudeSessions.size);
    const rawTotal = (samples: typeof corpus.samples) =>
      samples.reduce(
        (total, s) =>
          total +
          s.usage.inputTokens +
          s.usage.cacheReadTokens +
          s.usage.cacheWriteTokens +
          s.usage.outputTokens,
        0
      );
    const claudeMean =
      rawTotal(operator.filter(s => s.source === 'claude-code')) / claudeSessions.size;
    const codexMean =
      rawTotal(operator.filter(s => s.source === 'codex')) / codexSessions.size;
    expect(claudeMean).toBeGreaterThan(codexMean);

    // measured: delegated runs are 37.7% of Claude Code samples. That was
    // measured on FINISHED sessions, so it is asserted on the history
    // portion the generator mimics — the W7 full-fleet corpus also carries
    // the CURRENT sessions, whose in-flight delegation is honestly sparser.
    const currentSessionIds = new Set(
      demoFleetAgents('scale').map(agent => demoAgentSessionId(agent))
    );
    const claude = corpus.samples.filter(
      s =>
        s.source === 'claude-code' &&
        !currentSessionIds.has(s.providerSessionId)
    );
    const delegatedShare =
      claude.filter(s => s.delegation !== null).length / claude.length;
    expect(delegatedShare).toBeGreaterThan(0.32);
    expect(delegatedShare).toBeLessThan(0.43);
  });

  it('rebases to a caller nowMs, like demoFleetAgents does', () => {
    const nowMs = Date.parse('2026-09-01T12:00:00.000Z');
    const delta = nowMs - Date.parse('2026-08-02T16:00:00.000Z');
    const shifted = demoWorkspaceConsumption({ nowMs });
    expect(shifted.samples.length).toBe(corpus.samples.length);
    for (const i of [0, 100, corpus.samples.length - 1]) {
      expect(Date.parse(shifted.samples[i].at)).toBe(
        Date.parse(corpus.samples[i].at) + delta
      );
      expect(shifted.samples[i].idempotencyKey).toBe(corpus.samples[i].idempotencyKey);
    }
    expect(Date.parse(shifted.planWindows[0].resetsAt!)).toBe(
      Date.parse(corpus.planWindows[0].resetsAt!) + delta
    );
  });

  it('is deterministic — an INDEPENDENT rebuild is deeply identical', () => {
    // rebuildConsumptionForTest bypasses the module cache: two separate
    // builds, not a cached object compared to itself
    expect(rebuildConsumptionForTest()).toEqual({
      samples: corpus.samples,
      planWindows: corpus.planWindows,
    });
    expect(rebuildConsumptionForTest()).toEqual(rebuildConsumptionForTest());
    // and the canonical corpus is frozen against consumer mutation
    expect(Object.isFrozen(corpus.samples)).toBe(true);
    expect(Object.isFrozen(corpus.samples[0])).toBe(true);
    expect(() => {
      (corpus.samples[0] as { model: string }).model = 'mutated';
    }).toThrow(TypeError);
  });
});

describe('fixture cross-consistency', () => {
  it('agents reference real projects and initiatives', () => {
    const initiativeIds = new Set(DEMO_INITIATIVES.map(i => i.id));
    const agents = demoFleetAgents('scale');
    for (const agent of agents) {
      expect(DEMO_PROJECTS_BY_KEY.has(agent.projectKey), agent.id).toBe(true);
      expect(initiativeIds.has(agent.initiativeId), agent.id).toBe(true);
      const initiative = DEMO_INITIATIVES.find(i => i.id === agent.initiativeId);
      expect(initiative?.projectKeys, agent.id).toContain(agent.projectKey);
    }
    expect(agents.every(agent => agent.initiativeId.length > 0)).toBe(true);
    expect(new Set(agents.map(agent => agent.initiativeId))).toEqual(
      new Set(DEMO_INITIATIVES.map(initiative => initiative.id))
    );
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

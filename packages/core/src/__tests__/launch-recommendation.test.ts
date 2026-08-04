import { describe, expect, it } from 'vitest';
import {
  createAgentLaunchConfiguration,
  emptyLaunchConfigurationPool,
  SHELL_LAUNCH_TARGET,
  type AgentLaunchConfigurationInput,
  type LaunchTarget,
} from '../launch-configurations';
import {
  recommendLaunchSetups,
  simulateLaunchHistory,
  type LaunchHistoryEvent,
} from '../launch-recommendation';

const PROJECT = '/Users/jake/Code/exawatt';
const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

const input = (
  sourceId: string,
  modelId: string,
  effort: string | null = null
): AgentLaunchConfigurationInput => ({
  sourceId,
  modelId,
  effort,
  labels: { source: sourceId, model: modelId, effort: effort ?? undefined },
});

const seed = (
  sourceId: string,
  modelId: string,
  effort: string | null = null
): LaunchTarget => createAgentLaunchConfiguration(input(sourceId, modelId, effort), 0);

const allAvailable = () => ({ available: true });

const idsOf = (result: { ordered: Array<{ target: LaunchTarget }> }) =>
  result.ordered.map(row => row.target.id);

describe('recommendLaunchSetups', () => {
  const claudeOpus = seed('claude', 'opus[1m]', 'high');
  const claudeSonnet = seed('claude', 'sonnet-4-6', 'medium');
  const codexGpt = seed('codex', 'gpt-5.3', 'xhigh');
  const opencodeKimi = seed('opencode', 'kimi-k3');
  const seeds = [claudeOpus, codexGpt, opencodeKimi];

  it('falls back to smart defaults in declared engine order before any launch', () => {
    const result = recommendLaunchSetups({
      pool: emptyLaunchConfigurationPool(),
      project: PROJECT,
      seeds,
      availability: allAvailable,
      rankedAt: NOW,
    });

    expect(idsOf(result)).toEqual([
      claudeOpus.id,
      codexGpt.id,
      opencodeKimi.id,
    ]);
    expect(result.ordered.every(row => row.reason === 'default')).toBe(true);
    expect(result.trained).toBe(false);
  });

  it('promotes what the operator actually launched above the seeds', () => {
    const pool = simulateLaunchHistory([
      { kind: 'launch', at: NOW - DAY, project: PROJECT, configuration: input('claude', 'sonnet-4-6', 'medium') },
      { kind: 'launch', at: NOW - DAY / 2, project: PROJECT, configuration: input('claude', 'sonnet-4-6', 'medium') },
      { kind: 'launch', at: NOW - 3 * DAY, project: PROJECT, configuration: input('codex', 'gpt-5.3', 'xhigh') },
    ]);

    const result = recommendLaunchSetups({
      pool,
      project: PROJECT,
      seeds,
      availability: allAvailable,
      rankedAt: NOW,
    });

    expect(idsOf(result).slice(0, 2)).toEqual([claudeSonnet.id, codexGpt.id]);
    expect(result.ordered[0].reason).toBe('frecent');
    expect(result.ordered[0].launchCount).toBe(2);
    expect(result.trained).toBe(true);
    // The unused seeds still fill the tail rather than vanishing.
    expect(idsOf(result)).toContain(claudeOpus.id);
    expect(idsOf(result)).toContain(opencodeKimi.id);
  });

  it('keeps a Project pin above every learned result, in pin order', () => {
    const pool = simulateLaunchHistory([
      { kind: 'launch', at: NOW, project: PROJECT, configuration: input('claude', 'sonnet-4-6', 'medium') },
      { kind: 'launch', at: NOW, project: PROJECT, configuration: input('claude', 'sonnet-4-6', 'medium') },
      { kind: 'launch', at: NOW, project: PROJECT, configuration: input('claude', 'sonnet-4-6', 'medium') },
      { kind: 'launch', at: NOW - DAY, project: PROJECT, configuration: input('codex', 'gpt-5.3', 'xhigh') },
      { kind: 'pin', project: PROJECT, configurationId: codexGpt.id },
    ]);

    const result = recommendLaunchSetups({
      pool,
      project: PROJECT,
      seeds,
      availability: allAvailable,
      rankedAt: NOW,
    });

    expect(idsOf(result)[0]).toBe(codexGpt.id);
    expect(result.ordered[0].reason).toBe('pinned');
  });

  it('demotes an unavailable setup inside its band without dropping it', () => {
    const pool = simulateLaunchHistory([
      { kind: 'launch', at: NOW, project: PROJECT, configuration: input('opencode', 'kimi-k3') },
      { kind: 'launch', at: NOW, project: PROJECT, configuration: input('opencode', 'kimi-k3') },
      { kind: 'launch', at: NOW - DAY, project: PROJECT, configuration: input('claude', 'opus[1m]', 'high') },
    ]);

    const result = recommendLaunchSetups({
      pool,
      project: PROJECT,
      seeds,
      availability: target =>
        target.kind === 'agent' && target.sourceId === 'opencode'
          ? { available: false, reason: 'OpenCode is not installed.' }
          : { available: true },
      rankedAt: NOW,
    });

    // Available Opus wins the band even though Kimi is more frecent...
    expect(idsOf(result)[0]).toBe(claudeOpus.id);
    // ...but the setup the operator relies on stays visible, with the reason.
    const kimi = result.ordered.find(row => row.target.id === opencodeKimi.id);
    expect(kimi).toBeDefined();
    expect(kimi!.reason).toBe('frecent');
    expect(kimi!.availability.reason).toBe('OpenCode is not installed.');
  });

  it('leaves Shell out of the row unless the caller asks for it', () => {
    const withShell = recommendLaunchSetups({
      pool: emptyLaunchConfigurationPool(),
      project: PROJECT,
      seeds: [...seeds, SHELL_LAUNCH_TARGET],
      availability: allAvailable,
      includeShell: true,
      rankedAt: NOW,
    });
    const withoutShell = recommendLaunchSetups({
      pool: emptyLaunchConfigurationPool(),
      project: PROJECT,
      seeds: [...seeds, SHELL_LAUNCH_TARGET],
      availability: allAvailable,
      rankedAt: NOW,
    });

    expect(idsOf(withShell)).toContain(SHELL_LAUNCH_TARGET.id);
    expect(idsOf(withoutShell)).not.toContain(SHELL_LAUNCH_TARGET.id);
  });

  it('is deterministic: identical inputs produce an identical order', () => {
    const events: LaunchHistoryEvent[] = [
      { kind: 'launch', at: NOW, project: PROJECT, configuration: input('claude', 'opus[1m]', 'high') },
      { kind: 'launch', at: NOW, project: PROJECT, configuration: input('codex', 'gpt-5.3', 'xhigh') },
    ];
    const args = {
      pool: simulateLaunchHistory(events),
      project: PROJECT,
      seeds,
      availability: allAvailable,
      rankedAt: NOW,
    };

    expect(idsOf(recommendLaunchSetups(args))).toEqual(
      idsOf(recommendLaunchSetups(args))
    );
  });

  it('scopes learning to the Project it happened in', () => {
    const pool = simulateLaunchHistory([
      { kind: 'launch', at: NOW, project: '/other/project', configuration: input('opencode', 'kimi-k3') },
      { kind: 'launch', at: NOW, project: '/other/project', configuration: input('opencode', 'kimi-k3') },
    ]);

    const here = recommendLaunchSetups({
      pool,
      project: PROJECT,
      seeds,
      availability: allAvailable,
      rankedAt: NOW,
    });
    const there = recommendLaunchSetups({
      pool,
      project: '/other/project',
      seeds,
      availability: allAvailable,
      rankedAt: NOW,
    });

    expect(here.trained).toBe(false);
    expect(idsOf(here)[0]).toBe(claudeOpus.id);
    expect(there.trained).toBe(true);
    expect(idsOf(there)[0]).toBe(opencodeKimi.id);
  });
});

describe('simulateLaunchHistory', () => {
  it('replays a stream into the pool the runtime would have written', () => {
    const pool = simulateLaunchHistory([
      { kind: 'launch', at: NOW - DAY, project: PROJECT, configuration: input('claude', 'opus[1m]', 'high') },
      { kind: 'launch', at: NOW, project: PROJECT, configuration: input('claude', 'opus[1m]', 'high') },
    ]);

    const usage = pool.projects[PROJECT].usage;
    const id = createAgentLaunchConfiguration(input('claude', 'opus[1m]', 'high'), 0).id;
    expect(usage[id].launchCount).toBe(2);
    expect(usage[id].lastLaunchedAt).toBe(NOW);
    expect(pool.configurations).toHaveLength(1);
  });

  it('applies pins and unpins in order', () => {
    const id = createAgentLaunchConfiguration(input('codex', 'gpt-5.3', 'xhigh'), 0).id;
    const pinned = simulateLaunchHistory([
      { kind: 'launch', at: NOW, project: PROJECT, configuration: input('codex', 'gpt-5.3', 'xhigh') },
      { kind: 'pin', project: PROJECT, configurationId: id },
    ]);
    expect(pinned.projects[PROJECT].pins).toEqual([id]);

    const unpinned = simulateLaunchHistory([
      { kind: 'unpin', project: PROJECT, configurationId: id },
    ], pinned);
    expect(unpinned.projects[PROJECT].pins).toEqual([]);
  });
});

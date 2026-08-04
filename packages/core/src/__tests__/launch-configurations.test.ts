import { describe, expect, it } from 'vitest';
import {
  SHELL_LAUNCH_TARGET_ID,
  createAgentLaunchConfiguration,
  deleteLaunchConfiguration,
  emptyLaunchConfigurationPool,
  launchConfigurationId,
  migrateAgentSourceMemory,
  parseLaunchConfigurationPool,
  rankLaunchTargets,
  recordLaunchConfigurationSuccess,
  renameLaunchConfiguration,
  saveNamedLaunchConfiguration,
  setLaunchConfigurationPinned,
} from '../launch-configurations';

const opus = {
  sourceId: 'claude-local',
  modelId: 'claude-opus-5',
  effort: 'high',
  labels: { source: 'Claude Code', model: 'Opus 5', effort: 'High' },
};
const codex = {
  sourceId: 'codex-work',
  modelId: 'gpt-5.3-codex',
  effort: 'xhigh',
};

describe('Launch Configuration identity', () => {
  it('is stable over labels and excludes launch-local modifiers', () => {
    const first = launchConfigurationId(opus);
    expect(
      launchConfigurationId({
        ...opus,
        labels: { source: 'Renamed source', model: 'Opus' },
      })
    ).toBe(first);
    expect(launchConfigurationId({ ...opus, effort: 'medium' })).not.toBe(
      first
    );
    expect(launchConfigurationId({ ...opus, typeId: 'reviewer' })).not.toBe(
      first
    );
  });

  it('keeps configured sources distinct even when model and effort match', () => {
    expect(
      launchConfigurationId({ ...opus, sourceId: 'claude-personal' })
    ).not.toBe(launchConfigurationId(opus));
  });
});

describe('Launch Configuration pool', () => {
  it('adds and structurally deduplicates only through successful launch', () => {
    const empty = emptyLaunchConfigurationPool();
    const first = recordLaunchConfigurationSuccess(empty, '/alpha', opus, 100);
    const second = recordLaunchConfigurationSuccess(
      first,
      '/alpha',
      { ...opus, labels: { model: 'Opus Five' } },
      200
    );
    expect(empty.configurations).toEqual([]);
    expect(second.configurations).toHaveLength(1);
    expect(second.configurations[0].labels.model).toBe('Opus Five');
    expect(
      second.projects['/alpha'].usage[launchConfigurationId(opus)]
    ).toEqual({
      launchCount: 2,
      lastLaunchedAt: 200,
    });
  });

  it('saves and renames a friendly preset without changing usage', () => {
    const saved = saveNamedLaunchConfiguration(
      emptyLaunchConfigurationPool(),
      opus,
      ' Reviewer ',
      50
    );
    expect(saved.configurations[0].name).toBe('Reviewer');
    expect(saved.projects).toEqual({});
    const renamed = renameLaunchConfiguration(
      saved,
      saved.configurations[0].id,
      'Deep reviewer'
    );
    expect(renamed.configurations[0].name).toBe('Deep reviewer');
    expect(() =>
      renameLaunchConfiguration(saved, SHELL_LAUNCH_TARGET_ID, 'Terminal')
    ).toThrow('Shell cannot be renamed');
  });

  it('keeps usage and pins Project-local and puts pins above learned rank', () => {
    let pool = recordLaunchConfigurationSuccess(
      emptyLaunchConfigurationPool(),
      '/alpha',
      opus,
      1_000
    );
    pool = recordLaunchConfigurationSuccess(pool, '/alpha', codex, 2_000);
    pool = recordLaunchConfigurationSuccess(pool, '/beta', opus, 3_000);
    pool = recordLaunchConfigurationSuccess(
      pool,
      '/alpha',
      { kind: 'shell' },
      4_000
    );
    pool = setLaunchConfigurationPinned(
      pool,
      '/alpha',
      launchConfigurationId(opus),
      true
    );

    expect(
      rankLaunchTargets(pool, '/alpha', 5_000).map(target => target.id)
    ).toEqual([
      launchConfigurationId(opus),
      SHELL_LAUNCH_TARGET_ID,
      launchConfigurationId(codex),
    ]);
    expect(rankLaunchTargets(pool, '/beta', 5_000)[0].id).toBe(
      launchConfigurationId(opus)
    );
    expect(pool.projects['/beta'].pins).toEqual([]);
  });

  it('deletes explicitly and removes orphaned rank and pin state', () => {
    let pool = recordLaunchConfigurationSuccess(
      emptyLaunchConfigurationPool(),
      '/alpha',
      opus,
      1
    );
    const id = pool.configurations[0].id;
    pool = setLaunchConfigurationPinned(pool, '/alpha', id, true);
    pool = deleteLaunchConfiguration(pool, id);
    expect(pool.configurations).toEqual([]);
    expect(pool.projects['/alpha']).toEqual({ usage: {}, pins: [] });
    expect(() =>
      deleteLaunchConfiguration(pool, SHELL_LAUNCH_TARGET_ID)
    ).toThrow('Shell cannot be deleted');
  });
});

describe('Launch Configuration persistence parsing and migration', () => {
  it('recomputes identity, collapses duplicates, and drops corrupt references', () => {
    const valid = createAgentLaunchConfiguration(opus, 20);
    const parsed = parseLaunchConfigurationPool({
      schemaVersion: 1,
      configurations: [
        { ...valid, id: 'forged', name: null },
        { ...valid, id: 'old-id', name: 'Reviewer', createdAt: 10 },
        { kind: 'agent', sourceId: '', modelId: 'bad' },
      ],
      projects: {
        '/alpha': {
          usage: {
            forged: { launchCount: 2, lastLaunchedAt: 30 },
            missing: { launchCount: 9, lastLaunchedAt: 40 },
          },
          pins: ['forged', 'missing', 'forged'],
        },
      },
    });
    expect(parsed.configurations).toHaveLength(1);
    expect(parsed.configurations[0]).toMatchObject({
      id: launchConfigurationId(opus),
      name: 'Reviewer',
      createdAt: 10,
    });
    expect(parsed.projects['/alpha']).toEqual({
      usage: {
        [launchConfigurationId(opus)]: { launchCount: 2, lastLaunchedAt: 30 },
      },
      pins: [launchConfigurationId(opus)],
    });
  });

  it('migrates the unversioned prototype and source memory without inventing models', () => {
    const legacy = parseLaunchConfigurationPool({
      items: [{ id: 'legacy-opus', ...opus }],
      projectUsage: { '/alpha': { 'legacy-opus': 42 } },
      projectPins: { '/alpha': ['legacy-opus'] },
    });
    expect(
      legacy.projects['/alpha'].usage[launchConfigurationId(opus)]
    ).toEqual({
      launchCount: 1,
      lastLaunchedAt: 42,
    });

    const migrated = migrateAgentSourceMemory(
      emptyLaunchConfigurationPool(),
      {
        projectLastUsed: { '/alpha': 'claude-local', '/skip': 'unknown' },
        sourceRecency: { 'claude-local': 99, unknown: 100 },
      },
      { 'claude-local': opus }
    );
    expect(migrated.configurations).toHaveLength(1);
    expect(
      migrated.projects['/alpha'].usage[launchConfigurationId(opus)]
    ).toEqual({
      launchCount: 1,
      lastLaunchedAt: 99,
    });
    expect(migrated.projects['/skip']).toBeUndefined();
  });

  it('fails a future or malformed store safely to an empty V1 pool', () => {
    expect(
      parseLaunchConfigurationPool({ schemaVersion: 2, configurations: [opus] })
    ).toEqual(emptyLaunchConfigurationPool());
    expect(parseLaunchConfigurationPool('{bad json')).toEqual(
      emptyLaunchConfigurationPool()
    );
  });

  it('keeps Shell a distinct axis-free singleton at runtime', () => {
    expect(() =>
      recordLaunchConfigurationSuccess(
        emptyLaunchConfigurationPool(),
        '/alpha',
        { kind: 'shell', sourceId: 'codex' } as never,
        1
      )
    ).toThrow('Shell cannot carry Agent configuration axes');
    expect(() =>
      recordLaunchConfigurationSuccess(
        emptyLaunchConfigurationPool(),
        '/alpha',
        { kind: 'other', sourceId: 'codex', modelId: 'gpt' } as never,
        1
      )
    ).toThrow('Invalid Launch Configuration identity');
  });
});

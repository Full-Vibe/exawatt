import { describe, expect, it } from 'vitest';
import {
  SHELL_LAUNCH_TARGET_ID,
  createAgentLaunchConfiguration,
  deleteLaunchConfiguration,
  emptyLaunchConfigurationPool,
  launchConfigurationId,
  isStoredLaunchConfigurationPool,
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
    expect(launchConfigurationId({ ...opus, typeId: 'reviewer' })).not.toBe(
      first
    );
  });

  it('treats effort as an axis the configuration carries, not identity (BUG-334)', () => {
    const first = launchConfigurationId(opus);
    expect(launchConfigurationId({ ...opus, effort: 'medium' })).toBe(first);
    expect(launchConfigurationId({ ...opus, effort: null })).toBe(first);
    expect(() => launchConfigurationId({ ...opus, effort: '  ' })).toThrow(
      'Invalid Launch Configuration identity'
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

  it('keeps one configuration per model and carries the latest launched effort', () => {
    let pool = recordLaunchConfigurationSuccess(
      emptyLaunchConfigurationPool(),
      '/alpha',
      opus,
      100
    );
    pool = recordLaunchConfigurationSuccess(
      pool,
      '/alpha',
      { ...opus, effort: 'medium', labels: { effort: 'Medium' } },
      200
    );
    expect(pool.configurations).toHaveLength(1);
    expect(pool.configurations[0]).toMatchObject({
      id: launchConfigurationId(opus),
      effort: 'medium',
      labels: { source: 'Claude Code', model: 'Opus 5', effort: 'Medium' },
    });
    expect(pool.projects['/alpha'].usage[launchConfigurationId(opus)]).toEqual({
      launchCount: 2,
      lastLaunchedAt: 200,
    });

    // The source-owned default: no effort, and no stale label naming one.
    pool = recordLaunchConfigurationSuccess(
      pool,
      '/beta',
      { ...opus, effort: null, labels: {} },
      300
    );
    expect(pool.configurations[0].effort).toBeNull();
    expect(pool.configurations[0].labels.effort).toBeUndefined();
  });

  it('saves and renames a named setup, carrying its usage and pins to its new identity', () => {
    const saved = saveNamedLaunchConfiguration(
      emptyLaunchConfigurationPool(),
      opus,
      ' Reviewer ',
      50
    );
    expect(saved.configurations[0].name).toBe('Reviewer');
    expect(saved.projects).toEqual({});
    let pool = recordLaunchConfigurationSuccess(
      saved,
      '/alpha',
      { ...opus, name: 'Reviewer' },
      60
    );
    pool = setLaunchConfigurationPinned(
      pool,
      '/alpha',
      saved.configurations[0].id,
      true
    );
    const renamed = renameLaunchConfiguration(
      pool,
      saved.configurations[0].id,
      'Deep reviewer'
    );
    const id = launchConfigurationId({ ...opus, name: 'Deep reviewer' });
    expect(renamed.configurations).toHaveLength(1);
    expect(renamed.configurations[0]).toMatchObject({
      id,
      name: 'Deep reviewer',
      effort: 'high',
    });
    expect(renamed.projects['/alpha']).toEqual({
      usage: { [id]: { launchCount: 1, lastLaunchedAt: 60 } },
      pins: [id],
    });
    expect(() =>
      renameLaunchConfiguration(saved, SHELL_LAUNCH_TARGET_ID, 'Terminal')
    ).toThrow('Shell cannot be renamed');
  });

  it('refuses a rename onto a name another setup on the model holds', () => {
    let pool = saveNamedLaunchConfiguration(
      emptyLaunchConfigurationPool(),
      opus,
      'Deep work',
      1
    );
    pool = saveNamedLaunchConfiguration(
      pool,
      { ...opus, effort: 'low' },
      'Quick',
      2
    );
    expect(() =>
      renameLaunchConfiguration(
        pool,
        launchConfigurationId({ ...opus, name: 'Quick' }),
        'Deep work'
      )
    ).toThrow('A setup with that name already exists');
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

describe('named setups (BUG-334 amended 2026-11-05)', () => {
  const opusId = launchConfigurationId(opus);
  const deepId = launchConfigurationId({ ...opus, name: 'Deep work' });
  const quickId = launchConfigurationId({ ...opus, name: 'Quick' });

  it('is its own identity: never the unnamed configuration, never another name', () => {
    expect(new Set([opusId, deepId, quickId]).size).toBe(3);
    expect(launchConfigurationId({ ...opus, name: ' Deep work ' })).toBe(
      deepId
    );
    expect(launchConfigurationId({ ...opus, name: null })).toBe(opusId);
  });

  it('saving a second name on the same model adds a setup instead of renaming the first', () => {
    let pool = saveNamedLaunchConfiguration(
      emptyLaunchConfigurationPool(),
      opus,
      'Deep work',
      1
    );
    pool = saveNamedLaunchConfiguration(
      pool,
      { ...opus, effort: 'low', labels: { effort: 'Low' } },
      'Quick',
      2
    );
    expect(
      pool.configurations.map(({ id, name, effort }) => ({ id, name, effort }))
    ).toEqual([
      { id: deepId, name: 'Deep work', effort: 'high' },
      { id: quickId, name: 'Quick', effort: 'low' },
    ]);
  });

  it('an unnamed launch on the model never renames or re-efforts a named setup', () => {
    let pool = saveNamedLaunchConfiguration(
      emptyLaunchConfigurationPool(),
      opus,
      'Deep work',
      1
    );
    pool = recordLaunchConfigurationSuccess(
      pool,
      '/alpha',
      { ...opus, effort: 'medium' },
      3
    );
    expect(pool.configurations.find(c => c.id === deepId)).toMatchObject({
      name: 'Deep work',
      effort: 'high',
    });
    expect(pool.configurations.find(c => c.id === opusId)).toMatchObject({
      name: null,
      effort: 'medium',
    });
    expect(pool.projects['/alpha'].usage).toEqual({
      [opusId]: { launchCount: 1, lastLaunchedAt: 3 },
    });
  });

  it('credits a named launch only when it starts the setup exactly', () => {
    let pool = saveNamedLaunchConfiguration(
      emptyLaunchConfigurationPool(),
      opus,
      'Deep work',
      1
    );
    pool = recordLaunchConfigurationSuccess(
      pool,
      '/alpha',
      { ...opus, name: 'Deep work', labels: { model: 'Opus Five' } },
      2
    );
    // The operator picked the setup, then changed its effort: that launch
    // is the model's unnamed configuration, and the setup keeps high.
    pool = recordLaunchConfigurationSuccess(
      pool,
      '/alpha',
      { ...opus, effort: 'max', name: 'Deep work' },
      3
    );
    // A setup deleted meanwhile is never recreated by a launch.
    pool = recordLaunchConfigurationSuccess(
      pool,
      '/alpha',
      { ...opus, effort: 'low', name: 'Gone' },
      4
    );
    expect(pool.configurations.find(c => c.id === deepId)).toMatchObject({
      effort: 'high',
      labels: { model: 'Opus Five', effort: 'High' },
    });
    expect(pool.configurations.find(c => c.id === opusId)?.effort).toBe('low');
    expect(pool.configurations).toHaveLength(2);
    expect(pool.projects['/alpha'].usage).toEqual({
      [deepId]: { launchCount: 1, lastLaunchedAt: 2 },
      [opusId]: { launchCount: 2, lastLaunchedAt: 4 },
    });
  });

  it('migration keeps two differently named rows of one model apart, with their own efforts', () => {
    const stored = {
      schemaVersion: 1,
      configurations: [
        { ...opus, id: 'a', effort: 'high', name: 'Deep work', createdAt: 1 },
        { ...opus, id: 'b', effort: 'low', name: 'Quick', createdAt: 2 },
        { ...opus, id: 'c', effort: 'max', name: null, createdAt: 3 },
      ],
      projects: {
        '/p': {
          usage: { c: { launchCount: 1, lastLaunchedAt: 99 } },
          pins: ['a', 'b'],
        },
      },
    };
    const migrated = parseLaunchConfigurationPool(stored);
    expect(
      migrated.configurations.map(({ id, name, effort }) => ({
        id,
        name,
        effort,
      }))
    ).toEqual([
      { id: deepId, name: 'Deep work', effort: 'high' },
      { id: quickId, name: 'Quick', effort: 'low' },
      { id: opusId, name: null, effort: 'max' },
    ]);
    expect(migrated.projects['/p']).toEqual({
      usage: { [opusId]: { launchCount: 1, lastLaunchedAt: 99 } },
      pins: [deepId, quickId],
    });
    expect(isStoredLaunchConfigurationPool(migrated)).toBe(true);
    expect(parseLaunchConfigurationPool(migrated)).toEqual(migrated);
  });

  it('migration keeps a named row apart from the unnamed rows it used to share a model with', () => {
    const migrated = parseLaunchConfigurationPool({
      configurations: [
        { ...opus, id: 'named', effort: 'high', name: 'Deep work' },
        { ...opus, id: 'u1', effort: 'low', labels: {}, createdAt: 2 },
        { ...opus, id: 'u2', effort: 'medium', labels: {}, createdAt: 3 },
      ],
      projects: {
        '/p': {
          usage: {
            named: { launchCount: 4, lastLaunchedAt: 10 },
            u1: { launchCount: 1, lastLaunchedAt: 30 },
            u2: { launchCount: 2, lastLaunchedAt: 20 },
          },
        },
      },
    });
    expect(
      migrated.configurations.map(({ id, name, effort }) => ({
        id,
        name,
        effort,
      }))
    ).toEqual([
      { id: deepId, name: 'Deep work', effort: 'high' },
      { id: opusId, name: null, effort: 'low' },
    ]);
    expect(migrated.projects['/p'].usage).toEqual({
      [deepId]: { launchCount: 4, lastLaunchedAt: 10 },
      [opusId]: { launchCount: 3, lastLaunchedAt: 30 },
    });
    expect(parseLaunchConfigurationPool(migrated)).toEqual(migrated);
  });

  it('a pool an older build rewrote under its own ids maps forward to the same setups', () => {
    let pool = saveNamedLaunchConfiguration(
      emptyLaunchConfigurationPool(),
      opus,
      'Deep work',
      1
    );
    pool = saveNamedLaunchConfiguration(
      pool,
      { ...opus, effort: 'low' },
      'Quick',
      2
    );
    pool = recordLaunchConfigurationSuccess(pool, '/p', opus, 3);
    pool = setLaunchConfigurationPinned(pool, '/p', quickId, true);
    // An older build keeps every row and field but writes ids its own way.
    const olderId = (id: string) =>
      `older:${pool.configurations.findIndex(c => c.id === id)}`;
    const rewritten = {
      schemaVersion: 1,
      configurations: pool.configurations.map(configuration => ({
        ...configuration,
        id: olderId(configuration.id),
        fingerprint: 'older',
      })),
      projects: {
        '/p': {
          usage: Object.fromEntries(
            Object.entries(pool.projects['/p'].usage).map(([id, usage]) => [
              olderId(id),
              usage,
            ])
          ),
          pins: pool.projects['/p'].pins.map(olderId),
        },
      },
    };
    expect(isStoredLaunchConfigurationPool(rewritten)).toBe(true);
    expect(parseLaunchConfigurationPool(rewritten)).toEqual(pool);
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
            'old-id': { launchCount: 3, lastLaunchedAt: 35 },
            missing: { launchCount: 9, lastLaunchedAt: 40 },
          },
          pins: ['forged', 'missing', 'forged'],
        },
      },
    });
    // The named row is its own setup; the forged id recomputes.
    const reviewerId = launchConfigurationId({ ...opus, name: 'Reviewer' });
    expect(parsed.configurations).toHaveLength(2);
    expect(parsed.configurations[1]).toMatchObject({
      id: reviewerId,
      name: 'Reviewer',
      createdAt: 10,
    });
    expect(parsed.projects['/alpha']).toEqual({
      usage: {
        [launchConfigurationId(opus)]: { launchCount: 2, lastLaunchedAt: 30 },
        [reviewerId]: { launchCount: 3, lastLaunchedAt: 35 },
      },
      pins: [launchConfigurationId(opus)],
    });
  });

  it('collapses a pool written while effort was identity into one configuration per model', () => {
    // A v1 pool as the operator's machine holds it: one model launched at
    // four efforts, across two Projects, with a pin and a name on rows that
    // are not the latest launch.
    const v1Id = (effort: string | null) =>
      `agent:${encodeURIComponent(
        `launch-configuration:v1:${JSON.stringify([
          'claude-local',
          'opus[1m]',
          effort,
          null,
        ])}`
      )}`;
    const row = (effort: string | null, createdAt: number, extra = {}) => ({
      kind: 'agent',
      id: v1Id(effort),
      fingerprint: 'stale',
      sourceId: 'claude-local',
      modelId: 'opus[1m]',
      effort,
      typeId: null,
      labels: {
        source: 'Claude Code',
        model: 'Opus (1M context)',
        ...(effort ? { effort: effort.toUpperCase() } : {}),
      },
      name: null,
      createdAt,
      ...extra,
    });
    const stored = {
      schemaVersion: 1,
      configurations: [
        row('high', 10, { name: 'Deep work' }),
        row('auto', 20),
        row('xhigh', 30),
        row(null, 40),
        {
          kind: 'agent',
          id: 'codex-row',
          sourceId: 'codex-local',
          modelId: 'gpt-6-astra',
          effort: 'medium',
          typeId: null,
          labels: {},
          name: null,
          createdAt: 5,
        },
      ],
      projects: {
        '/alpha': {
          usage: {
            [v1Id('high')]: { launchCount: 3, lastLaunchedAt: 500 },
            [v1Id('auto')]: { launchCount: 1, lastLaunchedAt: 900 },
            'codex-row': { launchCount: 1, lastLaunchedAt: 100 },
          },
          pins: [v1Id('high'), v1Id('auto')],
        },
        '/beta': {
          usage: {
            [v1Id('xhigh')]: { launchCount: 2, lastLaunchedAt: 1_000 },
            [v1Id('high')]: { launchCount: 1, lastLaunchedAt: 600 },
          },
          pins: [v1Id('high')],
        },
      },
    };
    expect(isStoredLaunchConfigurationPool(stored)).toBe(true);

    const migrated = parseLaunchConfigurationPool(stored);
    const opusId = launchConfigurationId({
      sourceId: 'claude-local',
      modelId: 'opus[1m]',
    });
    const deepWorkId = launchConfigurationId({
      sourceId: 'claude-local',
      modelId: 'opus[1m]',
      name: 'Deep work',
    });
    expect(migrated.configurations).toHaveLength(3);
    expect(
      migrated.configurations.find(configuration => configuration.id === opusId)
    ).toMatchObject({
      // xhigh was launched last, in /beta.
      effort: 'xhigh',
      labels: {
        source: 'Claude Code',
        model: 'Opus (1M context)',
        effort: 'XHIGH',
      },
      name: null,
      createdAt: 20,
    });
    // The named row is its own setup and keeps the effort it was saved with.
    expect(
      migrated.configurations.find(
        configuration => configuration.id === deepWorkId
      )
    ).toMatchObject({ effort: 'high', name: 'Deep work', createdAt: 10 });
    expect(migrated.projects['/alpha']).toEqual({
      usage: {
        [deepWorkId]: { launchCount: 3, lastLaunchedAt: 500 },
        [opusId]: { launchCount: 1, lastLaunchedAt: 900 },
        [launchConfigurationId({
          sourceId: 'codex-local',
          modelId: 'gpt-6-astra',
        })]: { launchCount: 1, lastLaunchedAt: 100 },
      },
      pins: [deepWorkId, opusId],
    });
    expect(migrated.projects['/beta']).toEqual({
      usage: {
        [opusId]: { launchCount: 2, lastLaunchedAt: 1_000 },
        [deepWorkId]: { launchCount: 1, lastLaunchedAt: 600 },
      },
      pins: [deepWorkId],
    });

    expect(isStoredLaunchConfigurationPool(migrated)).toBe(true);
    expect(parseLaunchConfigurationPool(migrated)).toEqual(migrated);
  });

  it('takes a never-launched collapse effort from the newest row', () => {
    const migrated = parseLaunchConfigurationPool({
      configurations: [
        { ...opus, id: 'a', effort: 'low', createdAt: 1 },
        { ...opus, id: 'b', effort: 'max', labels: {}, createdAt: 9 },
        { ...opus, id: 'c', effort: 'medium', createdAt: 5 },
      ],
    });
    expect(migrated.configurations).toHaveLength(1);
    expect(migrated.configurations[0].effort).toBe('max');
    expect(migrated.configurations[0].labels.effort).toBeUndefined();
    expect(migrated.configurations[0].createdAt).toBe(1);
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

describe('stored Launch Configuration integrity', () => {
  it('accepts legacy aliases, numeric usage, and unknown fields without losing choices', () => {
    const legacy = {
      items: [{ ...opus, id: 'legacy-opus', futureField: true }],
      projectUsage: { '/repo': { 'legacy-opus': 42 } },
      projectPins: { '/repo': ['legacy-opus'] },
    };
    expect(isStoredLaunchConfigurationPool(legacy)).toBe(true);
    const migrated = parseLaunchConfigurationPool(legacy);
    expect(isStoredLaunchConfigurationPool(migrated)).toBe(true);
    expect(migrated.projects['/repo'].pins).toEqual([
      launchConfigurationId(opus),
    ]);
  });

  it.each([
    { ...opus, createdAt: 'damaged' },
    { ...opus, labels: { model: 123 } },
  ])(
    'rejects present known configuration fields the total parser would drop: %j',
    configuration => {
      expect(
        isStoredLaunchConfigurationPool({ configurations: [configuration] })
      ).toBe(false);
    }
  );
});

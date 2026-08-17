import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  AgentModelCatalogCache,
  CATALOG_FRESH_MS,
  CATALOG_MAX_AGE_MS,
  CATALOG_MAX_ENTRIES,
  catalogCacheKey,
} from './agent-model-catalog-cache';
import type { AgentModelCatalog } from './agent-models';

const catalog = (
  overrides: Partial<AgentModelCatalog> = {}
): AgentModelCatalog => ({
  harness: 'claude',
  effectiveModel: 'opus[1m]',
  effectiveModelLabel: 'Opus (1M context)',
  effectiveModelSource: 'harness-recommended',
  effectiveEffort: 'high',
  effectiveEffortLabel: 'High',
  effectiveEffortSource: 'model-default',
  effortLocked: false,
  models: [
    {
      id: 'opus[1m]',
      label: 'Opus (1M context)',
      description: '',
      defaultEffort: 'high',
      efforts: [],
    },
  ],
  catalogMode: 'live-catalog',
  catalogProvenance: 'Installed Claude Code CLI',
  observedAt: 1,
  selectionAction: null,
  ...overrides,
});

let directory: string;
let now = 1_000_000;
/** Directories the fake filesystem says still exist. */
let live: Set<string>;

beforeEach(async () => {
  directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'exawatt-catalog-cache-')
  );
  now = 1_000_000;
  live = new Set(['/repo', '/other']);
});

afterEach(async () => {
  await fs.promises.rm(directory, { recursive: true, force: true });
});

const makeCache = () =>
  new AgentModelCatalogCache(
    () => directory,
    () => now,
    cwd => live.has(cwd)
  );

const KEY = catalogCacheKey('claude', '/repo', '/bin/fish');

describe('AgentModelCatalogCache', () => {
  it('returns nothing before anything is written', async () => {
    await expect(makeCache().read(KEY)).resolves.toBeNull();
  });

  it('round-trips a catalog through disk, so a restart does not re-probe', async () => {
    await makeCache().write(KEY, '/repo', catalog());

    // A brand-new instance, as after an app restart.
    const reread = await makeCache().read(KEY);
    expect(reread?.catalog.effectiveModel).toBe('opus[1m]');
    expect(reread?.fresh).toBe(true);
  });

  it('serves a stale catalog but reports it as not fresh', async () => {
    await makeCache().write(KEY, '/repo', catalog());
    now += CATALOG_FRESH_MS + 1;

    const reread = await makeCache().read(KEY);
    expect(reread?.catalog.effectiveModel).toBe('opus[1m]');
    expect(reread?.fresh).toBe(false);
  });

  it('refuses a catalog that is too old to show at all', async () => {
    await makeCache().write(KEY, '/repo', catalog());
    now += CATALOG_MAX_AGE_MS + 1;

    await expect(makeCache().read(KEY)).resolves.toBeNull();
  });

  it('refuses an entry written in the future rather than trusting a clock jump', async () => {
    await makeCache().write(KEY, '/repo', catalog());
    now -= 60_000;

    await expect(makeCache().read(KEY)).resolves.toBeNull();
  });

  it('never retains a probe that did not produce a live catalog', async () => {
    const cache = makeCache();
    await cache.write(
      KEY,
      '/repo',
      catalog({ catalogMode: 'configured-values' })
    );
    await expect(cache.read(KEY)).resolves.toBeNull();

    await cache.write(KEY, '/repo', catalog({ catalogMode: 'unavailable' }));
    await expect(cache.read(KEY)).resolves.toBeNull();
  });

  it('keys separately per engine, Project, and shell', async () => {
    const cache = makeCache();
    await cache.write(KEY, '/repo', catalog());

    await expect(
      cache.read(catalogCacheKey('codex', '/repo', '/bin/fish'))
    ).resolves.toBeNull();
    await expect(
      cache.read(catalogCacheKey('claude', '/other', '/bin/fish'))
    ).resolves.toBeNull();
    await expect(
      cache.read(catalogCacheKey('claude', '/repo', '/bin/zsh'))
    ).resolves.toBeNull();
  });

  it('normalizes the Project path so the same directory hits one entry', async () => {
    const cache = makeCache();
    await cache.write(KEY, '/repo', catalog());
    const viaRelative = catalogCacheKey('claude', '/repo/sub/..', '/bin/fish');
    await expect(cache.read(viaRelative)).resolves.not.toBeNull();
  });

  it('discards a corrupt cache file instead of handing it to the UI', async () => {
    await fs.promises.writeFile(
      path.join(directory, 'agent-model-catalogs.json'),
      '{ this is not json',
      'utf8'
    );
    await expect(makeCache().read(KEY)).resolves.toBeNull();
  });

  it('drops entries whose payload is not a catalog', async () => {
    const good = catalogCacheKey('codex', '/repo', '/bin/fish');
    await fs.promises.writeFile(
      path.join(directory, 'agent-model-catalogs.json'),
      JSON.stringify({
        schemaVersion: 2,
        entries: {
          [KEY]: {
            cachedAt: now,
            cwd: '/repo',
            catalog: { harness: 'claude' },
          },
          [good]: { cachedAt: now, cwd: '/repo', catalog: catalog() },
        },
      }),
      'utf8'
    );
    const cache = makeCache();
    await expect(cache.read(KEY)).resolves.toBeNull();
    await expect(cache.read(good)).resolves.not.toBeNull();
  });

  it('ignores a cache file from a different schema version', async () => {
    await fs.promises.writeFile(
      path.join(directory, 'agent-model-catalogs.json'),
      JSON.stringify({
        schemaVersion: 99,
        entries: { [KEY]: { cachedAt: now, cwd: '/repo', catalog: catalog() } },
      }),
      'utf8'
    );
    await expect(makeCache().read(KEY)).resolves.toBeNull();
  });

  it('leaves no temporary files behind after a write', async () => {
    await makeCache().write(KEY, '/repo', catalog());
    const entries = await fs.promises.readdir(directory);
    expect(entries).toEqual(['agent-model-catalogs.json']);
  });

  /* ---------------------------------------------------------------- *
   * BUG-033 — the size class                                          *
   * ---------------------------------------------------------------- */

  it('migrates a v1 file, recovering each row cwd from its key', async () => {
    await fs.promises.writeFile(
      path.join(directory, 'agent-model-catalogs.json'),
      JSON.stringify({
        schemaVersion: 1,
        entries: { [KEY]: { cachedAt: now, catalog: catalog() } },
      }),
      'utf8'
    );
    const cache = makeCache();
    await expect(cache.read(KEY)).resolves.not.toBeNull();

    // and the file it rewrote is v2, so nothing re-derives the cwd twice
    const raw = JSON.parse(
      await fs.promises.readFile(
        path.join(directory, 'agent-model-catalogs.json'),
        'utf8'
      )
    );
    expect(raw.schemaVersion).toBe(2);
    expect(raw.entries[KEY].cwd).toBe('/repo');
  });

  it('evicts the row for a retired worktree, not just refuses to serve it', async () => {
    const worktree = catalogCacheKey('claude', '/other', '/bin/fish');
    const cache = makeCache();
    await cache.write(KEY, '/repo', catalog());
    await cache.write(worktree, '/other', catalog());
    expect(await cache.size()).toBe(2);

    // The worktree is landed and removed, exactly as `agent:land` leaves it.
    live.delete('/other');
    await makeCache().write(KEY, '/repo', catalog());

    const raw = JSON.parse(
      await fs.promises.readFile(
        path.join(directory, 'agent-model-catalogs.json'),
        'utf8'
      )
    );
    expect(Object.keys(raw.entries)).toEqual([KEY]);
  });

  it('never grows past the stated entry bound, however many Projects are opened', async () => {
    const cache = makeCache();
    for (let index = 0; index < CATALOG_MAX_ENTRIES * 3; index += 1) {
      const cwd = `/worktree-${index}`;
      live.add(cwd);
      now += 1_000;
      await cache.write(
        catalogCacheKey('claude', cwd, '/bin/fish'),
        cwd,
        catalog()
      );
    }
    expect(await cache.size()).toBe(CATALOG_MAX_ENTRIES);

    // The survivors are the newest, so the working set stays warm.
    const newest = catalogCacheKey(
      'claude',
      `/worktree-${CATALOG_MAX_ENTRIES * 3 - 1}`,
      '/bin/fish'
    );
    await expect(makeCache().read(newest)).resolves.not.toBeNull();
    const oldest = catalogCacheKey('claude', '/worktree-0', '/bin/fish');
    await expect(makeCache().read(oldest)).resolves.toBeNull();
  });

  it('reclaims aged rows on load, without waiting for a probe', async () => {
    const cache = makeCache();
    await cache.write(KEY, '/repo', catalog());
    now += CATALOG_MAX_AGE_MS + 1;

    const reloaded = makeCache();
    await reloaded.read(KEY);
    expect(await reloaded.size()).toBe(0);
    const raw = JSON.parse(
      await fs.promises.readFile(
        path.join(directory, 'agent-model-catalogs.json'),
        'utf8'
      )
    );
    expect(raw.entries).toEqual({});
  });
});

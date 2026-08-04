import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  AgentModelCatalogCache,
  CATALOG_FRESH_MS,
  CATALOG_MAX_AGE_MS,
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

beforeEach(async () => {
  directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'exawatt-catalog-cache-')
  );
  now = 1_000_000;
});

afterEach(async () => {
  await fs.promises.rm(directory, { recursive: true, force: true });
});

const makeCache = () =>
  new AgentModelCatalogCache(
    () => directory,
    () => now
  );

const KEY = catalogCacheKey('claude', '/repo', '/bin/fish');

describe('AgentModelCatalogCache', () => {
  it('returns nothing before anything is written', async () => {
    await expect(makeCache().read(KEY)).resolves.toBeNull();
  });

  it('round-trips a catalog through disk, so a restart does not re-probe', async () => {
    await makeCache().write(KEY, catalog());

    // A brand-new instance, as after an app restart.
    const reread = await makeCache().read(KEY);
    expect(reread?.catalog.effectiveModel).toBe('opus[1m]');
    expect(reread?.fresh).toBe(true);
  });

  it('serves a stale catalog but reports it as not fresh', async () => {
    await makeCache().write(KEY, catalog());
    now += CATALOG_FRESH_MS + 1;

    const reread = await makeCache().read(KEY);
    expect(reread?.catalog.effectiveModel).toBe('opus[1m]');
    expect(reread?.fresh).toBe(false);
  });

  it('refuses a catalog that is too old to show at all', async () => {
    await makeCache().write(KEY, catalog());
    now += CATALOG_MAX_AGE_MS + 1;

    await expect(makeCache().read(KEY)).resolves.toBeNull();
  });

  it('refuses an entry written in the future rather than trusting a clock jump', async () => {
    await makeCache().write(KEY, catalog());
    now -= 60_000;

    await expect(makeCache().read(KEY)).resolves.toBeNull();
  });

  it('never retains a probe that did not produce a live catalog', async () => {
    const cache = makeCache();
    await cache.write(KEY, catalog({ catalogMode: 'configured-values' }));
    await expect(cache.read(KEY)).resolves.toBeNull();

    await cache.write(KEY, catalog({ catalogMode: 'unavailable' }));
    await expect(cache.read(KEY)).resolves.toBeNull();
  });

  it('keys separately per engine, Project, and shell', async () => {
    const cache = makeCache();
    await cache.write(KEY, catalog());

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
    await cache.write(KEY, catalog());
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
    await fs.promises.writeFile(
      path.join(directory, 'agent-model-catalogs.json'),
      JSON.stringify({
        schemaVersion: 1,
        entries: {
          [KEY]: { cachedAt: now, catalog: { harness: 'claude' } },
          good: { cachedAt: now, catalog: catalog() },
        },
      }),
      'utf8'
    );
    const cache = makeCache();
    await expect(cache.read(KEY)).resolves.toBeNull();
    await expect(cache.read('good')).resolves.not.toBeNull();
  });

  it('ignores a cache file from a different schema version', async () => {
    await fs.promises.writeFile(
      path.join(directory, 'agent-model-catalogs.json'),
      JSON.stringify({
        schemaVersion: 99,
        entries: { [KEY]: { cachedAt: now, catalog: catalog() } },
      }),
      'utf8'
    );
    await expect(makeCache().read(KEY)).resolves.toBeNull();
  });

  it('leaves no temporary files behind after a write', async () => {
    await makeCache().write(KEY, catalog());
    const entries = await fs.promises.readdir(directory);
    expect(entries).toEqual(['agent-model-catalogs.json']);
  });

  it('clears on request', async () => {
    const cache = makeCache();
    await cache.write(KEY, catalog());
    await cache.clear();
    await expect(cache.read(KEY)).resolves.toBeNull();
  });
});

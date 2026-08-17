import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  prepareDistribution,
  readPreparedDistribution,
  nextDistributionEnvironment,
  electronBuilderDistributionConfig,
} from './lib/distribution-build.mjs';

const officialFixture = new URL(
  './distribution.official.example.json',
  import.meta.url
);

test('absence resolves and writes the community contract', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'exawatt-distribution-'));
  const prepared = await prepareDistribution({ root, inputJson: undefined });
  assert.equal(prepared.contract.brand, null);
  assert.equal(prepared.contract.account, null);
  assert.equal(prepared.contract.services.productFeedback, null);
  assert.equal(
    prepared.digest,
    createHash('sha256').update(prepared.canonical).digest('hex')
  );
  assert.deepEqual(await readPreparedDistribution(root), prepared);
});

test('a valid official overlay is canonicalized before Next', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'exawatt-distribution-'));
  const inputJson = await readFile(officialFixture, 'utf8');
  const prepared = await prepareDistribution({ root, inputJson });
  assert.equal(prepared.contract.brand.productName, 'Exawatt');
  assert.equal(prepared.contract.services.projects, null);
});

test('a present invalid config fails instead of falling back', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'exawatt-distribution-'));
  for (const inputJson of ['', '   ', '{"schemaVersion":2}']) {
    await assert.rejects(
      prepareDistribution({ root, inputJson }),
      /distribution/i
    );
  }
});

test('poisoned legacy env cannot enable a community capability', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'exawatt-distribution-'));
  const prepared = await prepareDistribution({ root, inputJson: undefined });
  const env = nextDistributionEnvironment(prepared, {
    NEXT_PUBLIC_SUPABASE_URL: 'https://production.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'production-key',
    NEXT_PUBLIC_POSTHOG_KEY: 'production-analytics',
    NEXT_PUBLIC_POSTHOG_HOST: 'https://www.exawatt.ai/ingest',
    NEXT_PUBLIC_ANALYTICS_DISABLED: 'false',
  });
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, '');
  assert.equal(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, '');
  assert.equal('NEXT_PUBLIC_POSTHOG_KEY' in env, false);
  assert.equal('NEXT_PUBLIC_POSTHOG_HOST' in env, false);
  assert.equal('NEXT_PUBLIC_ANALYTICS_DISABLED' in env, false);
  assert.equal(env.NEXT_PUBLIC_EXAWATT_DISTRIBUTION_JSON, prepared.canonical);
});

test('tampering with the prepared artifact fails its digest check', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'exawatt-distribution-'));
  await prepareDistribution({ root, inputJson: undefined });
  const official = await readFile(officialFixture, 'utf8');
  await writeFile(
    path.join(root, '.exawatt-build', 'distribution.json'),
    official,
    'utf8'
  );
  await assert.rejects(readPreparedDistribution(root), /digest/i);
});

test('community Electron packaging has neutral identity and no protocol, feed, or branded icon', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'exawatt-distribution-'));
  const prepared = await prepareDistribution({ root, inputJson: undefined });
  const config = electronBuilderDistributionConfig(
    {
      appId: 'com.exawatt.app',
      productName: 'Exawatt',
      copyright: 'Copyright © 2024 Exawatt',
      protocols: [{ name: 'Exawatt', schemes: ['exawatt'] }],
      publish: { provider: 'generic', url: 'https://updates.exawatt.ai' },
      mac: {
        icon: 'electron/resources/icon.icns',
        extendInfo: {
          NSDocumentsFolderUsageDescription: 'Agents run through Exawatt.',
        },
      },
    },
    prepared.contract
  );
  assert.equal(config.appId, 'ai.exawatt.community');
  assert.equal(config.productName, 'Exawatt Community');
  assert.equal(config.protocols, undefined);
  assert.equal(config.publish, undefined);
  assert.equal(config.mac.icon, undefined);
  assert.equal(config.copyright, 'Copyright © 2024 Exawatt Community');
  assert.equal(
    config.mac.extendInfo.NSDocumentsFolderUsageDescription,
    'Agents run through Exawatt Community.'
  );
});

test('official Electron packaging derives identity, protocol, icon, and feed only from the contract', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'exawatt-distribution-'));
  const prepared = await prepareDistribution({
    root,
    inputJson: await readFile(officialFixture, 'utf8'),
  });
  const config = electronBuilderDistributionConfig(
    { mac: {}, publish: { provider: 'github' } },
    prepared.contract
  );
  assert.equal(config.appId, 'ai.exawatt.desktop');
  assert.equal(config.productName, 'Exawatt');
  assert.deepEqual(config.protocols, [
    { name: 'Exawatt', schemes: ['exawatt'] },
  ]);
  assert.equal(config.mac.icon, 'electron/resources/icon.icns');
  assert.deepEqual(config.publish, {
    provider: 'generic',
    url: 'https://updates.exawatt.ai/macos/arm64',
  });
});

test('operator custody is opt-in, fails loudly, and never downgrades', async t => {
  const { mkdtemp, writeFile, chmod, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const nodePath = await import('node:path');
  const { resolveDistributionInput, readOfficialCustody } = await import(
    './lib/distribution-build.mjs'
  );

  const dir = await mkdtemp(nodePath.join(tmpdir(), 'exa-custody-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const custody = nodePath.join(dir, 'distribution.official.json');
  const official = JSON.stringify({
    schemaVersion: 1,
    brand: {
      appId: 'ai.exawatt.app',
      productName: 'Exawatt',
      protocolScheme: 'exawatt',
      iconPath: 'electron/resources/icon.icns',
      updateChannel: 'stable',
    },
    account: null,
    services: {
      productFeedback: null,
      operatorStats: null,
      projects: null,
      preferences: null,
      accountData: null,
    },
    enrichment: {
      contextLabels: null,
      conversationSummaries: null,
      goalVisuals: null,
    },
    analytics: null,
    updates: null,
  });
  await writeFile(custody, official, { mode: 0o600 });

  // An explicit config wins and custody is never consulted.
  assert.deepEqual(
    await resolveDistributionInput({
      EXAWATT_DISTRIBUTION_CONFIG_JSON: official,
      EXAWATT_DISTRIBUTION_PROFILE: 'official',
    }),
    { inputJson: official, source: 'env' }
  );

  // No profile means community, even though custody exists on this machine.
  assert.deepEqual(await resolveDistributionInput({}), {
    inputJson: undefined,
    source: 'community-default',
  });
  assert.deepEqual(
    await resolveDistributionInput({ EXAWATT_DISTRIBUTION_PROFILE: 'community' }),
    { inputJson: undefined, source: 'community-default' }
  );

  // A declared-official build reads custody.
  assert.equal(await readOfficialCustody(custody), official);

  // Group-readable custody refuses rather than proceeding.
  await chmod(custody, 0o644);
  await assert.rejects(() => readOfficialCustody(custody), /group\/world readable/);
  await chmod(custody, 0o600);

  // Missing custody names the path instead of downgrading to community.
  const absent = nodePath.join(dir, 'nope.json');
  await assert.rejects(() => readOfficialCustody(absent), /custody is missing/);

  // An unknown profile is a typo, not a community build.
  await assert.rejects(
    () => resolveDistributionInput({ EXAWATT_DISTRIBUTION_PROFILE: 'offical' }),
    /must be "official" or "community"/
  );
});

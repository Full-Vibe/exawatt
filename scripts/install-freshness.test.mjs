import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { installFreshness, assertInstallFresh } from './lib/install-freshness.mjs';

async function fixture({ declared, installed }) {
  const root = await mkdtemp(path.join(tmpdir(), 'exa-freshness-'));
  if (declared !== undefined) {
    await writeFile(path.join(root, 'pnpm-lock.yaml'), declared);
  }
  if (installed !== undefined) {
    await mkdir(path.join(root, 'node_modules', '.pnpm'), { recursive: true });
    await writeFile(path.join(root, 'node_modules', '.pnpm', 'lock.yaml'), installed);
  }
  return root;
}

test('a checkout installed from its own lockfile is fresh', async () => {
  const root = await fixture({ declared: 'lockfileVersion: 9\n', installed: 'lockfileVersion: 9\n' });
  assert.deepEqual(await installFreshness(root), { fresh: true, reason: null });
  await assertInstallFresh(root, { task: 'x' }); // does not throw
});

test('a checkout installed from a DIFFERENT lockfile is stale', async () => {
  // The real case: a dependency was removed from the lockfile but is still
  // on disk, so anything enumerating node_modules over-reports.
  const root = await fixture({ declared: 'lockfileVersion: 9\n', installed: 'lockfileVersion: 9\nextra: true\n' });
  const { fresh, reason } = await installFreshness(root);
  assert.equal(fresh, false);
  assert.match(reason, /different lockfile/);
});

test('never-installed and lockfile-less checkouts are stale, each named', async () => {
  const never = await fixture({ declared: 'lockfileVersion: 9\n' });
  assert.match((await installFreshness(never)).reason, /never been installed/);
  const none = await fixture({ installed: 'lockfileVersion: 9\n' });
  assert.match((await installFreshness(none)).reason, /no pnpm-lock\.yaml/);
});

test('the thrown message names the remedy and warns against regenerating', async () => {
  const root = await fixture({ declared: 'a\n', installed: 'b\n' });
  await assert.rejects(
    () => assertInstallFresh(root, { task: '`pnpm licenses:generate`' }),
    error => {
      assert.match(error.message, /pnpm install/);
      assert.match(error.message, /Do NOT regenerate/);
      assert.match(error.message, /licenses:generate/);
      return true;
    }
  );
});

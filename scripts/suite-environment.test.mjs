import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * BUG-047: `pnpm test:run` was red on every machine in the building because one
 * unconditional test depended on ambient environment nobody sets.
 *
 * The mechanism is narrow and worth naming, because it is the only way the
 * vitest suite can acquire an ambient dependency at all: a test spawns a
 * REPOSITORY SCRIPT and hands the child `{ ...process.env }`. The child then
 * inherits whatever the author's shell happens to carry. The day a script
 * starts refusing without a variable — `8f53d3f3` made the Supabase publisher
 * require `EXAWATT_DISTRIBUTION_CONFIG_JSON` at module load — the suite fails
 * for everyone who does not have it, which here was everyone.
 *
 * So the rule is: a suite test that runs a repository script STATES the child's
 * environment. Not because inheritance is untidy, but because writing the
 * environment down is what makes the author see the input the child requires,
 * at the moment they can still supply it as a fixture. Skipping is not the
 * alternative — this repository has recorded that disease four times (BUG-010,
 * BUG-011, BUG-014, BUG-043).
 *
 * This is deliberately not a general `process.env` lint. Tests that set and
 * restore their OWN process's variables are fine, and a test that spawns a
 * shell or an agent harness genuinely wants the real environment. Only a
 * repository script under `scripts/` is covered, because only that pair —
 * repo test, repo script — is a contract both sides of which we own.
 */

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * `scripts/*.test.mjs` are node:test files run by `test:agent-delivery`, not
 * part of the vitest suite, and they legitimately drive scripts through the
 * shell. Everything else here is build output or vendored code.
 */
const PRUNED = new Set([
  '.git',
  '.next',
  '.exawatt-build',
  'node_modules',
  'dist',
  'dist-electron',
  'release',
  'scripts',
  'coverage',
]);

const SUITE_TEST_FILE = /\.(?:test|spec)\.tsx?$/;
const REPOSITORY_SCRIPT = /scripts\/[A-Za-z0-9_./-]+\.(?:cjs|mjs)/;
const CHILD_PROCESS_CALL =
  /\b(?:execFileSync|execFile|execSync|spawnSync|spawn)\(/;
const AMBIENT_SPREAD = /\.\.\.\s*process\.env\b/;
const EXPLICIT_CHILD_ENV = /\benv:\s*\{/;

async function suiteTestFiles(directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (PRUNED.has(entry.name)) continue;
      found.push(...(await suiteTestFiles(absolute)));
    } else if (SUITE_TEST_FILE.test(entry.name)) {
      found.push(absolute);
    }
  }
  return found;
}

async function testsThatRunRepositoryScripts() {
  const files = await suiteTestFiles();
  const running = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    if (REPOSITORY_SCRIPT.test(source) && CHILD_PROCESS_CALL.test(source)) {
      running.push({ relative: path.relative(root, file), source });
    }
  }
  return running.sort((a, b) => a.relative.localeCompare(b.relative));
}

test('a suite test that runs a repository script states the child environment', async () => {
  const running = await testsThatRunRepositoryScripts();

  // Without this the rule rots into a vacuous pass the moment the discovery
  // walk stops finding anything — the shape of BUG-010/011/014/043.
  assert.ok(
    running.length > 0,
    'expected to find suite tests that spawn repository scripts; the discovery walk is broken'
  );

  for (const { relative, source } of running) {
    assert.doesNotMatch(
      source,
      AMBIENT_SPREAD,
      `${relative} spreads process.env into a repository script. Pass the ` +
        'variables the script needs explicitly, and supply any required ' +
        'contract as a fixture, so the suite does not depend on the shell.'
    );
    assert.match(
      source,
      EXPLICIT_CHILD_ENV,
      `${relative} runs a repository script without stating the child's env. ` +
        'Pass `env: { ... }` — `env: {}` if the script needs nothing — so a ' +
        'new required variable is visible here rather than red on someone ' +
        "else's machine."
    );
  }
});

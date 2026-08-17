// ENG-030 WP5a. These are the properties an outside contributor's fork depends
// on, asserted against the workflow files themselves so a later edit cannot
// quietly take them away. The one that matters most is negative:
// `pull_request_target` runs a stranger's branch with the BASE repository's
// credentials, and no workflow here may ever use it.

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workflowsDirectory = path.join(root, '.github', 'workflows');
const immutableAction = /^[^\s@]+@[0-9a-f]{40}$/u;

async function workflowSources() {
  const files = (await readdir(workflowsDirectory))
    .filter(file => file.endsWith('.yml') || file.endsWith('.yaml'))
    .sort();

  return Promise.all(
    files.map(async file => {
      const source = await readFile(
        path.join(workflowsDirectory, file),
        'utf8'
      );
      return { file, source, workflow: parse(source) };
    })
  );
}

// YAML 1.1 readers turn the `on:` key into boolean `true`. The parser here is
// 1.2 and keeps the string, but reading both costs one line and removes a
// silent way for every trigger assertion below to pass vacuously.
function triggers(workflow) {
  return workflow?.on ?? workflow?.[true] ?? {};
}

function actionReferences(source) {
  return [...source.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gmu)].map(
    match => match[1]
  );
}

function runCommands(workflow) {
  return Object.values(workflow.jobs ?? {})
    .flatMap(job => job.steps ?? [])
    .map(step => step.run)
    .filter(Boolean)
    .join('\n');
}

test('every external action is pinned and checkout never persists credentials', async () => {
  const sources = await workflowSources();
  const references = sources.flatMap(({ file, source }) =>
    actionReferences(source).map(reference => ({ file, reference }))
  );

  assert.ok(references.length > 0, 'expected at least one action reference');
  for (const { file, reference } of references) {
    assert.match(reference, immutableAction, `${file}: ${reference}`);
  }

  for (const { file, workflow } of sources) {
    for (const job of Object.values(workflow.jobs ?? {})) {
      for (const step of job.steps ?? []) {
        if (!step.uses?.startsWith('actions/checkout@')) continue;
        assert.equal(
          step.with?.['persist-credentials'],
          false,
          `${file} checkout credentials`
        );
      }
    }
  }
});

test('no workflow ever runs untrusted code with base-repository authority', async () => {
  for (const { file, workflow } of await workflowSources()) {
    assert.equal(
      Object.hasOwn(triggers(workflow), 'pull_request_target'),
      false,
      `${file} must never use pull_request_target`
    );
  }
});

test('pull-request workflows are fork-safe, secretless, and Linux-only', async () => {
  const sources = await workflowSources();
  const pullRequestWorkflows = sources.filter(({ workflow }) =>
    Object.hasOwn(triggers(workflow), 'pull_request')
  );

  assert.ok(
    pullRequestWorkflows.length > 0,
    'expected at least one pull-request workflow'
  );

  for (const { file, source, workflow } of pullRequestWorkflows) {
    assert.equal(workflow.permissions?.contents, 'read', `${file} permissions`);
    assert.doesNotMatch(source, /\$\{\{\s*secrets\./u, `${file} secrets`);

    for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
      assert.equal(job['runs-on'], 'ubuntu-latest', `${file}:${jobName}`);
      assert.ok(job['timeout-minutes'] > 0, `${file}:${jobName} timeout`);
    }
  }
});

test('the paid macOS runner belongs to the release workflow alone', async () => {
  for (const { file, workflow } of await workflowSources()) {
    if (file === 'release-macos.yml') continue;
    for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
      assert.doesNotMatch(
        String(job['runs-on'] ?? ''),
        /macos/iu,
        `${file}:${jobName} must not bill macOS minutes`
      );
    }
  }
});

test('CI compiles both applications and builds without hosted-service configuration', async () => {
  const source = await readFile(
    path.join(workflowsDirectory, 'ci.yml'),
    'utf8'
  );
  const workflow = parse(source);
  const commands = runCommands(workflow);

  assert.equal(workflow.permissions?.contents, 'read');
  // `tsconfig.json` excludes `electron/`, so type-check alone leaves the
  // desktop main process unproven.
  assert.match(commands, /pnpm electron:compile/u);
  assert.match(commands, /pnpm publication:check/u);
  assert.match(commands, /pnpm verify:community-build/u);
  assert.doesNotMatch(source, /NEXT_PUBLIC_SUPABASE_/u);
  assert.doesNotMatch(source, /\$\{\{\s*secrets\./u);

  // Every gate runs for a fork too. A visibility or event condition on one of
  // these would mean our green and a contributor's green prove different
  // things.
  for (const step of workflow.jobs.test.steps) {
    assert.equal(step.if, undefined, `ci.yml step "${step.name ?? step.uses}"`);
  }
});

test('security workflows preserve their narrow event and permission boundaries', async () => {
  const sources = Object.fromEntries(
    (await workflowSources()).map(entry => [entry.file, entry])
  );

  const codeql = sources['codeql.yml'].workflow;
  assert.equal(codeql.permissions.contents, 'read');
  assert.equal(codeql.jobs.analyze.permissions['security-events'], 'write');
  assert.match(codeql.jobs.analyze.if, /visibility == 'public'/u);

  const dependencyReview = sources['dependency-review.yml'].workflow;
  assert.deepEqual(Object.keys(triggers(dependencyReview)), ['pull_request']);
  assert.match(dependencyReview.jobs.review.if, /visibility == 'public'/u);
  assert.equal(
    dependencyReview.jobs.review.steps[0].with['fail-on-severity'],
    'high'
  );

  // gitleaks is installed from a checksum-pinned release instead of an action
  // that would need an organization license key.
  const gitleaks = sources['gitleaks.yml'];
  assert.match(gitleaks.workflow.jobs.gitleaks.if, /visibility == 'public'/u);
  assert.match(gitleaks.source, /GITLEAKS_VERSION: 8\.30\.1/u);
  assert.match(gitleaks.source, /GITLEAKS_LINUX_X64_SHA256: [0-9a-f]{64}/u);
  assert.match(gitleaks.source, /sha256sum --check/u);

  const release = sources['release-macos.yml'].workflow;
  assert.deepEqual(Object.keys(triggers(release)), ['workflow_dispatch']);
  assert.equal(release.permissions.contents, 'write');
  assert.match(release.jobs.release['runs-on'], /macos-/u);
  // A hung macOS job bills at roughly 10x Linux against a hard-stop budget.
  assert.ok(release.jobs.release['timeout-minutes'] > 0);
});

test('Dependabot covers pnpm dependencies and immutable workflow pins', async () => {
  const dependabot = parse(
    await readFile(path.join(root, '.github', 'dependabot.yml'), 'utf8')
  );
  const ecosystems = dependabot.updates.map(
    update => update['package-ecosystem']
  );

  assert.deepEqual(ecosystems.slice().sort(), ['github-actions', 'npm']);
  for (const update of dependabot.updates) {
    assert.equal(update.directory, '/');
    assert.ok(update.schedule.interval, 'a cadence is declared');
    // Each pull request costs a full CI job against a $15/month hard stop.
    assert.ok(
      update['open-pull-requests-limit'] <= 5,
      `${update['package-ecosystem']} pull-request budget`
    );
  }
});

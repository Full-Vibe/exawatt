import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUDIT_TREE_FILES,
  assertAuditPayload,
  auditCommittedTree,
  evaluateProductionAudit,
  formatProductionAudit,
  normalizeProductionAudit,
  productionAuditJson,
} from './lib/production-dependency-audit.mjs';

const EMPTY_BASELINE = { schemaVersion: 1, allowedAdvisories: {} };

function auditFixture(advisories = {}) {
  return { advisories, metadata: { vulnerabilities: {} } };
}

function advisory({
  id = 'GHSA-aaaa-bbbb-cccc',
  packageName = 'fixture-parser',
  severity = 'high',
} = {}) {
  return {
    github_advisory_id: id,
    module_name: packageName,
    severity,
    title: 'Fixture parser advisory',
    url: `https://github.com/advisories/${id}`,
    findings: [
      {
        version: '1.0.0',
        paths: ['.>fixture-parser'],
      },
    ],
  };
}

test('a clean production audit produces a deterministic passing report', () => {
  const result = evaluateProductionAudit(
    normalizeProductionAudit(auditFixture()),
    EMPTY_BASELINE
  );
  assert.equal(result.status, 'pass');
  assert.equal(result.total, 0);
  assert.equal(
    formatProductionAudit(result),
    '[production-audit] PASS 0 advisories (critical=0 high=0 moderate=0 low=0 info=0)\n'
  );
  assert.deepEqual(JSON.parse(productionAuditJson(result)), {
    schemaVersion: 1,
    ...result,
  });
});

test('an unbaselined advisory fails closed with normalized evidence', () => {
  const normalized = normalizeProductionAudit(auditFixture({ 42: advisory() }));
  const result = evaluateProductionAudit(normalized, EMPTY_BASELINE);
  assert.equal(result.status, 'fail');
  assert.deepEqual(result.unexpected, ['GHSA-aaaa-bbbb-cccc']);
  assert.deepEqual(normalized.advisories[0].versions, ['1.0.0']);
  assert.deepEqual(normalized.advisories[0].paths, ['.>fixture-parser']);
});

test('a baseline can only record a documented non-runtime disposition', () => {
  const normalized = normalizeProductionAudit(
    auditFixture({ 42: advisory({ severity: 'moderate' }) })
  );
  const invalid = evaluateProductionAudit(normalized, {
    schemaVersion: 1,
    allowedAdvisories: {
      'GHSA-aaaa-bbbb-cccc': {
        package: 'fixture-parser',
        severity: 'moderate',
        disposition: 'accepted-risk',
        rationale: 'Short.',
      },
    },
  });
  assert.equal(invalid.status, 'fail');
  assert.equal(invalid.baselineErrors.length, 2);

  const valid = evaluateProductionAudit(normalized, {
    schemaVersion: 1,
    allowedAdvisories: {
      'GHSA-aaaa-bbbb-cccc': {
        package: 'fixture-parser',
        severity: 'moderate',
        disposition: 'non-runtime',
        rationale: 'The parser is absent from every production artifact.',
      },
    },
  });
  assert.equal(valid.status, 'pass');
  assert.deepEqual(valid.allowed, ['GHSA-aaaa-bbbb-cccc']);
});

test('stale or mismatched baseline entries fail instead of hiding drift', () => {
  const baselineEntry = {
    package: 'fixture-parser',
    severity: 'high',
    disposition: 'non-runtime',
    rationale: 'The parser is absent from every production artifact.',
  };
  const stale = evaluateProductionAudit(
    normalizeProductionAudit(auditFixture()),
    {
      schemaVersion: 1,
      allowedAdvisories: { 'GHSA-aaaa-bbbb-cccc': baselineEntry },
    }
  );
  assert.deepEqual(stale.stale, ['GHSA-aaaa-bbbb-cccc']);
  assert.equal(stale.status, 'fail');

  const mismatch = evaluateProductionAudit(
    normalizeProductionAudit(auditFixture({ 42: advisory() })),
    {
      schemaVersion: 1,
      allowedAdvisories: {
        'GHSA-aaaa-bbbb-cccc': {
          ...baselineEntry,
          package: 'another-package',
        },
      },
    }
  );
  assert.deepEqual(mismatch.mismatched, [
    { id: 'GHSA-aaaa-bbbb-cccc', fields: ['package'] },
  ]);
  assert.equal(mismatch.status, 'fail');
});

// BUG-127: a pull request is judged by what it adds, `master` by zero.
const INHERITED = advisory({ id: 'GHSA-inhe-rite-dddd', packageName: 'old' });
const CLEARED = advisory({ id: 'GHSA-clea-red0-eeee', packageName: 'bumped' });
const INTRODUCED = advisory({ id: 'GHSA-intr-oduc-ffff', packageName: 'new' });

function againstBase(head, base) {
  return evaluateProductionAudit(
    normalizeProductionAudit(auditFixture(head)),
    EMPTY_BASELINE,
    {
      base: normalizeProductionAudit(auditFixture(base)),
      baseLabel: 'abc123',
    }
  );
}

test('a change that removes advisories passes while its base still carries others', () => {
  const result = againstBase({ 1: INHERITED }, { 1: INHERITED, 2: CLEARED });
  assert.equal(result.status, 'pass');
  assert.equal(result.mode, 'against-base');
  assert.deepEqual(result.inherited, ['GHSA-inhe-rite-dddd']);
  assert.deepEqual(result.resolved, ['GHSA-clea-red0-eeee']);
  assert.deepEqual(result.unexpected, []);
  const report = formatProductionAudit(result);
  assert.match(
    report,
    /^\[production-audit\] PASS 1 advisories against abc123 \(introduced=0 inherited=1 resolved=1\)/u
  );
  assert.match(report, /GHSA-inhe-rite-dddd old \[inherited from base\]/u);
  assert.match(report, /resolved: GHSA-clea-red0-eeee/u);
});

test('a change that introduces an advisory fails even when it clears another', () => {
  const result = againstBase({ 1: INTRODUCED }, { 2: CLEARED });
  assert.equal(result.status, 'fail');
  assert.deepEqual(result.unexpected, ['GHSA-intr-oduc-ffff']);
  assert.match(
    formatProductionAudit(result),
    /GHSA-intr-oduc-ffff new \[introduced\]/u
  );
});

test('without a base the inherited advisory still fails: master keeps zero', () => {
  const result = evaluateProductionAudit(
    normalizeProductionAudit(auditFixture({ 1: INHERITED })),
    EMPTY_BASELINE
  );
  assert.equal(result.mode, 'zero-baseline');
  assert.equal(result.status, 'fail');
  assert.deepEqual(result.unexpected, ['GHSA-inhe-rite-dddd']);
});

test('a baseline entry the change cleared is stale only for master', () => {
  const baseline = {
    schemaVersion: 1,
    allowedAdvisories: {
      'GHSA-clea-red0-eeee': {
        package: 'bumped',
        severity: 'high',
        disposition: 'non-runtime',
        rationale: 'The package is absent from every production artifact.',
      },
    },
  };
  const head = normalizeProductionAudit(auditFixture());
  const onPullRequest = evaluateProductionAudit(head, baseline, {
    base: normalizeProductionAudit(auditFixture({ 2: CLEARED })),
  });
  assert.equal(onPullRequest.status, 'pass');
  assert.deepEqual(onPullRequest.stale, ['GHSA-clea-red0-eeee']);
  assert.equal(evaluateProductionAudit(head, baseline).status, 'fail');
});

test('an audit that did not run is a failure, never zero advisories', () => {
  assert.throws(
    () =>
      assertAuditPayload({
        error: {
          code: 'ERR_PNPM_AUDIT_BAD_RESPONSE',
          message: 'registry down',
        },
      }),
    /did not run: ERR_PNPM_AUDIT_BAD_RESPONSE registry down/u
  );
  assert.throws(() => assertAuditPayload({}), /not an audit report/u);
  assert.throws(() => assertAuditPayload(null), /not an audit report/u);
  const report = auditFixture();
  assert.equal(assertAuditPayload(report), report);
});

function treeHarness({ show = () => 'contents', audit } = {}) {
  const calls = { written: [], removed: [], audited: [] };
  return {
    calls,
    options: {
      root: '/repo',
      makeTempDirectory: async () => '/tmp/base',
      writeTreeFile: async (directory, file, contents) =>
        calls.written.push([directory, file, contents]),
      removeDirectory: async directory => calls.removed.push(directory),
      run: async (command, args, { cwd }) => {
        if (command === 'git') return { stdout: show(args[1]) };
        calls.audited.push(cwd);
        return audit();
      },
    },
  };
}

test('the base tree is audited from its committed manifests, then removed', async () => {
  const findings = auditFixture({ 1: INHERITED });
  const { calls, options } = treeHarness({
    show: spec => `bytes of ${spec}`,
    // `pnpm audit` exits non-zero when it finds anything; the report rides on the error.
    audit: async () => {
      throw Object.assign(new Error('exit 1'), {
        stdout: JSON.stringify(findings),
      });
    },
  });
  const payload = await auditCommittedTree('abc123', options);
  assert.deepEqual(payload, findings);
  assert.deepEqual(
    calls.written.map(([, file, contents]) => [file, contents]),
    AUDIT_TREE_FILES.map(file => [file, `bytes of abc123:${file}`])
  );
  assert.deepEqual(calls.audited, ['/tmp/base']);
  assert.deepEqual(calls.removed, ['/tmp/base']);
});

test('a base that cannot be read fails instead of reading as a clean base', async () => {
  const unreadable = treeHarness({
    show: () => {
      throw Object.assign(new Error('git show'), {
        stderr: "fatal: invalid object name 'gone'.",
      });
    },
  });
  await assert.rejects(
    auditCommittedTree('gone', unreadable.options),
    /cannot read package\.json at gone: fatal: invalid object name/u
  );
  assert.deepEqual(unreadable.calls.removed, ['/tmp/base']);

  const offline = treeHarness({
    audit: async () => {
      throw Object.assign(new Error('exit 1'), {
        stdout: JSON.stringify({ error: { code: 'ENOTFOUND' } }),
      });
    },
  });
  await assert.rejects(
    auditCommittedTree('abc123', offline.options),
    /the audit of abc123 did not run: ENOTFOUND/u
  );
});

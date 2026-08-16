import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateProductionAudit,
  formatProductionAudit,
  normalizeProductionAudit,
  productionAuditJson,
} from './lib/production-dependency-audit.mjs';

const EMPTY_BASELINE = { schemaVersion: 1, allowedAdvisories: {} };

function auditFixture(advisories = {}) {
  return { advisories };
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

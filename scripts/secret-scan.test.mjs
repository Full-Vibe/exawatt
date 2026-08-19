import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  GITLEAKS_ARCHIVE_SHA256,
  GITLEAKS_VERSION,
  releaseTarget,
} from './secret-scan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relative) {
  return readFileSync(path.join(ROOT, relative), 'utf8');
}

const CONFIG = read('scripts/gitleaks.toml');
const WORKFLOW = read('.github/workflows/gitleaks.yml');

test('the local scan pins the same gitleaks release public CI installs', () => {
  assert.match(
    WORKFLOW,
    new RegExp(
      `GITLEAKS_VERSION:\\s*${GITLEAKS_VERSION.replace(/\./gu, '\\.')}\\b`,
      'u'
    ),
    'the workflow and scripts/secret-scan.mjs must install the same gitleaks version'
  );
  assert.match(
    WORKFLOW,
    new RegExp(
      `GITLEAKS_LINUX_X64_SHA256:\\s*${GITLEAKS_ARCHIVE_SHA256.linux_x64}\\b`,
      'u'
    ),
    'the workflow and scripts/secret-scan.mjs must pin the same linux_x64 archive'
  );
});

test('every pinned platform resolves to its own checksummed archive', () => {
  for (const [platform, arch] of [
    ['darwin', 'arm64'],
    ['darwin', 'x64'],
    ['linux', 'arm64'],
    ['linux', 'x64'],
  ]) {
    const target = releaseTarget(platform, arch);
    assert.match(target.sha256, /^[0-9a-f]{64}$/u);
    assert.ok(target.url.endsWith(target.archive));
    assert.equal(target.sha256, GITLEAKS_ARCHIVE_SHA256[target.key]);
  }
  assert.throws(
    () => releaseTarget('win32', 'x64'),
    /no pinned gitleaks build/u
  );
});

test('both scans run the repository configuration, not gitleaks defaults alone', () => {
  assert.match(WORKFLOW, /--config scripts\/gitleaks\.toml/u);
  assert.match(read('scripts/secret-scan.mjs'), /'scripts\/gitleaks\.toml'/u);
  assert.match(
    CONFIG,
    /\[extend\]\s*\nuseDefault = true/u,
    'replacing the default ruleset silently drops every rule gitleaks adds upstream'
  );
});

// The reason this gate is worth anything is that an allowlisted entry cannot
// hide a neighbouring real credential. A path, file, or commit allowlist gives
// that away wholesale — every future secret under that path becomes invisible —
// so the configuration is allowed to forgive a VALUE and nothing else.
test('the public allowlist forgives exact values, never paths or commits', () => {
  const blocks = CONFIG.split(/^\[\[allowlists\]\]$/mu).slice(1);
  assert.ok(
    blocks.length > 0,
    'expected at least one reviewed allowlist entry'
  );
  for (const block of blocks) {
    for (const forbidden of ['paths', 'files', 'commits', 'stopwords']) {
      assert.doesNotMatch(
        block,
        new RegExp(`^\\s*${forbidden}\\s*=`, 'mu'),
        `scripts/gitleaks.toml must not allowlist by ${forbidden}`
      );
    }
    assert.match(
      block,
      /^regexTarget = "secret"$/mu,
      'every allowlist entry must be scoped to the secret value itself'
    );
    assert.match(
      block,
      /^description = """/mu,
      'every allowlist entry must record why the value is not a credential'
    );
    for (const expression of block.matchAll(/'''(.+?)'''/gsu)) {
      assert.match(
        expression[1],
        /^\^.*\$$/su,
        'an allowlist regex must be anchored so it forgives one literal value'
      );
    }
  }
});

// `.gitleaksignore` is the private half of the same rule. Fingerprints are
// `commit:file:rule:startLine`, so an entry dies with the revision it names and
// cannot spread to a path.
//
// The assertion is conditional on the file EXISTING, and that is a property
// rather than a hole: the file is PRIVATE-classified, so a public checkout —
// whose history is a rewrite with different commit SHAs, where a fingerprint
// would match nothing — correctly has none. A checkout that does carry one
// still has to justify every line in it.
test('reviewed findings are addressed by fingerprint, never by path', () => {
  let source;
  try {
    source = read('.gitleaksignore');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return;
  }
  const entries = source
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
  assert.ok(entries.length > 0, 'an empty .gitleaksignore should be deleted');
  for (const entry of entries) {
    assert.match(
      entry,
      /^[0-9a-f]{40}:[^:]+:[a-z0-9-]+:\d+$/u,
      'every .gitleaksignore entry must be a commit-scoped fingerprint'
    );
  }
  const manifest = JSON.parse(read('scripts/open-source-paths.manifest.json'));
  const exception = manifest.exceptions.find(
    entry => entry.path === '.gitleaksignore'
  );
  assert.equal(
    exception?.classification,
    'PRIVATE',
    'a checkout holding fingerprints must classify them private'
  );
});

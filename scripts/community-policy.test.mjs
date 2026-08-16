import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function source(relativePath) {
  return readFile(path.join(ROOT, relativePath), 'utf8');
}

test('community health contract is complete and contains no template placeholders', async () => {
  const required = [
    'CLA.md',
    'CODE_OF_CONDUCT.md',
    'CONTRIBUTING.md',
    'GOVERNANCE.md',
    'SECURITY.md',
    'SUPPORT.md',
    'TRADEMARKS.md',
    '.github/CODEOWNERS',
    '.github/PULL_REQUEST_TEMPLATE.md',
    '.github/ISSUE_TEMPLATE/bug_report.yml',
    '.github/ISSUE_TEMPLATE/roadmap_proposal.yml',
    '.github/ISSUE_TEMPLATE/config.yml',
  ];

  for (const relativePath of required) {
    const contents = await source(relativePath);
    assert.ok(contents.trim(), `${relativePath} must not be empty`);
    assert.doesNotMatch(
      contents,
      /\[NOTE:|TODO|TBD/i,
      `${relativePath} has an unresolved placeholder`
    );
  }
});

test('CLA preserves ownership, commercial licensing, permanent OSI availability, and transfer', async () => {
  const cla = await source('CLA.md');
  assert.match(cla, /Full Vibe AI/);
  assert.match(cla, /You reserve all right, title, and interest/);
  assert.match(cla, /proprietary software\s+license/i);
  assert.match(
    cla,
    /also makes Your Contribution available\s+under the terms of an OSI-approved open-source license/i
  );
  assert.match(
    cla,
    /perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable/i
  );
  assert.match(cla, /successors and assigns/i);
  assert.match(cla, /may assign or transfer this Agreement/i);
  assert.match(cla, /Element Contributor License Agreement v1\.0/);
});

test('governance and contribution policy encode the accepted operating model', async () => {
  const [contributing, governance, pullRequest] = await Promise.all([
    source('CONTRIBUTING.md'),
    source('GOVERNANCE.md'),
    source('.github/PULL_REQUEST_TEMPLATE.md'),
  ]);

  assert.match(governance, /operator-led/i);
  assert.match(governance, /External contributors submit pull requests/i);
  assert.match(
    governance,
    /authorized\s+maintainer agents may push through the direct landing queue/i
  );
  assert.match(governance, /public.*product decisions/is);
  assert.match(contributing, /Agent Source and harness adapters/i);
  assert.match(
    contributing,
    /Demo Mode and test or evaluation infrastructure/i
  );
  assert.match(contributing, /design-locked/i);
  assert.match(contributing, /AI-assisted work is welcome/i);
  assert.match(pullRequest, /Runtime evidence/);
  assert.match(pullRequest, /AI assistance and provenance/);
  assert.match(
    pullRequest,
    /Community builds do not gain Exawatt service configuration or calls/
  );
});

test('trademark policy makes unofficial distribution identity complete', async () => {
  const trademarks = await source('TRADEMARKS.md');
  for (const boundary of [
    'product and executable name',
    'icon and other product branding',
    'macOS bundle identifier',
    'URL protocol handler',
    'signing and notarization identity',
    'update channel and release metadata',
    'hosted-service endpoints',
  ]) {
    assert.match(trademarks, new RegExp(boundary, 'i'));
  }
  assert.match(trademarks, /source checkout.*is not\s+official/is);
  assert.match(trademarks, /Exawatt Ready.*reserved/is);
  assert.match(trademarks, /Mozilla Trademark Guidelines/);
  assert.match(trademarks, /Element Trademark Policy/);
});

test('security, conduct, support, and ownership use verified public routes', async () => {
  const [security, conduct, support, codeowners] = await Promise.all([
    source('SECURITY.md'),
    source('CODE_OF_CONDUCT.md'),
    source('SUPPORT.md'),
    source('.github/CODEOWNERS'),
  ]);
  assert.match(security, /security\/advisories\/new/);
  assert.match(security, /never open a public vulnerability issue/i);
  assert.match(conduct, /Contributor Covenant, version 3\.0/i);
  assert.match(conduct, /legal@exawatt\.ai/);
  assert.match(support, /github\.com\/Full-Vibe\/exawatt\/discussions/);
  assert.match(codeowners, /^\* @JakeSc$/m);
});

test('issue forms parse and route private reports away from public issues', async () => {
  const bug = parseYaml(await source('.github/ISSUE_TEMPLATE/bug_report.yml'));
  const proposal = parseYaml(
    await source('.github/ISSUE_TEMPLATE/roadmap_proposal.yml')
  );
  const config = parseYaml(await source('.github/ISSUE_TEMPLATE/config.yml'));

  assert.equal(bug.name, 'Bug report');
  assert.ok(bug.body.some(entry => entry.id === 'reproduction'));
  assert.ok(bug.body.some(entry => entry.id === 'distribution'));
  assert.equal(proposal.name, 'Roadmap proposal');
  assert.ok(proposal.body.some(entry => entry.id === 'boundaries'));
  assert.equal(config.blank_issues_enabled, false);
  assert.ok(
    config.contact_links.some(link =>
      link.url.includes('/security/advisories/new')
    )
  );
  assert.ok(
    config.contact_links.some(link => link.url.includes('/discussions'))
  );
});

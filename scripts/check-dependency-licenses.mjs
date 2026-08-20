#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';

import { assertInstallFresh } from './lib/install-freshness.mjs';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOTICE_PATH = path.join(ROOT, 'THIRD_PARTY_NOTICES.md');

export const ALLOWED_LICENSE_EXPRESSIONS = new Set([
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'CC-BY-4.0',
  'CC0-1.0',
  'ISC',
  'LGPL-3.0-or-later',
  'MIT',
  'MIT-0',
  'MPL-2.0',
  'Python-2.0',
  'WTFPL',
  'Zlib',
  '(AFL-2.1 OR BSD-3-Clause)',
  '(Apache-2.0 AND MIT)',
  '(MIT OR CC0-1.0)',
  '(MPL-2.0 OR Apache-2.0)',
  '(WTFPL OR MIT)',
  'WTFPL OR ISC',
]);

const REVIEWED_EXCEPTIONS = new Map([
  ['caniuse-lite@1.0.30001757', 'CC-BY-4.0'],
  ['dompurify@3.4.13', '(MPL-2.0 OR Apache-2.0)'],
  // Transitive via @ai-sdk/provider (ai, @ai-sdk/anthropic). Disjunctive
  // license: BSD-3-Clause alone is already an allowed expression above, so
  // this is compliant under either branch.
  ['json-schema@0.4.0', '(AFL-2.1 OR BSD-3-Clause)'],
  ['posthog-js@1.413.2', '(Apache-2.0 AND MIT)'],
  ['postprocessing@6.39.1', 'Zlib'],
  ['sanitize-filename@1.6.3', 'WTFPL OR ISC'],
  ['truncate-utf8-bytes@1.0.2', 'WTFPL'],
  ['utf8-byte-length@1.0.5', '(WTFPL OR MIT)'],
]);

const PINNED_FILES = new Map([
  [
    'LICENSE',
    '0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0',
  ],
  [
    'LICENSES/Apache-2.0.txt',
    'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
  ],
  [
    'LICENSES/third-party/cmdk-1.1.1-MIT.txt',
    'b5acfd21b3b61508365224c40ec1b03ec71091248baaf989d4be916551e7d532',
  ],
  [
    'LICENSES/third-party/posthog-js-1.413.2.txt',
    'f953f6aa9d68951fa418c421a212ddaceebfb12bacbf24b65e86fa4116d7bff5',
  ],
  [
    'LICENSES/third-party/caniuse-lite-1.0.30001757-CC-BY-4.0.txt',
    '7e7170e3cebf88a9f60c7b8421418323c09304da1af4d5e90f4da1dc1c8a2661',
  ],
  [
    'LICENSES/third-party/postprocessing-6.39.1-Zlib.txt',
    'b7650918449bd5fb011ce30ce0e5bcda27aa9639db1fb3aef8c67c32945237f2',
  ],
  [
    'LICENSES/third-party/sanitize-filename-1.6.3.txt',
    '69dbd0bb60112fbdd6da878a5ecddee7ddac764d669591d7846cb0310c6e7be8',
  ],
  [
    'LICENSES/third-party/utf8-byte-length-1.0.5-MIT.txt',
    'bfefe6b48c92732f278120d7a3bf682c3b01e25fdc2e0327544cbb62a2fa9a8e',
  ],
  [
    'LICENSES/third-party/webgl-constants-1.1.1-MIT.txt',
    '0969fa65680b694452c2c65981df14af5c192da24f2b1f87bdd51d8ed24efcfa',
  ],
]);

function packageId(name, version) {
  return `${name}@${version}`;
}

function isWorkspacePackage(name) {
  return name === 'exawatt' || name.startsWith('@exawatt/');
}

async function pnpmJson(args) {
  const { stdout } = await execFileAsync('pnpm', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

export function flattenLicenseReport(report) {
  const rows = [];
  for (const entries of Object.values(report)) {
    for (const entry of entries) {
      if (isWorkspacePackage(entry.name)) continue;
      for (const version of entry.versions) {
        rows.push({
          name: entry.name,
          version,
          license: entry.license,
        });
      }
    }
  }
  return rows.sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      left.version.localeCompare(right.version)
  );
}

function visitDependencyTree(dependencies, packages) {
  if (!dependencies) return;
  for (const [name, dependency] of Object.entries(dependencies)) {
    if (dependency.path && dependency.version) {
      packages.set(packageId(name, dependency.version), {
        name,
        version: dependency.version,
        path: dependency.path,
      });
    }
    visitDependencyTree(dependency.dependencies, packages);
    visitDependencyTree(dependency.devDependencies, packages);
    visitDependencyTree(dependency.optionalDependencies, packages);
  }
}

async function installedPackages() {
  const trees = await pnpmJson(['list', '--depth', 'Infinity', '--json']);
  const packages = new Map();
  for (const tree of trees) {
    visitDependencyTree(tree.dependencies, packages);
    visitDependencyTree(tree.devDependencies, packages);
    visitDependencyTree(tree.optionalDependencies, packages);
  }
  return packages;
}

async function pathExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function collectInstalledRows(packages) {
  const failures = [];
  const rows = new Map();
  for (const entry of packages.values()) {
    const manifestPath = path.join(entry.path, 'package.json');
    if (!(await pathExists(manifestPath))) continue; // other-platform optional
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (isWorkspacePackage(manifest.name)) continue;
    const id = packageId(manifest.name, manifest.version);
    const declared =
      typeof manifest.license === 'string'
        ? manifest.license
        : Array.isArray(manifest.licenses)
          ? manifest.licenses
              .map(item => item.type)
              .filter(Boolean)
              .join(' OR ')
          : null;
    if (!declared) {
      if (id === 'webgl-constants@1.1.1') {
        rows.set(id, {
          name: manifest.name,
          version: manifest.version,
          license: 'MIT',
        });
      } else {
        failures.push(`${id} has no license in its installed manifest`);
      }
      continue;
    }
    rows.set(id, {
      name: manifest.name,
      version: manifest.version,
      license: declared,
    });
  }
  return {
    failures,
    rows: [...rows.values()].sort(
      (left, right) =>
        left.name.localeCompare(right.name) ||
        left.version.localeCompare(right.version)
    ),
  };
}

async function sha256(file) {
  const bytes = await readFile(path.join(ROOT, file));
  return createHash('sha256').update(bytes).digest('hex');
}

async function validatePinnedFiles() {
  const failures = [];
  for (const [file, expected] of PINNED_FILES) {
    const actual = await sha256(file);
    if (actual !== expected) {
      failures.push(
        `${file} changed: expected SHA-256 ${expected}, got ${actual}`
      );
    }
  }
  return failures;
}

function validateRows(rows) {
  const failures = [];
  for (const row of rows) {
    if (!ALLOWED_LICENSE_EXPRESSIONS.has(row.license)) {
      failures.push(
        `${packageId(row.name, row.version)} uses unreviewed license expression ${row.license}`
      );
    }
  }
  for (const [id, expected] of REVIEWED_EXCEPTIONS) {
    const row = rows.find(
      candidate => packageId(candidate.name, candidate.version) === id
    );
    if (!row) {
      failures.push(`reviewed exception disappeared or changed version: ${id}`);
    } else if (row.license !== expected) {
      failures.push(`${id} changed license from ${expected} to ${row.license}`);
    }
  }
  const libvips = rows.filter(row =>
    row.name.startsWith('@img/sharp-libvips-')
  );
  if (libvips.length === 0) {
    failures.push('the current platform has no reviewed sharp-libvips package');
  }
  for (const row of libvips) {
    if (row.license !== 'LGPL-3.0-or-later') {
      failures.push(
        `${packageId(row.name, row.version)} changed license from LGPL-3.0-or-later to ${row.license}`
      );
    }
  }
  return failures;
}

const PLATFORM_PACKAGE_NAMES = [
  [/^@esbuild\//u, '@esbuild/<platform>'],
  [/^@img\/sharp-libvips-/u, '@img/sharp-libvips-<platform>'],
  [/^@img\/sharp-/u, '@img/sharp-<platform>'],
  [/^@next\/swc-/u, '@next/swc-<platform>'],
  [/^@rollup\/rollup-/u, '@rollup/rollup-<platform>'],
  [/^@tailwindcss\/oxide-/u, '@tailwindcss/oxide-<platform>'],
  [/^@unrs\/resolver-binding-/u, '@unrs/resolver-binding-<platform>'],
  [/^lightningcss-(?!default$)/u, 'lightningcss-<platform>'],
];

function normalizePlatformRows(rows) {
  const normalized = new Map();
  for (const row of rows) {
    let name = row.name;
    for (const [pattern, replacement] of PLATFORM_PACKAGE_NAMES) {
      if (pattern.test(name)) {
        name = replacement;
        break;
      }
    }
    const next = { ...row, name };
    normalized.set(packageId(next.name, next.version), next);
  }
  return [...normalized.values()].sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      left.version.localeCompare(right.version)
  );
}

function inventoryRow(row) {
  return `| ${row.name.replaceAll('|', '\\|')} | ${row.version.replaceAll('|', '\\|')} | ${row.license.replaceAll('|', '\\|')} |`;
}

export function renderNotice(rows, lockfileHash = '<lockfile-sha256>') {
  const libvips = rows.find(
    row => row.name === '@img/sharp-libvips-<platform>'
  );
  if (!libvips) {
    throw new Error('the notice inventory has no reviewed sharp-libvips row');
  }
  const lines = [
    '# Third-party notices',
    '',
    '<!-- Generated by scripts/check-dependency-licenses.mjs. Do not edit by hand. -->',
    '',
    `This inventory records the declared distribution basis for ${rows.length} third-party`,
    'package versions in the current macOS pnpm dependency graph. Platform binary',
    'families use a `<platform>` placeholder so the same policy is checkable on Linux.',
    `Lockfile SHA-256: \`${lockfileHash}\`.`,
    '',
    'Regenerate it on macOS',
    'with `pnpm licenses:generate`; `pnpm licenses:check` fails when the graph,',
    'reviewed expressions, pinned license texts, or this file drift.',
    '',
    'Package manifests and the lockfile are the machine-readable source of truth. Exact',
    'license texts that need special handling are preserved under',
    '`LICENSES/third-party/`; standard Apache-2.0 text is in',
    '`LICENSES/Apache-2.0.txt`.',
    '',
    '## Reviewed distribution cases',
    '',
    '- **cmdk 1.1.1** — MIT, Copyright 2022 Paco Coursey. Exawatt redistributes',
    '  patched compiled bundles; the patch header and',
    '  `LICENSES/third-party/cmdk-1.1.1-MIT.txt` preserve attribution.',
    '- **webgl-constants 1.1.1** — its package manifest omits a license field, but',
    '  its bundled LICENSE is MIT (Copyright 2019 Tim van Scherpenzeel). The',
    '  checker pins that exact file by SHA-256.',
    '- **posthog-js 1.413.2** — declared `Apache-2.0 AND MIT`; both upstream',
    '  texts and notices are preserved in',
    '  `LICENSES/third-party/posthog-js-1.413.2.txt`.',
    '- **DOMPurify 3.4.13** — declared `MPL-2.0 OR Apache-2.0`; Exawatt elects',
    '  the Apache-2.0 arm.',
    '- **caniuse-lite 1.0.30001757** — Can I Use support data maintained by Ben',
    '  Briggs and the Browserslist contributors, licensed CC-BY-4.0. Source:',
    '  <https://github.com/browserslist/caniuse-lite>.',
    '- **postprocessing 6.39.1** — Zlib, Copyright 2015 Raoul van Rüschen.',
    '- **sanitize-filename 1.6.3** — declared `WTFPL OR ISC`; Exawatt elects',
    '  ISC. **utf8-byte-length 1.0.5** is declared `WTFPL OR MIT`; Exawatt',
    '  elects MIT. **truncate-utf8-bytes 1.0.2** is WTFPL-only; its published',
    '  package contains no separate license file, so its package manifest and',
    '  upstream repository are the recorded basis:',
    '  <https://github.com/parshap/truncate-utf8-bytes>.',
    `- **@img/sharp-libvips-<platform> ${libvips.version}** — LGPL-3.0-or-later optional`,
    '  web-build dependency. It is not an Electron runtime dependency; packaged-app',
    '  verification must continue to prove that no libvips binary is present.',
    '- **Electron/Chromium/FFmpeg** — Electron supplies its LICENSE and',
    '  `LICENSES.chromium.html`. The macOS packager copies both into the app legal',
    '  resources; the packaged-artifact check verifies their presence.',
    '',
    '## Installed package inventory',
    '',
    '| Package | Version | Declared license |',
    '| --- | --- | --- |',
    ...rows.map(inventoryRow),
    '',
  ];
  return lines.join('\n');
}

export async function runLicenseCheck({ write = false } = {}) {
  // Establish that node_modules is trustworthy before reporting on it. A stale
  // tree makes every row below describe packages the repository does not
  // declare, and in --write mode it would COMMIT that fiction.
  await assertInstallFresh(ROOT, {
    task: write ? '`pnpm licenses:generate`' : '`pnpm licenses:check`',
  });
  const collected = await collectInstalledRows(await installedPackages());
  const rows = collected.rows;
  const failures = [...collected.failures, ...validateRows(rows)];
  failures.push(...(await validatePinnedFiles()));

  const noticeRows = normalizePlatformRows(rows);
  const lockfileHash = await sha256('pnpm-lock.yaml');
  const expectedNotice = await format(renderNotice(noticeRows, lockfileHash), {
    parser: 'markdown',
  });
  if (write) {
    await writeFile(NOTICE_PATH, expectedNotice);
  } else {
    const actualNotice = await readFile(NOTICE_PATH, 'utf8').catch(() => '');
    const platformComplete =
      process.platform === 'darwin'
        ? actualNotice === expectedNotice
        : actualNotice.includes(`Lockfile SHA-256: \`${lockfileHash}\`.`) &&
          noticeRows.every(row => actualNotice.includes(inventoryRow(row)));
    if (!platformComplete) {
      failures.push(
        'THIRD_PARTY_NOTICES.md does not match the installed dependency set; ' +
          'run `pnpm licenses:generate` on macOS (dependencies verified installed ' +
          'from this lockfile, so the notices really are behind)'
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.join('\n'));
  }
  return { packageVersions: rows.length };
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const write = process.argv.slice(2).includes('--write');
  runLicenseCheck({ write })
    .then(({ packageVersions }) => {
      process.stdout.write(
        `[licenses] ${write ? 'wrote notices for' : 'verified'} ${packageVersions} package versions\n`
      );
    })
    .catch(error => {
      process.stderr.write(`[licenses] ${error.message}\n`);
      process.exitCode = 1;
    });
}

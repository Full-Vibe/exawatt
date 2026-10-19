#!/usr/bin/env node
/**
 * Refuses a release whose version has no changelog entry (ENG-031 W25,
 * operator 2026-10-19: a real changelog, "always").
 *
 *   node scripts/changelog-check.mjs            # package.json's version
 *   node scripts/changelog-check.mjs v0.1.23    # a release tag
 *
 * The release workflow's preflight runs it before any macOS build is paid
 * for; the version bump meets the same rule in `src/lib/changelog`'s test,
 * and the publisher renders the Release body from the entry it finds.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { requireChangelogEntry } from '../src/lib/changelog/changelog.mjs';

const root = new URL('../', import.meta.url);
const requested =
  process.argv[2] ??
  JSON.parse(readFileSync(new URL('package.json', root), 'utf8')).version;
const version = requested.replace(/^v/u, '');

try {
  const entry = requireChangelogEntry(
    fileURLToPath(new URL('docs/product/changelog/', root)),
    version
  );
  console.log(`[changelog] ${entry.version} (${entry.date}): ${entry.title}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

// @scans package.json docs/product/changelog/**
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHANGELOG_SECTIONS,
  parseChangelogEntry,
  readChangelog,
  releaseNotesMarkdown,
  requireChangelogEntry,
} from './changelog.mjs';

const DIRECTORY = path.join(process.cwd(), 'docs/product/changelog');

const entry = (body: string, version = '1.2.3') =>
  `---\nversion: ${version}\ndate: 2026-01-02\ntitle: A release\n---\n\n${body}`;

describe('the changelog (ENG-031 W25)', () => {
  it('has an entry for the version package.json is about to release', () => {
    // The version bump meets the operator's "always" here: a release whose
    // version has no entry cannot land, and the Release body is that entry.
    const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(() => requireChangelogEntry(DIRECTORY, version)).not.toThrow();
  });

  it('reads every entry, one per version, newest first', () => {
    const entries = readChangelog(DIRECTORY);
    const versions = entries.map(item => item.version);
    expect(new Set(versions).size).toBe(versions.length);
    const sorted = [...versions].sort((a, b) =>
      b.localeCompare(a, 'en', { numeric: true })
    );
    expect(versions).toEqual(sorted);
  });

  it('refuses an entry the pages could only half render', () => {
    const refusals = [
      entry('A feature — with an em dash.'),
      entry('Lead.\n\n## Highlights\n\n- One.'),
      entry('Lead.\n\n## Fixes\n\n- One.\n\n## New\n\n- Two.'),
      entry('- A list before any section.'),
      entry('Lead.\n\n## Fixes\n\n'),
      entry('Lead with **unbalanced bold.'),
      entry('## Fixes\n\n- No lead sentence.'),
    ];
    for (const text of refusals)
      expect(() => parseChangelogEntry(text), text).toThrow(/\[changelog\]/);
    expect(() =>
      parseChangelogEntry(entry('Lead.'), 'docs/product/changelog/9.9.9.md')
    ).toThrow(/names version 1\.2\.3/);
  });

  it('renders the Release body from the same entry the site renders', () => {
    const parsed = parseChangelogEntry(
      entry(
        'Lead line\nwrapped.\n\n## New\n\n- **One.** Two\n  wrapped.\n\n## Fixes\n\n- Three.'
      )
    );
    expect(parsed.summary).toEqual(['Lead line wrapped.']);
    expect(parsed.sections.map(section => section.heading)).toEqual(
      CHANGELOG_SECTIONS.filter(name => name !== 'Improvements')
    );
    expect(parsed.sections[0].items).toEqual(['**One.** Two wrapped.']);
    const body = releaseNotesMarkdown(parsed, {
      origin: 'https://example.test',
    });
    expect(body.indexOf('### New')).toBeLessThan(body.indexOf('### Fixes'));
    expect(body).toContain('https://example.test/changelog/1.2.3');
  });
});

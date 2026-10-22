/**
 * The changelog: one Markdown file per release under `docs/product/changelog/`
 * (ENG-031 W25, operator 2026-10-19: a real changelog, "always").
 *
 * That file is the ONLY place a release's notes are written. `/changelog` on
 * the site and the public GitHub Release body are both rendered from it, so
 * the two cannot say different things. Plain Node built-ins only: the Next
 * server reads it at build time and the release scripts read it from the tag's
 * own checkout.
 *
 * An entry is deliberately small:
 *
 *   ---
 *   version: 0.1.22
 *   date: 2026-10-19
 *   title: Your agents talk to each other
 *   media: (optional) a site path to the entry's clip or image
 *   ---
 *
 *   One or two short paragraphs on the named feature.
 *
 *   ## New | ## Improvements | ## Fixes   (each optional, in that order)
 *
 *   - One plain sentence or two. **Bold** is the only markup.
 *
 * Anything else is refused with the file and the reason, so a malformed entry
 * fails the landing that adds it instead of rendering half a page. The front
 * matter, blocks and inline runs are the site's one document pipeline
 * (`src/lib/site-docs/site-docs.mjs`, which the guides share); this file is
 * the changelog's grammar over it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  inlineRuns as siteDocInlineRuns,
  parseBlocks,
  readFrontMatter,
  refuseEmDash,
  SiteDocError,
} from '../site-docs/site-docs.mjs';
import {
  changelogEntryUrl,
  compareVersions,
  isReleaseVersion,
  isUnreleasedVersion,
} from './versions.mjs';

// The version rules live in `versions.mjs`, which a browser bundle can load;
// this module stays the one door for Node callers.
export { changelogEntryUrl, isUnreleasedVersion };

export const CHANGELOG_SECTIONS = Object.freeze([
  'New',
  'Improvements',
  'Fixes',
]);

/** **Bold** is the only markup an entry renders. */
const CHANGELOG_MARKS = Object.freeze(['strong']);
const LABEL = 'changelog';
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const FRONT_KEYS = Object.freeze(['version', 'date', 'title', 'media']);

class ChangelogError extends SiteDocError {
  constructor(source, message) {
    super(LABEL, source, message);
    this.name = 'ChangelogError';
  }
}

/**
 * Parse one entry. `source` names the file in errors; when it is a
 * `<version>.md` name, the front matter's version must equal it.
 */
export function parseChangelogEntry(text, source = 'entry') {
  const where = { label: LABEL, source };
  const { front, body } = readFrontMatter(text, { ...where, keys: FRONT_KEYS });
  refuseEmDash(text, where);
  const { version, date, title } = front;
  if (!isReleaseVersion(version))
    throw new ChangelogError(source, 'version must be X.Y.Z');
  const fileVersion = /^(\d+\.\d+\.\d+)\.md$/u.exec(path.basename(source));
  if (fileVersion && fileVersion[1] !== version)
    throw new ChangelogError(source, `names version ${version}`);
  if (
    !date ||
    !DATE.test(date) ||
    Number.isNaN(Date.parse(`${date}T00:00:00Z`))
  )
    throw new ChangelogError(source, 'date must be YYYY-MM-DD');
  if (!title) throw new ChangelogError(source, 'title is empty');
  const media = front.media || null;
  if (media !== null && !/^\/[\w./-]+$/u.test(media))
    throw new ChangelogError(source, 'media must be a site path');

  // The entry's own grammar over the shared blocks: paragraphs on the named
  // feature, then `## New | Improvements | Fixes`, each holding one list.
  const summary = [];
  const sections = [];
  for (const block of parseBlocks(body, { ...where, marks: CHANGELOG_MARKS })) {
    const section = sections.at(-1);
    if (block.kind === 'heading') {
      const order = CHANGELOG_SECTIONS.indexOf(block.text);
      if (block.level !== 2)
        throw new ChangelogError(
          source,
          `only "## " section headings: "${block.text}"`
        );
      if (order < 0)
        throw new ChangelogError(
          source,
          `section "${block.text}" is not one of ${CHANGELOG_SECTIONS.join(', ')}`
        );
      if (section && CHANGELOG_SECTIONS.indexOf(section.heading) >= order)
        throw new ChangelogError(
          source,
          `section "${block.text}" is out of order`
        );
      sections.push({ heading: block.text, items: [] });
    } else if (block.kind === 'paragraph' && !section) {
      summary.push(block.text);
    } else if (block.kind === 'list' && !block.ordered && section) {
      section.items.push(...block.items);
    } else if (block.kind === 'list' && !section) {
      throw new ChangelogError(source, 'a list must sit under a section');
    } else {
      throw new ChangelogError(
        source,
        section
          ? `a section holds only "- " items, not a ${block.kind}`
          : `the lead holds only paragraphs, not a ${block.kind}`
      );
    }
  }

  if (!summary.length)
    throw new ChangelogError(source, 'needs a sentence on the named feature');
  for (const each of sections)
    if (!each.items.length)
      throw new ChangelogError(source, `section "${each.heading}" is empty`);

  return Object.freeze({ version, date, title, media, summary, sections });
}

/** Every entry in `directory`, newest version first. */
export function readChangelog(directory) {
  const names = readdirSync(directory)
    .filter(name => name.endsWith('.md'))
    .filter(name => name !== 'README.md');
  for (const name of names) {
    if (!/^\d+\.\d+\.\d+\.md$/u.test(name))
      throw new ChangelogError(name, 'an entry is named <version>.md');
  }
  const entries = names.map(name =>
    parseChangelogEntry(
      readFileSync(path.join(directory, name), 'utf8'),
      path.join(directory, name)
    )
  );
  entries.sort((a, b) => compareVersions(b.version, a.version));
  return entries;
}

/** The entries a reader may see: every version at or below the published one. */
export function releasedEntries(entries, publishedVersion) {
  return entries.filter(
    entry => !isUnreleasedVersion(entry.version, publishedVersion)
  );
}

/**
 * The entry for `version`. A release without one is refused: this is the
 * check the release procedure and the version bump run.
 */
export function requireChangelogEntry(directory, version) {
  const entry = readChangelog(directory).find(item => item.version === version);
  if (!entry) {
    throw new ChangelogError(
      directory,
      `no entry for ${version}; add ${version}.md before releasing it`
    );
  }
  return entry;
}

/** An entry's text as inline runs: only `**bold**` is markup. */
export function inlineRuns(text) {
  return siteDocInlineRuns(text, { marks: CHANGELOG_MARKS, label: LABEL });
}

/** The GitHub Release body for an entry, before the checksum line. */
export function releaseNotesMarkdown(entry, { origin } = {}) {
  const parts = [`## ${entry.title}`, ...entry.summary];
  for (const section of entry.sections) {
    parts.push(
      `### ${section.heading}\n\n${section.items.map(item => `- ${item}`).join('\n')}`
    );
  }
  if (origin)
    parts.push(`On the site: ${changelogEntryUrl(origin, entry.version)}`);
  return parts.join('\n\n');
}

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
 * fails the landing that adds it instead of rendering half a page.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const CHANGELOG_SECTIONS = Object.freeze([
  'New',
  'Improvements',
  'Fixes',
]);

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const FRONT_KEYS = new Set(['version', 'date', 'title', 'media']);
const EM_DASH = '—';

class ChangelogError extends Error {
  constructor(source, message) {
    super(`[changelog] ${source}: ${message}`);
    this.name = 'ChangelogError';
  }
}

/** Joins wrapped Markdown lines into one sentence-level string. */
function joinLines(lines) {
  return lines
    .map(line => line.trim())
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function compareVersions(left, right) {
  const a = VERSION.exec(left).slice(1).map(Number);
  const b = VERSION.exec(right).slice(1).map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

/**
 * Parse one entry. `source` names the file in errors; when it is a
 * `<version>.md` name, the front matter's version must equal it.
 */
export function parseChangelogEntry(text, source = 'entry') {
  if (typeof text !== 'string') throw new ChangelogError(source, 'not text');
  if (text.includes(EM_DASH)) {
    throw new ChangelogError(
      source,
      'contains an em dash; public copy uses periods, commas or colons'
    );
  }
  const lines = text.replace(/\r\n?/gu, '\n').split('\n');
  if (lines[0] !== '---')
    throw new ChangelogError(source, 'must open with a front matter block');
  const close = lines.indexOf('---', 1);
  if (close < 0)
    throw new ChangelogError(source, 'front matter block is not closed');

  const front = {};
  for (const line of lines.slice(1, close)) {
    if (!line.trim()) continue;
    const match = /^([a-z]+):\s*(.*)$/u.exec(line);
    if (!match || !FRONT_KEYS.has(match[1]))
      throw new ChangelogError(source, `unknown front matter line "${line}"`);
    if (match[1] in front)
      throw new ChangelogError(source, `repeats "${match[1]}"`);
    front[match[1]] = match[2].trim();
  }
  const { version, date, title } = front;
  if (!version || !VERSION.test(version))
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

  const summary = [];
  const sections = [];
  let paragraph = [];
  let section = null;
  let item = null;
  const flushParagraph = () => {
    if (paragraph.length) summary.push(joinLines(paragraph));
    paragraph = [];
  };
  const flushItem = () => {
    if (item) section.items.push(joinLines(item));
    item = null;
  };

  for (const line of lines.slice(close + 1)) {
    const heading = /^##\s+(.+)$/u.exec(line);
    if (heading) {
      flushParagraph();
      flushItem();
      const name = heading[1].trim();
      const order = CHANGELOG_SECTIONS.indexOf(name);
      if (order < 0)
        throw new ChangelogError(
          source,
          `section "${name}" is not one of ${CHANGELOG_SECTIONS.join(', ')}`
        );
      const previous = sections.at(-1);
      if (previous && CHANGELOG_SECTIONS.indexOf(previous.heading) >= order)
        throw new ChangelogError(source, `section "${name}" is out of order`);
      section = { heading: name, items: [] };
      sections.push(section);
      continue;
    }
    if (/^#/u.test(line))
      throw new ChangelogError(
        source,
        `only "## " section headings: "${line}"`
      );
    if (section === null) {
      if (/^\s*[-*]\s/u.test(line))
        throw new ChangelogError(source, 'a list must sit under a section');
      if (line.trim()) paragraph.push(line);
      else flushParagraph();
      continue;
    }
    const bullet = /^- (.+)$/u.exec(line);
    if (bullet) {
      flushItem();
      item = [bullet[1]];
    } else if (/^\s+\S/u.test(line) && item) {
      item.push(line);
    } else if (line.trim()) {
      throw new ChangelogError(
        source,
        `a section holds only "- " items: "${line.trim()}"`
      );
    } else {
      flushItem();
    }
  }
  flushParagraph();
  flushItem();

  if (!summary.length)
    throw new ChangelogError(source, 'needs a sentence on the named feature');
  for (const each of sections)
    if (!each.items.length)
      throw new ChangelogError(source, `section "${each.heading}" is empty`);
  for (const textBlock of [...summary, ...sections.flatMap(s => s.items)]) {
    if ((textBlock.match(/\*\*/gu) ?? []).length % 2)
      throw new ChangelogError(source, `unbalanced ** in "${textBlock}"`);
  }

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

/**
 * The entries a reader may see: every version at or below the published one.
 * An entry above it is a draft for a release that has not shipped; nothing
 * lists, renders, links or feeds it, so the site never announces a version
 * users cannot install.
 */
export function releasedEntries(entries, publishedVersion) {
  if (!VERSION.test(publishedVersion)) {
    throw new ChangelogError(
      'published version',
      `"${publishedVersion}" is not a version`
    );
  }
  return entries.filter(
    entry => compareVersions(entry.version, publishedVersion) <= 0
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

/** Splits `**bold**` runs so a renderer never has to parse Markdown. */
export function inlineRuns(text) {
  return text
    .split('**')
    .map((run, index) => ({ text: run, strong: index % 2 === 1 }))
    .filter(run => run.text !== '');
}

/** The entry's page on a site origin, e.g. https://www.exawatt.ai. */
export function changelogEntryUrl(origin, version) {
  return `${origin.replace(/\/$/u, '')}/changelog/${version}`;
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

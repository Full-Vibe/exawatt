import path from 'node:path';
import { cache } from 'react';
import { readChangelog, type ChangelogEntry } from './changelog.mjs';

/** Where every release's entry is written (ENG-031 W25). Read at build time:
 *  the pages and the feed are static, so a new entry ships with its deploy. */
const CHANGELOG_DIRECTORY = path.join(process.cwd(), 'docs/product/changelog');

export const changelogEntries = cache((): ChangelogEntry[] =>
  readChangelog(CHANGELOG_DIRECTORY)
);

/** "October 19, 2026", in UTC so the build host's zone never moves a day. */
export function formatChangelogDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export type { ChangelogEntry };

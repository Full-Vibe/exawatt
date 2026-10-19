import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cache } from 'react';
import { readDesktopBuild } from '@/lib/desktop-release/desktop-build';
import { resolvedDistribution } from '@/lib/distribution/resolved';
import { releasedEntries, type ChangelogEntry } from './changelog.mjs';
import { changelogEntries } from './entries';

/**
 * How often a changelog page asks the update feed again. A release becomes
 * visible within this long of its feed advancing, with no redeploy.
 */
export const CHANGELOG_REVALIDATE_SECONDS = 300;

/** The feed could not say which version is published. */
class ChangelogPublicationUnknownError extends Error {
  constructor(reason: string) {
    super(`[changelog] the update feed could not be read: ${reason}`);
    this.name = 'ChangelogPublicationUnknownError';
  }
}

/**
 * The newest published version: the one `/download` offers, read from the
 * same update feed (decision 0009). A distribution without a feed publishes
 * the tree it is built from. An unreadable feed throws rather than guessing:
 * during revalidation Next keeps serving the last good page, and a guess
 * would either hide shipped releases or announce an unshipped one.
 */
const publishedChangelogVersion = cache(async (): Promise<string> => {
  // The request itself is desktop-build's, the declared outbound call site.
  const read = await readDesktopBuild(resolvedDistribution(), undefined, {
    next: { revalidate: CHANGELOG_REVALIDATE_SECONDS },
  });
  if (read.status === 'published') return read.build.version;
  if (read.status === 'unreadable') {
    throw new ChangelogPublicationUnknownError(read.reason);
  }
  const { version } = JSON.parse(
    readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
  ) as { version: string };
  return version;
});

/** Every entry a reader may see, newest first (ENG-031 W25). */
export const publishedChangelogEntries = cache(
  async (): Promise<ChangelogEntry[]> =>
    releasedEntries(changelogEntries(), await publishedChangelogVersion())
);

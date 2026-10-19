import { cache } from 'react';
import { releasedEntries, type ChangelogEntry } from './changelog.mjs';
import { changelogEntries } from './entries';
import { readPublishedVersion } from './published-version';

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

/** The published version, or a thrown error when the feed cannot say: during
 *  revalidation Next then keeps serving the last good page. */
const publishedChangelogVersion = cache(async (): Promise<string> => {
  const read = await readPublishedVersion({
    next: { revalidate: CHANGELOG_REVALIDATE_SECONDS },
  });
  if (read.status === 'unknown') {
    throw new ChangelogPublicationUnknownError(read.reason);
  }
  return read.version;
});

/** Every entry a reader may see, newest first (ENG-031 W25). */
export const publishedChangelogEntries = cache(
  async (): Promise<ChangelogEntry[]> =>
    releasedEntries(changelogEntries(), await publishedChangelogVersion())
);

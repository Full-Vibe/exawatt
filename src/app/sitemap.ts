import { servesOwnLegalPages } from '@/lib/hosted-features/distribution-availability';
import type { MetadataRoute } from 'next';
import { EXAWATT_HOSTED_ORIGIN } from '@/lib/analytics/config';
import { changelogEntryUrl } from '@/lib/changelog/changelog.mjs';
import { publishedChangelogEntries } from '@/lib/changelog/published';
import { guidePath, publishedGuides } from '@/lib/guides/guides';

/**
 * The pages Exawatt wants found. Deliberately short: everything else public in
 * `src/proxy.ts` is app chrome that carries `robots: { index: false }` in its
 * segment metadata, and listing a noindexed route here would only contradict
 * it.
 *
 * `/leaderboard` and the `/operator/<handle>` and `/run/<id>` pages under it
 * are public by design, but each operator's presence there is their own opt-in
 * (decision `0029`), so the index page is listed and the profiles are left to
 * be discovered through it rather than enumerated in a sitemap.
 *
 * RENDERED PER REQUEST (BUG-304). Next's build output turns any PRERENDERED
 * route whose path ends in `/sitemap.xml` into a static file, whatever its
 * `revalidate` says (`isStaticMetadataFile` in its adapter), so a release
 * published after a deploy stayed out of the sitemap until the next deploy.
 * Rendering per request keeps it a function; the update feed read it makes
 * is still cached for `CHANGELOG_REVALIDATE_SECONDS`, so a crawler's visit
 * costs no feed round trip, and a new release appears on the same cadence
 * as `/changelog`.
 */
// `/privacy` and `/terms` come from the company overlay, so a build without a
// brand does not serve them and must not advertise them.
const PAGES = [
  '/',
  '/download',
  '/guides',
  '/changelog',
  '/leaderboard',
] as const;
const BRANDED_PAGES = ['/privacy', '/terms'] as const;

export const dynamic = 'force-dynamic';

/** Each published release's changelog page and each published guide is
 *  listed; a draft or an unpublished guide never is. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const paths = servesOwnLegalPages()
    ? [...PAGES, ...BRANDED_PAGES]
    : [...PAGES];
  const releases = await publishedChangelogEntries();
  return [
    ...paths.map(path => ({
      url: `${EXAWATT_HOSTED_ORIGIN}${path === '/' ? '' : path}`,
    })),
    ...publishedGuides().map(guide => ({
      url: `${EXAWATT_HOSTED_ORIGIN}${guidePath(guide.slug)}`,
    })),
    ...releases.map(entry => ({
      url: changelogEntryUrl(EXAWATT_HOSTED_ORIGIN, entry.version),
      lastModified: entry.date,
    })),
  ];
}

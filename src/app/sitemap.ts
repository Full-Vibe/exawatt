import { servesOwnLegalPages } from '@/lib/hosted-features/distribution-availability';
import type { MetadataRoute } from 'next';
import { EXAWATT_HOSTED_ORIGIN } from '@/lib/analytics/config';

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
 */
// `/privacy` and `/terms` come from the company overlay, so a build without a
// brand does not serve them and must not advertise them.
const PAGES = ['/', '/download', '/leaderboard'] as const;
const BRANDED_PAGES = ['/privacy', '/terms'] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = servesOwnLegalPages()
    ? [...PAGES, ...BRANDED_PAGES]
    : [...PAGES];
  return paths.map(path => ({
    url: `${EXAWATT_HOSTED_ORIGIN}${path === '/' ? '' : path}`,
  }));
}

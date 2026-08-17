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
const PAGES = ['/', '/download', '/leaderboard', '/privacy', '/terms'] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map(path => ({
    url: `${EXAWATT_HOSTED_ORIGIN}${path === '/' ? '' : path}`,
  }));
}

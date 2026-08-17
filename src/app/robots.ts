import type { MetadataRoute } from 'next';
import { EXAWATT_HOSTED_ORIGIN } from '@/lib/analytics/config';

/**
 * What crawlers may fetch.
 *
 * Read this before adding a `disallow` entry for an app surface. Most of
 * Exawatt's routes are public in `src/proxy.ts` for a reason that has nothing
 * to do with the public: the packaged Electron renderer serves them from a
 * loopback server and has to reach them with the network down (ENG-016 D18).
 * That makes them crawlable, so **indexability is refused per route with
 * `robots: { index: false, follow: false }` in each segment's metadata** —
 * `/workspace`, `/settings`, `/fleet/spatial`, `/eval`, `/hud-gallery`,
 * `/usage`, `/deck`, `/admin`, and the ENG-026 preview surfaces all carry it.
 *
 * Those routes are deliberately absent from `disallow` below. A `Disallow`
 * stops the crawler fetching the page, which stops it ever reading the
 * `noindex` — the two signals cancel, and a URL blocked in robots.txt can
 * still be indexed from an inbound link. Blocking is only correct where there
 * is nothing to read a directive from.
 *
 * So this file blocks the paths that are not documents at all: the API, the
 * analytics proxy rewrite, the auth callbacks, and the build artifact route
 * (fetching it records an invite redemption and pulls a ~200 MB download).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/ingest/',
          '/auth/',
          '/download/artifact',
        ],
      },
    ],
    sitemap: `${EXAWATT_HOSTED_ORIGIN}/sitemap.xml`,
  };
}

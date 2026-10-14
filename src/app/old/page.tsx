import type { Metadata } from 'next';
import { HomeBands } from '@/components/site/bands/band-stack';
import { DOWNLOAD_REQUIREMENT } from '@/components/site/bands/download';
import { foldCloseVariant } from '@/components/site/bands/fold-copy';

/**
 * The band homepage, kept at an address for a while (ENG-031 W15m, operator
 * 2026-10-14: "We should keep existing for a while on /old or something").
 * It is what `/` rendered from 2026-08-19 until the fleet story took the
 * homepage: the same `HomeBands` on the `proposed` arrangement, under the
 * same W6 chrome. `/v2`, the arc's review address, is gone with no redirect.
 *
 * NOT INDEXED: it is not the homepage, and a crawler that indexes it puts a
 * second Exawatt front door in search results. It is listed in
 * `src/proxy.ts`, or the auth gate would bounce a signed-out visitor to
 * `/sign-in`. Public marketing surfaces never promote sign-in.
 */
export const metadata: Metadata = {
  title: 'Previous homepage',
  description: `${foldCloseVariant('a').subhead.join(' ')} ${DOWNLOAD_REQUIREMENT}`,
  robots: { index: false, follow: false },
};

export default function OldHomePage() {
  return <HomeBands arrangement="proposed" />;
}

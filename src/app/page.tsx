import type { Metadata } from 'next';
import { resolveDistributionIdentity } from '@exawatt/core/distribution';
import { HOMEPAGE_STORY } from '@/components/site/fleet-story/homepage-settings';
import { ScrollExperience } from '@/components/site/fleet-story/scroll-experience';
import { EXAWATT_HOSTED_ORIGIN } from '@/lib/analytics/config';
import { resolvedDistribution } from '@/lib/distribution/resolved';
import { readPublishedHomepageCopy } from '@/lib/homepage-copy/published';

/** A publish should appear in the HTML and metadata on the next request. */
export const dynamic = 'force-dynamic';

/**
 * The homepage is the fleet story (ENG-031 W15m, operator 2026-10-14: "I'm
 * ready to promote this to the actual homepage"): ten agents, one, ten, a
 * hundred, the whole fleet, and the download over it. The study at
 * /hud-gallery/homepage-study is the same component under a bar of
 * controls; this page fixes the study's choices (`HOMEPAGE_STORY`). The band
 * homepage it replaced was deleted in W31 (operator, 2026-10-21).
 *
 * The copy is server-rendered: the canvas is a client-only chunk, and the
 * story's type, its title and its download are in the HTML a crawler and a
 * slow connection get first.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { document } = await readPublishedHomepageCopy();
  const landing = document.scenes.landing;
  const promise = landing.headline.join(' ');
  const description = landing.body.join(' ') || promise;
  const { productName } = resolveDistributionIdentity(resolvedDistribution());

  return {
    metadataBase: new URL(EXAWATT_HOSTED_ORIGIN),
    // the product first, then its promise, as a homepage title reads
    title: { absolute: `${productName} · ${promise.replace(/\.$/, '')}` },
    description,
    openGraph: {
      title: promise,
      description,
      type: 'website',
      images: [
        {
          url: '/images/og-home.png',
          width: 1200,
          height: 630,
          alt: 'A fleet of agents on a world of hex tiles, each wearing its harness mark.',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: promise,
      description,
      images: ['/images/og-home.png'],
    },
  };
}

export default async function Home() {
  const { document } = await readPublishedHomepageCopy();
  return (
    <main
      className="min-h-screen bg-[#04060b] font-ui text-white"
      data-fleet-story
      data-public-exhibition-surface="true"
    >
      <ScrollExperience {...HOMEPAGE_STORY} copyDocument={document} />
    </main>
  );
}

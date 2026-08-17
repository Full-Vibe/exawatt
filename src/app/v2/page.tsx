import type { Metadata } from 'next';
import { HomeBands } from '@/components/site/bands/band-stack';
import { DOWNLOAD_REQUIREMENT } from '@/components/site/bands/download';
import { foldCloseVariant } from '@/components/site/bands/fold-copy';

/**
 * The proposed homepage, at a URL a person can be handed (ENG-031 W5, W8).
 *
 * It is not a mock, a study, or a description of the page. It is
 * `src/app/page.tsx` with one argument changed: the same `HomeBands`, walking
 * the same `manifest.ts`, rendering the same components. The only difference
 * between this route and `/` is which arrangement the manifest hands back, so
 * the reviewed page and the shipped page cannot become two pages.
 *
 * `/hud-gallery/homepage-narrative` was the workbench address for the same
 * thing and is RETIRED (operator, 2026-08-17: "remove that /homepage-narrative
 * if you haven't already, as we're now using /v2 to prototype it"). Deleted
 * outright, no redirect: two addresses for one page is exactly the drift the
 * shared component was protecting against.
 *
 * NOT INDEXED, deliberately. This is the next homepage under review, not the
 * homepage; a crawler that indexes it would put a second Exawatt front door in
 * search results and split whatever the real one earns. It also has to be
 * listed in `src/proxy.ts`, or the auth gate redirects a signed-out visitor to
 * `/sign-in`. Public marketing surfaces never promote sign-in.
 *
 * PROMOTION IS ONE LINE. `HOMEPAGE_ARRANGEMENT = 'proposed'` in `manifest.ts`
 * moves the arc onto `/`, swaps the fold's interior to `FoldHero`, and
 * switches the site chrome to the W6 nav and footer, because all three derive
 * from it. This route retires in the same commit: a review address left up
 * afterwards is a stale copy of the homepage at a memorable URL.
 */
export const metadata: Metadata = {
  // The stale "Power your AI agents" is superseded by the fold's own subhead,
  // which is the sentence the page actually leads with (`marketing.md`).
  description: `${foldCloseVariant('a').subhead.join(' ')} ${DOWNLOAD_REQUIREMENT}`,
  robots: { index: false, follow: false },
};

export default function V2Page() {
  return <HomeBands arrangement="proposed" />;
}

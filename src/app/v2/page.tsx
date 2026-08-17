import type { Metadata } from 'next';
import { HomepageNarrativeStudy } from '@/app/hud-gallery/homepage-narrative/study';

/**
 * The homepage narrative, at a URL a person can be handed (ENG-031 W5).
 *
 * The arc was built at `/hud-gallery/homepage-narrative`, which is the right
 * home for a workbench study and the wrong link to send anybody. The operator
 * tried `/v2` and got a redirect, which is the useful signal: the next
 * homepage should live at a short address while it is being reviewed, so it
 * can go in a message without an explanation attached.
 *
 * It renders the SAME component as the gallery route, with the breadcrumb off.
 * Two routes and one page, so the reviewed thing and the shipped thing cannot
 * become two different pages.
 *
 * NOT INDEXED, and that is deliberate rather than incidental. This is the next
 * homepage under review, not the homepage; a crawler that indexes it would put
 * a second Exawatt front door in search results and split whatever the real
 * one earns. It also has to be listed in `src/proxy.ts`, or the auth gate
 * redirects a signed-out visitor to `/sign-in`, which is exactly the 307 the
 * operator hit. Public marketing surfaces do not promote sign-in.
 *
 * When the operator accepts the arc, the bands flip to `shipped` in
 * `manifest.ts` and `/` renders them. This route retires at that moment: it is
 * a review address, and leaving it up afterwards would leave a stale copy of
 * the homepage at a memorable URL.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function V2Page() {
  return <HomepageNarrativeStudy chrome={false} />;
}

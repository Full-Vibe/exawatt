import { describe, expect, it } from 'vitest';
import { metadata } from './page';
import { HomepageNarrativeStudy } from '@/app/hud-gallery/homepage-narrative/study';
import V2Page from './page';

/**
 * `/v2` is the review address for the next homepage (ENG-031 W5). Two
 * properties have to hold or it stops being safe to hand out.
 */
describe('the review homepage at /v2', () => {
  it('is never indexed, because it is not the homepage', () => {
    // A crawler that indexes this puts a second Exawatt front door in search
    // results and splits whatever the real one earns.
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it('renders the SAME component as the gallery study, chrome off', () => {
    // One page, two addresses. If this ever forked, the thing the operator
    // reviewed and the thing he sends people would drift apart.
    const element = V2Page();
    expect(element.type).toBe(HomepageNarrativeStudy);
    expect(element.props).toEqual({ chrome: false });
  });
});

import { describe, expect, it } from 'vitest';
import V2Page, { metadata } from './page';
import { HomeBands } from '@/components/site/bands/band-stack';

/**
 * `/v2` is the review address for the next homepage (ENG-031 W5, W8). Three
 * properties have to hold or it stops being safe to hand out.
 */
describe('the review homepage at /v2', () => {
  it('is never indexed, because it is not the homepage', () => {
    // A crawler that indexes this puts a second Exawatt front door in search
    // results and splits whatever the real one earns.
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it('replaces the stale meta description with the fold it actually leads with', () => {
    expect(metadata.description).not.toContain('Power your AI agents');
    expect(metadata.description).toContain('command interface');
  });

  it('renders the SAME composer as the homepage, on the proposed arrangement', () => {
    // One page, two arrangements. If this ever forked into its own component,
    // the thing the operator reviews and the thing that ships would drift.
    const element = V2Page();
    expect(element.type).toBe(HomeBands);
    expect(element.props).toEqual({ arrangement: 'proposed' });
  });
});

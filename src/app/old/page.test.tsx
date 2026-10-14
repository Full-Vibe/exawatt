import { describe, expect, it } from 'vitest';
import OldHomePage, { metadata } from './page';
import { HomeBands } from '@/components/site/bands/band-stack';

/**
 * `/old` keeps the band homepage at an address after the fleet story took
 * `/` (ENG-031 W15m). Three properties have to hold or it stops being safe
 * to keep up.
 */
describe('the previous homepage at /old', () => {
  it('is never indexed, because it is not the homepage', () => {
    // A crawler that indexes this puts a second Exawatt front door in search
    // results and splits whatever the real one earns.
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it('replaces the stale meta description with the fold it actually leads with', () => {
    expect(metadata.description).not.toContain('Power your AI agents');
    expect(metadata.description).toContain('command interface');
  });

  it('renders the band composer on the arrangement `/` carried', () => {
    // The page it was, not a copy of it: the same composer on the same
    // arrangement, so `/old` is what the homepage was until W15m.
    const element = OldHomePage();
    expect(element.type).toBe(HomeBands);
    expect(element.props).toEqual({ arrangement: 'proposed' });
  });
});

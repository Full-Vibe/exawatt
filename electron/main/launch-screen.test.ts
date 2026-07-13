import { describe, expect, it } from 'vitest';
import { launchScreenUrl } from './launch-screen';

describe('launch screen', () => {
  it('is a self-contained, accessible, reduced-motion-safe first frame', () => {
    const url = launchScreenUrl();
    expect(url.startsWith('data:text/html;charset=UTF-8,')).toBe(true);

    const html = decodeURIComponent(url.split(',')[1]);
    expect(html).toContain('data-exawatt-launch');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('prefers-reduced-motion: reduce');
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/https?:\/\//);
  });
});

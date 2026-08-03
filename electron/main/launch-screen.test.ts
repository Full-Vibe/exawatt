import { describe, expect, it } from 'vitest';
import { launchScreenUrl } from './launch-screen';
import { THEME_BOOTSTRAP_REGISTRY } from './generated-theme-bootstrap';

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

  it('uses the resolved bootstrap colors before renderer hydration', () => {
    const html = decodeURIComponent(
      launchScreenUrl(THEME_BOOTSTRAP_REGISTRY['exawatt-air-light']).split(
        ','
      )[1]
    );
    expect(html).toContain('<meta name="color-scheme" content="light"');
    expect(html).toContain('--surface: #F3F5F2');
    expect(html).toContain('--ink: #18211D');
    expect(html).toContain('--signal: #087F6E');
  });
});

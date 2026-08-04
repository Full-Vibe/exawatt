import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('public-home first-paint stability', () => {
  it('keeps marketing typography independent from the app theme', () => {
    const source = readFileSync('src/app/page.tsx', 'utf8');

    expect(source).toContain('[data-home-hero]');
    expect(source).toContain(
      "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    );
  });

  it('paints the document root with the resolved theme ground', () => {
    const layout = readFileSync('src/app/layout.tsx', 'utf8');

    expect(layout).toContain("background: 'var(--background)'");
  });
});

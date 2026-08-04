import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('public-home first-paint stability', () => {
  it('keeps public exhibition typography independent from the app theme', () => {
    const home = readFileSync('src/app/_home-hero.tsx', 'utf8');
    const architecture = readFileSync('src/app/architecture/page.tsx', 'utf8');
    const loading = readFileSync('src/app/architecture/loading.tsx', 'utf8');
    const globals = readFileSync('src/app/globals.css', 'utf8');

    expect(home).toContain('data-public-exhibition-surface="true"');
    expect(architecture).toContain('data-public-exhibition-surface="true"');
    expect(loading).toContain('data-public-exhibition-surface="true"');
    expect(globals).toContain("[data-public-exhibition-surface='true']");
    expect(globals).toContain('--exa-interface-scale: 1');
    expect(globals).toContain(
      "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    );
  });

  it('does not inject a route-local style owner', () => {
    const source = readFileSync('src/app/page.tsx', 'utf8');

    expect(source).not.toContain('<style>');
  });

  it('paints the document root with the resolved theme ground', () => {
    const layout = readFileSync('src/app/layout.tsx', 'utf8');

    expect(layout).toContain("background: 'var(--background)'");
  });
});

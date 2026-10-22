import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// @scans src/app/**

describe('public-home first-paint stability', () => {
  it('keeps public exhibition typography independent from the app theme', () => {
    const home = readFileSync('src/app/page.tsx', 'utf8');
    const architecture = readFileSync('src/app/architecture/page.tsx', 'utf8');
    const loading = readFileSync('src/app/architecture/loading.tsx', 'utf8');
    const globals = readFileSync('src/app/globals.css', 'utf8');

    expect(home).toContain('data-public-exhibition-surface="true"');
    expect(architecture).toContain('data-public-exhibition-surface="true"');
    expect(loading).toContain('data-public-exhibition-surface="true"');
    expect(globals).toContain("[data-public-exhibition-surface='true']");
    expect(globals).toContain('--exa-interface-scale: 1');
    // W6b: the boundary resolves a REAL LOADED FACE, and the contract it
    // enforces is unchanged. Incident `0004` was a fixed public surface
    // inheriting a MUTABLE app preference, so Air, Classic and Night each
    // reflowed the same heading. What the boundary has to be is a family that
    // theme churn cannot reach; `--font-geist-sans` is declared once in the
    // root layout and written here as a literal rather than through any
    // `--exa-theme-*` variable, exactly like the mono control that stayed
    // stable throughout the incident. `eval:typography-stability` is the gate.
    expect(globals).toContain('font-family: var(--font-geist-sans)');
    expect(globals).not.toContain(
      '--exa-theme-display-font)\n  --font-display'
    );
    for (const property of [
      '--exa-interface-font',
      '--font-ui',
      '--font-display',
    ]) {
      expect(
        globals.includes(`${property}: var(--font-geist-sans);`),
        property
      ).toBe(true);
    }
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

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOTS = [
  'src/app/settings',
  'src/components/feedback',
  'src/components/nav',
  'src/components/shortcuts',
  'src/components/ui',
];

const SOURCE_EXTENSIONS = /\.(?:ts|tsx)$/;
const TEST_OR_STUDY = /(?:\.test\.|gallery-study|preview-surface)/;
const DIRECT_COLOR = /#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(/i;
const DIRECT_PALETTE_UTILITY =
  /\b(?:bg|text|border|ring|from|via|to)-(?:black|white|zinc|neutral|slate|teal|cyan|amber|red)(?:\b|\/)/;

function productionFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return productionFiles(path);
    if (!SOURCE_EXTENSIONS.test(path) || TEST_OR_STUDY.test(path)) return [];
    return [path];
  });
}

describe('ENG-032 T3A theme-owned surface contract', () => {
  it('projects generated roles into Settings without a local palette', () => {
    const css = readFileSync('src/app/globals.css', 'utf8');
    const settings = css.slice(
      css.indexOf('[data-settings-shell]'),
      css.indexOf('@media (pointer: coarse)')
    );

    expect(settings).toContain(
      '--settings-page: var(--exa-foundation-canvas)'
    );
    expect(settings).toContain(
      '--settings-teal: var(--exa-foundation-action)'
    );
    expect(settings).toContain('--settings-amber: var(--exa-hud-amber)');
    expect(settings).toContain('--settings-red: var(--exa-status-fault)');
    expect(settings).not.toMatch(DIRECT_COLOR);
  });

  it('provides shared material recipes and an opaque accessibility fallback', () => {
    const css = readFileSync('src/app/globals.css', 'utf8');
    expect(css).toContain('.exa-material-chrome');
    expect(css).toContain('.exa-material-overlay');
    expect(css).toContain('.exa-material-raised');
    expect(css).toContain("[data-exa-transparency='reduced']");
    expect(css).toContain('background: var(--exa-material-role-fallback)');
    expect(css).toContain('--exa-material-role-filter: none');
  });

  it('keeps migrated production chrome free of direct presentation colors', () => {
    const violations = SOURCE_ROOTS.flatMap(productionFiles).flatMap(path => {
      const source = readFileSync(path, 'utf8');
      const reasons = [
        DIRECT_COLOR.test(source) ? 'color literal/function' : null,
        DIRECT_PALETTE_UTILITY.test(source) ? 'palette utility' : null,
      ].filter(Boolean);
      return reasons.length > 0 ? [`${path}: ${reasons.join(', ')}`] : [];
    });

    expect(violations).toEqual([]);
  });
});

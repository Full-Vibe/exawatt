import { describe, expect, it } from 'vitest';
import { AGENT_SOURCE_DECLARATIONS } from '@/generated/agent-source-declarations';
import {
  PRODUCTION_THEME_IDS,
  THEME_REGISTRY,
} from '@/generated/theme-registry';
import { contrastRatio } from '@/lib/appearance/color';
import {
  agentSourceIdentity,
  bareMarkPaint,
  MARK_MINIMUM_CONTRAST,
  SHELL_SOURCE_COLOR,
  SOURCE_IDENTITY_BACKPLATE,
  SOURCE_IDENTITY_BORDER,
  SOURCE_IDENTITY_NEUTRAL,
  themeMarkGrounds,
} from './agent-source-identity';

const THEMES = PRODUCTION_THEME_IDS.map(id => THEME_REGISTRY[id]);
const MARK_COLORS = [
  ...AGENT_SOURCE_DECLARATIONS.map(source => [source.adapterId, source.color]),
  ['shell', SHELL_SOURCE_COLOR],
] as const;

describe('Agent Source marks meet minimum contrast on every ground (BUG-292)', () => {
  it.each(THEMES.map(theme => [theme.id, theme] as const))(
    'every declared mark paints in a colour that reads on every %s ground',
    (_id, theme) => {
      for (const [source, color] of MARK_COLORS) {
        const paint = bareMarkPaint(color, theme);
        expect(paint.color, source).not.toBeNull();
        for (const ground of themeMarkGrounds(theme)) {
          expect(
            contrastRatio(paint.color!, ground),
            `${source} ${color} (${paint.kind}) on ${theme.id} ${ground}`
          ).toBeGreaterThanOrEqual(MARK_MINIMUM_CONTRAST);
        }
      }
    }
  );

  it("yields Codex's near-white to the theme's ink on a light ground and keeps it on a dark one", () => {
    const codex = agentSourceIdentity('codex').color;
    const air = THEME_REGISTRY['exawatt-air-light'];
    expect(bareMarkPaint(codex, air)).toEqual({
      kind: 'ink',
      color: air.foundation.textMuted,
    });
    expect(
      bareMarkPaint(codex, THEME_REGISTRY['exawatt-classic-dark'])
    ).toEqual({ kind: 'brand', color: codex });
  });

  it('never paints a colour it cannot check', () => {
    // Outside the provider the mark inherits; a non-hex colour yields.
    expect(bareMarkPaint('#DD896F', null).color).toBeNull();
    expect(
      bareMarkPaint('var(--x)', THEME_REGISTRY['exawatt-classic-dark']).kind
    ).toBe('ink');
  });

  it('keeps every declared colour readable on the fixed plate', () => {
    for (const [source, color] of [
      ...MARK_COLORS.filter(([source]) => source !== 'shell'),
      ['neutral', SOURCE_IDENTITY_NEUTRAL] as const,
    ]) {
      expect(
        contrastRatio(color, SOURCE_IDENTITY_BACKPLATE),
        source
      ).toBeGreaterThanOrEqual(4.5);
    }
    expect(
      contrastRatio(SOURCE_IDENTITY_BORDER, SOURCE_IDENTITY_BACKPLATE)
    ).toBeGreaterThanOrEqual(3);
    // The shell is a Project tool, not a branded source: its mark is a
    // graphic, held to the graphical minimum on the plate.
    expect(
      contrastRatio(SHELL_SOURCE_COLOR, SOURCE_IDENTITY_BACKPLATE)
    ).toBeGreaterThanOrEqual(MARK_MINIMUM_CONTRAST);
  });
});

describe('agentSourceIdentity is the one identity registry (BUG-293)', () => {
  it('names every declared source from its declaration', () => {
    for (const source of AGENT_SOURCE_DECLARATIONS) {
      expect(agentSourceIdentity(source.adapterId)).toMatchObject({
        label: source.label,
        color: source.color,
      });
    }
  });

  it('is total over ids a saved record may outlive', () => {
    expect(agentSourceIdentity('shell').kind).toBe('shell');
    expect(agentSourceIdentity('custom').kind).toBe('unmarked');
    expect(agentSourceIdentity('retired-harness')).toMatchObject({
      label: 'retired-harness',
      color: null,
      kind: 'unknown',
    });
  });
});

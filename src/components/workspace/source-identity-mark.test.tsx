import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AGENT_SOURCE_DECLARATIONS } from '@/generated/agent-source-declarations';
import { contrastRatio } from '@/lib/appearance/color';
import { HarnessGlyph } from './harness-icons';
import {
  SOURCE_IDENTITY_BACKPLATE,
  SOURCE_IDENTITY_BORDER,
  SourceIdentityMark,
} from './source-identity-mark';

describe('Agent Source identity projection', () => {
  it('keeps every first-party source color readable on its stable backing plate', () => {
    for (const source of AGENT_SOURCE_DECLARATIONS) {
      expect(
        contrastRatio(source.color, SOURCE_IDENTITY_BACKPLATE),
        source.label
      ).toBeGreaterThanOrEqual(4.5);
    }
    expect(
      contrastRatio(SOURCE_IDENTITY_BORDER, SOURCE_IDENTITY_BACKPLATE)
    ).toBeGreaterThanOrEqual(3);
  });

  it.each(['claude', 'codex', 'opencode'] as const)(
    'projects the %s glyph through its gated source color',
    harness => {
      const source = AGENT_SOURCE_DECLARATIONS.find(
        candidate => candidate.harness === harness
      );
      expect(source).toBeDefined();

      const { container } = render(
        <SourceIdentityMark color={source!.color}>
          <HarnessGlyph harness={harness} />
        </SourceIdentityMark>
      );
      const mark = container.querySelector('[data-source-identity-mark]');
      const glyph = container.querySelector('[data-slot="harness-glyph"]');

      expect(mark).toHaveStyle({ color: source!.color });
      // Every mark takes the surrounding ink the same way (ENG-031 W10). The
      // three-way branch this replaced existed because three of the glyphs
      // were drawn differently from each other; they are all the vendors' own
      // filled path data now, so there is one shape of assertion.
      expect(glyph).toHaveAttribute('fill', 'currentColor');
    }
  );
});

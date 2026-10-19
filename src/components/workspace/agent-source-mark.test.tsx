import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ActiveThemeContext } from '@/components/appearance/active-theme';
import { THEME_REGISTRY } from '@/generated/theme-registry';
import type { ThemeDefinitionV1 } from '@/lib/appearance/types';
import {
  agentSourceIdentity,
  SOURCE_IDENTITY_BACKPLATE,
} from './agent-source-identity';
import { AgentSourceMark } from './agent-source-mark';

const theme = { current: null as ThemeDefinitionV1 | null };

function mark(ui: React.ReactElement) {
  const { container } = render(
    <ActiveThemeContext.Provider value={theme.current}>
      {ui}
    </ActiveThemeContext.Provider>
  );
  return container.querySelector<HTMLElement>('[data-agent-source-mark]')!;
}

describe('AgentSourceMark', () => {
  beforeEach(() => {
    theme.current = null;
  });

  it('draws Codex in the surrounding ink on Air, where its brand colour would vanish (BUG-292)', () => {
    theme.current = THEME_REGISTRY['exawatt-air-light'];
    const codex = mark(<AgentSourceMark source="codex" />);
    expect(codex).toHaveAttribute('data-mark-ink', 'ink');
    expect(codex).toHaveStyle({
      color: THEME_REGISTRY['exawatt-air-light'].foundation.textMuted,
    });
  });

  it('keeps the brand colour on a dark ground it clears', () => {
    theme.current = THEME_REGISTRY['exawatt-classic-dark'];
    const codex = mark(<AgentSourceMark source="codex" />);
    expect(codex).toHaveAttribute('data-mark-ink', 'brand');
    expect(codex).toHaveStyle({ color: agentSourceIdentity('codex').color! });
  });

  it('paints the brand colour on the fixed plate in every theme', () => {
    theme.current = THEME_REGISTRY['exawatt-air-light'];
    const plated = mark(<AgentSourceMark plate source="claude" />);
    expect(plated).toHaveStyle({
      color: agentSourceIdentity('claude').color!,
      background: SOURCE_IDENTITY_BACKPLATE,
    });
  });

  it.each([
    ['codex', 'svg[data-slot="harness-glyph"]'],
    ['qwen', 'svg.lucide-sparkles'],
    ['shell', 'svg.lucide-square-terminal'],
    [
      'retired-harness',
      'svg.lucide-circle-question-mark, svg.lucide-circle-help',
    ],
  ])('gives %s a glyph, never an empty box', (source, selector) => {
    expect(
      mark(<AgentSourceMark source={source} />).querySelector(selector)
    ).not.toBeNull();
  });

  it('names the source when asked, and hides from assistive technology otherwise', () => {
    expect(
      mark(<AgentSourceMark source="openclaw" labelled />)
    ).toHaveAccessibleName('OpenClaw');
    expect(mark(<AgentSourceMark source="openclaw" />)).toHaveAttribute(
      'aria-hidden',
      'true'
    );
  });
});

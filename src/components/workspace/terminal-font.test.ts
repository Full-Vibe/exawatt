import { describe, expect, it } from 'vitest';
import {
  acceptTerminalSettings,
  loadedTerminalFont,
  resolveTerminalFont,
  terminalFontsEqual,
  TERMINAL_FONT,
} from './terminal-font';

describe('terminal font resolution', () => {
  it('resolves the complete user override', () => {
    expect(
      resolveTerminalFont({
        fontFamily: 'Meslo LG S for Powerline',
        fontSize: 14,
        lineHeight: 1,
        letterSpacing: -1,
      })
    ).toEqual({
      family: 'Meslo LG S for Powerline',
      size: 14,
      lineHeight: 1,
      letterSpacing: -1,
      cellWidthEstimate: 7.4,
    });
  });

  it('detects whether a live pane actually needs an update', () => {
    const defaults = resolveTerminalFont(null);
    expect(terminalFontsEqual(defaults, { ...defaults })).toBe(true);
    expect(
      terminalFontsEqual(defaults, { ...defaults, size: defaults.size + 1 })
    ).toBe(false);
    expect(
      terminalFontsEqual(defaults, {
        ...defaults,
        letterSpacing: defaults.letterSpacing - 1,
      })
    ).toBe(false);
    expect(defaults.family).toBe(TERMINAL_FONT.family);
  });

  it('accepts refreshed settings for existing panes and spawn estimates', () => {
    const refreshed = acceptTerminalSettings({
      terminal: {
        fontFamily: 'Meslo LG S for Powerline',
        fontSize: 14,
        lineHeight: 1,
        letterSpacing: -1,
      },
    });
    expect(loadedTerminalFont()).toBe(refreshed);
    expect(refreshed).toMatchObject({
      family: 'Meslo LG S for Powerline',
      size: 14,
      lineHeight: 1,
      letterSpacing: -1,
    });
  });
});

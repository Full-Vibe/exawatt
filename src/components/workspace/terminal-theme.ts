import type { ITheme } from '@xterm/xterm';
import type {
  ResolvedAppearance,
  ThemeTerminalV1,
} from '@/lib/appearance/types';

/** WCAG-oriented xterm floor required by the ENG-032 terminal contract. */
export const XTERM_MINIMUM_CONTRAST_RATIO = 4.5;

/**
 * Translate the declarative theme contract into xterm's renderer contract.
 * The copy is intentional: xterm may retain its options object, while the
 * resolved appearance remains immutable application state.
 */
export function xtermThemeFromTerminalPalette(
  palette: ThemeTerminalV1
): Readonly<ITheme> {
  return Object.freeze({
    background: palette.background,
    foreground: palette.foreground,
    cursor: palette.cursor,
    cursorAccent: palette.cursorAccent,
    selectionBackground: palette.selectionBackground,
    selectionForeground: palette.selectionForeground,
    black: palette.black,
    red: palette.red,
    green: palette.green,
    yellow: palette.yellow,
    blue: palette.blue,
    magenta: palette.magenta,
    cyan: palette.cyan,
    white: palette.white,
    brightBlack: palette.brightBlack,
    brightRed: palette.brightRed,
    brightGreen: palette.brightGreen,
    brightYellow: palette.brightYellow,
    brightBlue: palette.brightBlue,
    brightMagenta: palette.brightMagenta,
    brightCyan: palette.brightCyan,
    brightWhite: palette.brightWhite,
  });
}
export function xtermThemeForAppearance(
  resolved: ResolvedAppearance
): Readonly<ITheme> {
  return xtermThemeFromTerminalPalette(resolved.theme.terminal);
}

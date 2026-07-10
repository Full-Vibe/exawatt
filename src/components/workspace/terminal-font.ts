import type { ExawattSettings } from '@/types/electron';

/**
 * Terminal font resolution (ENG-015 S3): defaults + the user's
 * settings.json, shared by every consumer —
 * the pane (xterm options), the workspace client (render gate), and the
 * auto-revive spawn-size estimate. The revive path AWAITS the same promise,
 * so restored sessions are never sized with default metrics while a custom
 * font is still in flight (that would recreate the exact TUI init-width
 * race the spawn estimate exists to kill).
 */

/** the DEFAULT is a NATIVE-FIRST stack (not the site's display mono):
 *  terminals should look like the platform's terminals for every user —
 *  SF Mono when installed, Menlo on macOS, Consolas on Windows. Personal
 *  taste goes in settings.json, never here (genericize rule). */
export const TERMINAL_FONT = {
  family:
    '"SF Mono", Menlo, Monaco, Consolas, "DejaVu Sans Mono", monospace',
  size: 13,
  lineHeight: 1.25,
  letterSpacing: 0,
  fontStrokeWidth: 0,
  /** mono advance ≈ 0.6em (estimate; fit refines) */
  cellWidthEstimate: 7.8,
} as const;

export interface EffectiveTerminalFont {
  family: string;
  size: number;
  lineHeight: number;
  letterSpacing: number;
  fontStrokeWidth: number;
  cellWidthEstimate: number;
}

function cellWidthEstimate(size: number, letterSpacing: number): number {
  const dpr =
    typeof window === 'undefined' ? 1 : Math.max(1, window.devicePixelRatio);
  // xterm's DOM renderer rounds this option to a device pixel before adding
  // it to the measured glyph advance.
  return Math.max(1, size * 0.6 + Math.round(letterSpacing) / dpr);
}

export function resolveTerminalFont(
  settings:
    | {
        fontFamily?: string;
        fontSize?: number;
        lineHeight?: number;
        letterSpacing?: number;
        fontStrokeWidth?: number;
      }
    | null
    | undefined
): EffectiveTerminalFont {
  const size = settings?.fontSize ?? TERMINAL_FONT.size;
  const letterSpacing = settings?.letterSpacing ?? TERMINAL_FONT.letterSpacing;
  return {
    family: settings?.fontFamily ?? TERMINAL_FONT.family,
    size,
    lineHeight: settings?.lineHeight ?? TERMINAL_FONT.lineHeight,
    letterSpacing,
    fontStrokeWidth:
      settings?.fontStrokeWidth ?? TERMINAL_FONT.fontStrokeWidth,
    cellWidthEstimate: cellWidthEstimate(size, letterSpacing),
  };
}

let loadPromise: Promise<EffectiveTerminalFont> | null = null;
let loaded: EffectiveTerminalFont | null = null;

function fetchTerminalFont(): Promise<EffectiveTerminalFont> {
  return (window.electron?.settings?.get() ?? Promise.resolve(null))
    .catch(() => null)
    .then((settings) => resolveTerminalFont(settings?.terminal));
}

export function terminalFontsEqual(
  a: EffectiveTerminalFont | null,
  b: EffectiveTerminalFont
): boolean {
  return (
    a?.family === b.family &&
    a.size === b.size &&
    a.lineHeight === b.lineHeight &&
    a.letterSpacing === b.letterSpacing &&
    a.fontStrokeWidth === b.fontStrokeWidth
  );
}

function storeTerminalFont(font: EffectiveTerminalFont): EffectiveTerminalFont {
  loaded = font;
  loadPromise = Promise.resolve(font);
  return font;
}

export function acceptTerminalSettings(
  settings: ExawattSettings | null
): EffectiveTerminalFont {
  return storeTerminalFont(resolveTerminalFont(settings?.terminal));
}

/** initial settings fetch; safe on the web (resolves to defaults) */
export function loadTerminalFont(): Promise<EffectiveTerminalFont> {
  if (!loadPromise) {
    loadPromise = fetchTerminalFont().then(storeTerminalFont);
  }
  return loadPromise;
}

/** sync view of the resolved font — null until loadTerminalFont settles */
export function loadedTerminalFont(): EffectiveTerminalFont | null {
  return loaded;
}

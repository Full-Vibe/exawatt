/**
 * Terminal font resolution (ENG-015 S3): defaults + the user's
 * settings.json, loaded ONCE per renderer and shared by every consumer —
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
  /** mono advance ≈ 0.6em (estimate; fit refines) */
  cellWidthEstimate: 7.8,
} as const;

export interface EffectiveTerminalFont {
  family: string;
  size: number;
  lineHeight: number;
  cellWidthEstimate: number;
}

export function resolveTerminalFont(settings: {
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
} | null | undefined): EffectiveTerminalFont {
  const size = settings?.fontSize ?? TERMINAL_FONT.size;
  return {
    family: settings?.fontFamily ?? TERMINAL_FONT.family,
    size,
    lineHeight: settings?.lineHeight ?? TERMINAL_FONT.lineHeight,
    cellWidthEstimate: size * 0.6,
  };
}

let loadPromise: Promise<EffectiveTerminalFont> | null = null;
let loaded: EffectiveTerminalFont | null = null;

/** one settings fetch per renderer; safe on the web (resolves to defaults) */
export function loadTerminalFont(): Promise<EffectiveTerminalFont> {
  if (!loadPromise) {
    loadPromise = (
      window.electron?.settings?.get() ?? Promise.resolve(null)
    )
      .catch(() => null)
      .then((s) => {
        loaded = resolveTerminalFont(s?.terminal);
        return loaded;
      });
  }
  return loadPromise;
}

/** sync view of the resolved font — null until loadTerminalFont settles */
export function loadedTerminalFont(): EffectiveTerminalFont | null {
  return loaded;
}

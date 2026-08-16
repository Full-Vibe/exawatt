import type { BrowserWindowConstructorOptions } from 'electron';

/**
 * The window-shape contract an Accessibility-API window manager needs.
 *
 * Divvy, Rectangle, Moom, Magnet and Hammerspoon all move windows the same
 * way: they resolve the frontmost app through the macOS Accessibility API, read
 * `AXWindows`, and write `AXPosition`/`AXSize`. Everything they need is decided
 * at `BrowserWindow` construction, and every one of those options is otherwise
 * an unremarkable chrome choice that a later visual change can flip without
 * anything failing. That is the structural reason "Exawatt can't be tiled" can
 * reappear: the requirements were inline literals inside `createWindow`, sitting
 * among appearance options, with nothing asserting them.
 *
 * They live here as one named contract with a test that pins each requirement
 * to the reason it exists. `main.ts` spreads it; a chrome change that would
 * make Exawatt untileable now has to delete a documented invariant.
 *
 * **What this does NOT fix.** Incident `0001` proved that the window shape is
 * not the only way tiling dies: a long-lived Exawatt process can stop vending
 * its accessibility element entirely (a known Chromium/Electron-on-macOS
 * failure mode), at which point a window manager resolves the app to ZERO
 * windows and correctly does nothing. That has no in-process remedy; the
 * shipped answer is Help → "Window Management Isn't Working…". BUG-002 matches
 * that record, not this contract — see `incidents/0001`.
 */
export const AX_TILEABLE_WINDOW_SHAPE = {
  // A window manager writes AXSize; a non-resizable window refuses it, and the
  // frame silently does not move.
  resizable: true,
  // AXZoomButton / AXFullScreenButton are attributes of the standard window
  // buttons. `hiddenInset` hides the title BAR, not the buttons, so the zoom
  // and full-screen actions a window manager may drive still exist. A frameless
  // or fully custom title bar removes them.
  titleBarStyle: 'hiddenInset',
  frame: true,
  maximizable: true,
  fullscreenable: true,
  // A transparent window is composited without a standard frame and reports a
  // different shape than it draws, so tiled frames land wrong.
  transparent: false,
  // macOS CLAMPS an AX-set frame to the window's minimum. The floor must stay
  // BELOW the smallest cell an operator tiles into: an 800x600 floor silently
  // vetoed every half/third-screen cell on a laptop display, which read as "the
  // window manager can't resize Exawatt" (operator, 2026-07-20). The chrome is
  // responsive and eval-verified down to 560 wide.
  minWidth: 560,
  minHeight: 400,
} as const satisfies BrowserWindowConstructorOptions;

/**
 * Logical point sizes of the displays the operator actually tiles on, smallest
 * first. The floor is asserted against cells derived from these rather than
 * against a remembered number, so a new small display is a data edit.
 */
export const REFERENCE_DISPLAY_SIZES = [
  { label: '13" MacBook Air', width: 1440, height: 900 },
  { label: '14" MacBook Pro', width: 1512, height: 982 },
  { label: '16" MacBook Pro', width: 1728, height: 1117 },
] as const;

/**
 * The smallest cell a common window manager produces: quarters (half the width
 * and half the height) on the smallest reference display. Divvy's default grid
 * goes finer than this, but a quarter is the smallest cell the operator's own
 * bindings produce, and it is the honest floor to design chrome against.
 */
export function smallestTilingCell(): { width: number; height: number } {
  return REFERENCE_DISPLAY_SIZES.reduce(
    (smallest, display) => ({
      width: Math.min(smallest.width, Math.floor(display.width / 2)),
      height: Math.min(smallest.height, Math.floor(display.height / 2)),
    }),
    { width: Number.POSITIVE_INFINITY, height: Number.POSITIVE_INFINITY }
  );
}

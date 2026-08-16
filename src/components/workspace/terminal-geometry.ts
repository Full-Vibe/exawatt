/**
 * The ONE owner of terminal pane geometry (BUG-019).
 *
 * A terminal has three descriptions of its own width and they must agree:
 *
 *   1. the INSET — the breathing room between the app boundary and the first
 *      painted cell;
 *   2. the fit addon's COLUMN COUNT, which it derives from the pane box minus
 *      the `.xterm` element's padding minus a scrollbar gutter;
 *   3. the PTY's window size, which is what every program inside the Session
 *      believes about its own width.
 *
 * When those three are set in three places, an inset added for looks silently
 * buys itself space by clipping the final column, and every full-width redraw
 * inside the Session is then wrong. So the inset is declared here, applied as
 * CSS custom properties the fit addon can SEE (it reads computed padding on
 * `.xterm`), and propagated to the PTY by the single sync step below — never
 * by a second caller that re-guesses the size.
 */
import type { CSSProperties } from 'react';

/**
 * Deliberate breathing room, on the 4px spacing grid
 * (`docs/engineering/design-system.md` → Spacing: 12px / 8px, the dense
 * operational tier). Paid for in columns, never in clipped pixels.
 */
export const TERMINAL_INSET = { x: 12, y: 8 } as const;

/**
 * Width the fit addon reserves for the scrollbar when scrollback is on.
 * Mirrored from `@xterm/addon-fit` so the expected-columns contract below can
 * be asserted without reaching into xterm internals.
 */
export const TERMINAL_SCROLLBAR_GUTTER = 14;

/** CSS custom properties the pane hands to `.terminal-pane .xterm` padding. */
export function terminalInsetVariables(): CSSProperties {
  return {
    '--terminal-inset-x': `${TERMINAL_INSET.x}px`,
    '--terminal-inset-y': `${TERMINAL_INSET.y}px`,
  } as CSSProperties;
}

/**
 * The honest column count for a pane of this width: the most whole cells that
 * fit AFTER the inset and the scrollbar gutter are taken out. Mirrors the fit
 * addon so a change to either side is a visible contradiction, not a drift.
 */
export function expectedTerminalCols(
  paneWidth: number,
  cellWidth: number
): number {
  if (!(cellWidth > 0)) return 0;
  const usable =
    paneWidth - TERMINAL_INSET.x * 2 - TERMINAL_SCROLLBAR_GUTTER;
  return Math.max(2, Math.floor(usable / cellWidth));
}

interface FittableTerminal {
  readonly cols: number;
  readonly rows: number;
}

/**
 * Build the single fit-then-propagate step. Every trigger — the pane's
 * ResizeObserver, tab activation, split/unsplit, a font change, the late TUI
 * resync — calls THIS, so the inset, the reported column count, the published
 * geometry, and the PTY's window size can never disagree.
 */
export function createTerminalSizeSync(options: {
  pane: HTMLElement;
  measure: HTMLElement;
  term: FittableTerminal;
  fit: () => void;
  resize: (cols: number, rows: number) => void;
  frozen: () => boolean;
}): () => void {
  const { pane, measure, term, fit, resize, frozen } = options;
  return () => {
    if (frozen()) return;
    if (measure.offsetWidth === 0 || measure.offsetHeight === 0) return;
    fit();
    publishTerminalGeometry(pane, term.cols, term.rows);
    resize(term.cols, term.rows);
  };
}

/**
 * Publish the reported geometry onto the pane element. This is product state,
 * not test scaffolding: it is what makes "the columns this pane claims" an
 * observable fact in any build, so the geometry contract can be asserted
 * against what actually painted instead of a screenshot impression.
 */
export function publishTerminalGeometry(
  pane: HTMLElement,
  cols: number,
  rows: number
): void {
  pane.dataset.terminalCols = String(cols);
  pane.dataset.terminalRows = String(rows);
  pane.dataset.terminalInsetX = String(TERMINAL_INSET.x);
  pane.dataset.terminalInsetY = String(TERMINAL_INSET.y);
}

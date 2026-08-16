import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  TERMINAL_INSET,
  TERMINAL_SCROLLBAR_GUTTER,
  createTerminalSizeSync,
  expectedTerminalCols,
  publishTerminalGeometry,
  terminalInsetVariables,
} from './terminal-geometry';

function sizedElement(width: number, height: number): HTMLElement {
  const element = document.createElement('div');
  Object.defineProperty(element, 'offsetWidth', { value: width });
  Object.defineProperty(element, 'offsetHeight', { value: height });
  return element;
}

describe('terminal geometry contract', () => {
  it('declares a real inset on the spacing grid', () => {
    expect(TERMINAL_INSET.x).toBeGreaterThan(0);
    expect(TERMINAL_INSET.y).toBeGreaterThan(0);
    expect(TERMINAL_INSET.x % 4).toBe(0);
    expect(TERMINAL_INSET.y % 4).toBe(0);
  });

  it('publishes the inset as the css variables the fit addon can see', () => {
    expect(terminalInsetVariables()).toEqual({
      '--terminal-inset-x': `${TERMINAL_INSET.x}px`,
      '--terminal-inset-y': `${TERMINAL_INSET.y}px`,
    });
  });

  // The whole point of BUG-019: the inset is paid for in COLUMNS. A terminal
  // that keeps its old column count and hides the last one behind padding
  // corrupts every full-width redraw inside the Session.
  it('charges the inset to the column budget instead of clipping', () => {
    const paneWidth = 1000;
    const cellWidth = 10;
    const withoutInset = Math.floor(
      (paneWidth - TERMINAL_SCROLLBAR_GUTTER) / cellWidth
    );
    const withInset = expectedTerminalCols(paneWidth, cellWidth);
    expect(withInset).toBe(
      Math.floor(
        (paneWidth - TERMINAL_INSET.x * 2 - TERMINAL_SCROLLBAR_GUTTER) /
          cellWidth
      )
    );
    expect(withInset).toBeLessThan(withoutInset);
    // and what paints still fits inside the inset viewport
    expect(withInset * cellWidth).toBeLessThanOrEqual(
      paneWidth - TERMINAL_INSET.x * 2
    );
  });

  it('never proposes fewer than two columns', () => {
    expect(expectedTerminalCols(10, 10)).toBe(2);
    expect(expectedTerminalCols(1000, 0)).toBe(0);
  });
});

describe('createTerminalSizeSync', () => {
  let pane: HTMLElement;
  let measure: HTMLElement;
  let fit: Mock<() => void>;
  let resize: Mock<(cols: number, rows: number) => void>;

  beforeEach(() => {
    pane = document.createElement('div');
    measure = sizedElement(800, 400);
    fit = vi.fn(() => undefined);
    resize = vi.fn((_cols: number, _rows: number) => undefined);
  });

  it('fits, publishes, and propagates in one step', () => {
    const sync = createTerminalSizeSync({
      pane,
      measure,
      term: { cols: 96, rows: 30 },
      fit,
      resize,
      frozen: () => false,
    });
    sync();
    expect(fit).toHaveBeenCalledTimes(1);
    expect(resize).toHaveBeenCalledWith(96, 30);
    expect(pane.dataset.terminalCols).toBe('96');
    expect(pane.dataset.terminalRows).toBe('30');
    expect(pane.dataset.terminalInsetX).toBe(String(TERMINAL_INSET.x));
  });

  it('freezes a hidden pane so it cannot SIGWINCH at the wrong width', () => {
    const sync = createTerminalSizeSync({
      pane,
      measure,
      term: { cols: 96, rows: 30 },
      fit,
      resize,
      frozen: () => true,
    });
    sync();
    expect(fit).not.toHaveBeenCalled();
    expect(resize).not.toHaveBeenCalled();
  });

  it('ignores a pane with no box yet', () => {
    const sync = createTerminalSizeSync({
      pane,
      measure: sizedElement(0, 0),
      term: { cols: 96, rows: 30 },
      fit,
      resize,
      frozen: () => false,
    });
    sync();
    expect(fit).not.toHaveBeenCalled();
    expect(resize).not.toHaveBeenCalled();
  });

  it('publishes geometry an operator-visible assertion can read', () => {
    publishTerminalGeometry(pane, 120, 40);
    expect(pane.dataset.terminalCols).toBe('120');
    expect(pane.dataset.terminalRows).toBe('40');
  });
});

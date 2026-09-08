import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';
import {
  TERMINAL_INSET,
  TERMINAL_SCROLLBAR_GUTTER,
  createTerminalSizeSync,
  expectedTerminalCols,
  observeTerminalGeometry,
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

describe('renderer metric changes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('refits a fixed-size visible pane after display-scale metrics change, and freezes its hidden sibling', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    const paint = () => {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(0);
    };
    const observers: Array<{ targets: Set<Element>; notify: () => void }> = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        targets = new Set<Element>();
        constructor(notify: () => void) {
          observers.push({ targets: this.targets, notify });
        }
        observe(target: Element) {
          this.targets.add(target);
        }
        disconnect() {
          this.targets.clear();
        }
      }
    );
    const resized = (target: Element) => {
      for (const observer of observers) {
        if (observer.targets.has(target)) observer.notify();
      }
    };
    let cellWidth = 8;
    const panes = [false, true].map(hidden => {
      const measure = sizedElement(800, 400);
      const screen = document.createElement('div');
      const term = { cols: 100, rows: 30 };
      const resize = vi.fn();
      const state = { hidden };
      const sync = createTerminalSizeSync({
        pane: document.createElement('div'),
        measure,
        term,
        resize,
        fit: () => {
          term.cols = expectedTerminalCols(measure.offsetWidth, cellWidth);
        },
        frozen: () => state.hidden,
      });
      const disconnect = observeTerminalGeometry({ measure, screen, sync });
      return { screen, term, resize, state, sync, disconnect };
    });

    // Only the renderer's cells change. The container emits no resize event.
    cellWidth = 7;
    for (const pane of panes) {
      resized(pane.screen);
      resized(pane.screen);
    }
    expect(frames.size).toBe(panes.length);
    paint();
    expect(panes[0].resize).toHaveBeenLastCalledWith(
      expectedTerminalCols(800, cellWidth),
      30
    );
    expect(panes[1].resize).not.toHaveBeenCalled();
    expect(panes[1].term.cols).toBe(100);

    // Revealing the other pane consumes current metrics, not its hidden box.
    panes[1].state.hidden = false;
    panes[1].sync();
    expect(panes[1].resize).toHaveBeenLastCalledWith(
      expectedTerminalCols(800, cellWidth),
      30
    );
    for (const pane of panes) {
      resized(pane.screen);
      pane.disconnect();
      pane.resize.mockClear();
      resized(pane.screen);
      paint();
      expect(pane.resize).not.toHaveBeenCalled();
    }
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

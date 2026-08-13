import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_REGISTRY } from '@/generated/theme-registry';
import {
  DEFAULT_APPEARANCE_PREFERENCES,
  resolveAppearance,
} from '@/lib/appearance/resolve-appearance';
import type { ResolvedAppearance } from '@/lib/appearance/types';
import { TerminalPane } from './terminal-pane';
import { resolveTerminalFont } from './terminal-font';

const xterm = vi.hoisted(() => {
  const state = {
    appearance: null as ResolvedAppearance | null,
    terminals: [] as MockTerminal[],
    fitCalls: 0,
    disposeCalls: 0,
  };

  class MockTerminal {
    options: Record<string, unknown>;
    cols = 100;
    rows = 30;
    writes: string[] = [];
    buffer = {
      active: {
        getLine: () => undefined,
      },
    };

    constructor(options: Record<string, unknown>) {
      this.options = { ...options };
      state.terminals.push(this);
    }

    loadAddon() {}
    open() {}
    focus() {}
    selectAll() {}
    getSelection() {
      return '';
    }
    write(data: string) {
      this.writes.push(data);
    }
    dispose() {
      state.disposeCalls += 1;
    }
    attachCustomKeyEventHandler() {}
    registerLinkProvider() {
      return { dispose: vi.fn() };
    }
    onData() {
      return { dispose: vi.fn() };
    }
  }

  class FitAddon {
    fit() {
      state.fitCalls += 1;
    }
  }

  class SearchAddon {
    findNext() {
      return false;
    }
    findPrevious() {
      return false;
    }
    clearDecorations() {}
  }

  class WebLinksAddon {}

  class WebglAddon {
    onContextLoss() {
      return { dispose: vi.fn() };
    }
    dispose() {}
  }

  return {
    state,
    MockTerminal,
    FitAddon,
    SearchAddon,
    WebLinksAddon,
    WebglAddon,
  };
});

vi.mock('@/components/appearance/appearance-provider', () => ({
  useAppearance: () => ({ resolved: xterm.state.appearance }),
}));
vi.mock('@xterm/xterm', () => ({ Terminal: xterm.MockTerminal }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: xterm.FitAddon }));
vi.mock('@xterm/addon-search', () => ({ SearchAddon: xterm.SearchAddon }));
vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: xterm.WebLinksAddon,
}));
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: xterm.WebglAddon }));

const SIGNALS = {
  dark: true,
  highContrast: false,
  forcedColors: false,
  invertedColors: false,
  reducedTransparency: false,
};

function resolved(themeId?: string): ResolvedAppearance {
  return resolveAppearance(
    THEME_REGISTRY,
    DEFAULT_APPEARANCE_PREFERENCES,
    SIGNALS,
    themeId ? { themeId } : undefined
  );
}

const font = resolveTerminalFont(null);

beforeEach(() => {
  xterm.state.appearance = resolved();
  xterm.state.terminals.length = 0;
  xterm.state.fitCalls = 0;
  xterm.state.disposeCalls = 0;

  class ResizeObserverMock {
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 800,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 400,
  });

  const pty = {
    onData: vi.fn(() => vi.fn()),
    bufferSnapshot: vi.fn(async () => ({ text: 'live history', cursor: 1 })),
    bufferSince: vi.fn(async () => ({ text: '', cursor: 1 })),
    resize: vi.fn(async () => undefined),
    write: vi.fn(async () => undefined),
    openExternal: vi.fn(async () => undefined),
    openPath: vi.fn(async () => undefined),
    copyText: vi.fn(async () => undefined),
    pasteClipboard: vi.fn(async () => undefined),
  };
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: { pty },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('xterm theme lifecycle', () => {
  it('updates a live terminal without remount, replay, fit, or PTY resize', async () => {
    const view = render(
      <TerminalPane active cwd="/tmp/project" font={font} sessionId="live-1" />
    );

    await waitFor(() => expect(xterm.state.terminals).toHaveLength(1));
    const terminal = xterm.state.terminals[0];
    await waitFor(() => expect(terminal.writes).toEqual(['live history']));
    const pty = window.electron!.pty!;
    const fitCalls = xterm.state.fitCalls;
    const resizeCalls = vi.mocked(pty.resize).mock.calls.length;

    xterm.state.appearance = resolved('exawatt-air-light');
    view.rerender(
      <TerminalPane active cwd="/tmp/project" font={font} sessionId="live-1" />
    );

    await waitFor(() =>
      expect(
        (terminal.options.theme as { background: string }).background
      ).toBe('#F7F9F5')
    );
    expect(xterm.state.terminals).toHaveLength(1);
    expect(xterm.state.disposeCalls).toBe(0);
    expect(terminal.writes).toEqual(['live history']);
    expect(xterm.state.fitCalls).toBe(fitCalls);
    expect(vi.mocked(pty.resize)).toHaveBeenCalledTimes(resizeCalls);
    expect(terminal.options.minimumContrastRatio).toBe(4.5);
  });
});

import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_REGISTRY } from '@/generated/theme-registry';
import {
  DEFAULT_APPEARANCE_PREFERENCES,
  resolveAppearance,
} from '@/lib/appearance/resolve-appearance';
import type { ResolvedAppearance } from '@/lib/appearance/types';
import { TerminalPane } from './terminal-pane';
import { resolveTerminalFont } from './terminal-font';
import { installBridgeDouble } from '@/test-support/desktop-bridge-double';

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
        getNullCell: () => ({ getChars: () => '', getWidth: () => 1 }),
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
    write(data: string, parsed?: () => void) {
      this.writes.push(data);
      parsed?.();
    }
    onRender() {
      return { dispose: vi.fn() };
    }
    dispose() {
      state.disposeCalls += 1;
    }
    keyHandler: ((event: KeyboardEvent) => boolean) | null = null;
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
      this.keyHandler = handler;
    }
    registerLinkProvider() {
      return { dispose: vi.fn() };
    }
    dataListeners: Array<(data: string) => void> = [];
    onData(listener: (data: string) => void) {
      this.dataListeners.push(listener);
      return { dispose: vi.fn() };
    }
    /** Set by the program through `ESC[?2004h`. */
    bracketedPasteMode = false;
    /** As xterm 6 pastes (`browser/Clipboard.ts` `paste`): newlines become
     *  Return, the text is bracketed when the program asked for it, and the
     *  data event fires synchronously. */
    paste(text: string) {
      const typed = text.replace(/\r?\n/g, '\r');
      const data = this.bracketedPasteMode
        ? `\x1b[200~${typed}\x1b[201~`
        : typed;
      for (const listener of this.dataListeners) listener(data);
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
    WebglAddon,
  };
});

vi.mock('@/components/appearance/appearance-provider', () => ({
  useAppearance: () => ({ resolved: xterm.state.appearance }),
}));
vi.mock('@xterm/xterm', () => ({ Terminal: xterm.MockTerminal }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: xterm.FitAddon }));
vi.mock('@xterm/addon-search', () => ({ SearchAddon: xterm.SearchAddon }));
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
    bufferSince: vi.fn(async () => ({ text: '', cursor: 1, truncated: false })),
    resize: vi.fn(async () => undefined),
    write: vi.fn(async () => undefined),
    openExternal: vi.fn(async () => undefined),
    openPath: vi.fn(async () => undefined),
    copyText: vi.fn(async () => undefined),
    clipboardRead: vi.fn(async () => ({ kind: 'empty' as const, text: '' })),
  };
  installBridgeDouble({ pty });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('xterm theme lifecycle', () => {
  it('attaches on first reveal, replays main-owned history, then retains the renderer while hidden', async () => {
    const view = render(
      <TerminalPane
        active={false}
        layout="hidden"
        cwd="/tmp/project"
        font={font}
        sessionId="live-1"
      />
    );
    await act(async () => {});
    const pty = window.electron!.pty!;
    expect(xterm.state.terminals).toHaveLength(0);
    expect(pty.bufferSnapshot).not.toHaveBeenCalled();
    expect(pty.resize).not.toHaveBeenCalled();

    view.rerender(
      <TerminalPane
        active
        layout="full"
        cwd="/tmp/project"
        font={font}
        sessionId="live-1"
      />
    );
    await waitFor(() =>
      expect(xterm.state.terminals[0]?.writes).toEqual(['live history'])
    );
    const terminal = xterm.state.terminals[0];
    const snapshots = vi.mocked(pty.bufferSnapshot).mock.calls.length;
    const receive = vi.mocked(pty.onData).mock.calls[0][0];
    const unsubscribe = vi.mocked(pty.onData).mock.results[0].value;
    view.rerender(
      <TerminalPane
        active={false}
        layout="hidden"
        cwd="/tmp/project"
        font={font}
        sessionId="live-1"
      />
    );
    receive({
      id: 'live-1',
      durableSessionId: 'durable-1',
      data: ' later output',
      cursor: 2,
    });
    expect(terminal.writes).toEqual(['live history', ' later output']);
    view.rerender(
      <TerminalPane
        active
        layout="left"
        cwd="/tmp/project"
        font={font}
        sessionId="live-1"
      />
    );
    expect(xterm.state.terminals).toEqual([terminal]);
    expect(xterm.state.disposeCalls).toBe(0);
    expect(pty.bufferSnapshot).toHaveBeenCalledTimes(snapshots);
    view.unmount();
    expect(xterm.state.disposeCalls).toBe(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

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

describe('terminal scrollback search', () => {
  it('marks the control that closes the search it opened', async () => {
    render(
      <TerminalPane active cwd="/tmp/project" font={font} sessionId="live-1" />
    );
    await waitFor(() =>
      expect(xterm.state.terminals[0]?.keyHandler).toBeTruthy()
    );
    const terminal = xterm.state.terminals[0];
    act(() => {
      terminal.keyHandler!(
        new KeyboardEvent('keydown', { key: 'f', metaKey: true })
      );
    });
    const close = await waitFor(() => {
      const element = document.querySelector(
        '[data-terminal-search] [data-terminal-search-close]'
      );
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    fireEvent.click(close);
    expect(document.querySelector('[data-terminal-search]')).toBeNull();
  });
});

describe('terminal paste', () => {
  async function mountedTerminal() {
    const view = render(
      <TerminalPane active cwd="/tmp/project" font={font} sessionId="live-1" />
    );
    await waitFor(() =>
      expect(xterm.state.terminals[0]?.keyHandler).toBeTruthy()
    );
    return { view, terminal: xterm.state.terminals[0] };
  }

  it('hands ⌘V to xterm, which brackets it for a program that asked', async () => {
    const pty = window.electron!.pty!;
    vi.mocked(pty.clipboardRead).mockResolvedValue({
      kind: 'files',
      text: "'/Users/user/1 Auto.png' /Users/user/plain.png",
    });
    const { terminal } = await mountedTerminal();
    terminal.bracketedPasteMode = true;
    act(() => {
      terminal.keyHandler!(
        new KeyboardEvent('keydown', { key: 'v', metaKey: true })
      );
    });
    await waitFor(() =>
      expect(pty.write).toHaveBeenCalledWith(
        'live-1',
        "\x1b[200~'/Users/user/1 Auto.png' /Users/user/plain.png\x1b[201~",
        true
      )
    );
  });

  it('routes Edit ▸ Paste through the same paste, newlines as Return', async () => {
    const pty = window.electron!.pty!;
    vi.mocked(pty.clipboardRead).mockResolvedValue({
      kind: 'text',
      text: 'one\ntwo',
    });
    const { view } = await mountedTerminal();
    const surface = view.container.querySelector('.terminal-pane > div')!;
    expect(fireEvent.paste(surface)).toBe(false);
    await waitFor(() =>
      expect(pty.write).toHaveBeenCalledWith('live-1', 'one\rtwo', true)
    );
    expect(pty.write).toHaveBeenCalledTimes(1);
  });

  it('drops a clipboard read that settles after the pane is gone', async () => {
    const pty = window.electron!.pty!;
    let settle!: (clip: { kind: 'text'; text: string }) => void;
    vi.mocked(pty.clipboardRead).mockReturnValue(
      new Promise(resolve => {
        settle = resolve;
      })
    );
    const { view, terminal } = await mountedTerminal();
    act(() => {
      terminal.keyHandler!(
        new KeyboardEvent('keydown', { key: 'v', metaKey: true })
      );
    });
    view.unmount();
    await act(async () => settle({ kind: 'text', text: 'late' }));
    expect(pty.write).not.toHaveBeenCalled();
  });
});

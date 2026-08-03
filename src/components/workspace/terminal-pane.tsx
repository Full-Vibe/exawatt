// No 'use client' directive: only imported by the client workspace surface.

/**
 * One xterm.js pane bound to one PTY session (decision 0005).
 *
 * Lifecycle: mounts once per session and STAYS mounted while the session
 * lives — inactive tabs are hidden with CSS, not unmounted, so no output is
 * lost between tab switches. On (re)mount the main-process scrollback buffer
 * is replayed first, so renderer reloads restore what you saw.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import { FOCUS_ACTIVE_TERMINAL_EVENT } from './session-jump';
import { TERMINAL_FONT } from './terminal-font';
import type { EffectiveTerminalFont } from './terminal-font';
import { findFileLinks } from './terminal-links';
import { matchTerminalChord } from './terminal-chords';

export { TERMINAL_FONT, resolveTerminalFont } from './terminal-font';
export type { EffectiveTerminalFont } from './terminal-font';

export const HUD_TERM_THEME = {
  background: '#04060B',
  foreground: '#F4F4F4',
  cursor: '#19E6FF',
  cursorAccent: '#04060B',
  selectionBackground: 'rgba(25,230,255,0.25)',
  black: '#0B1220',
  red: '#FF1F4B',
  green: '#6FE39F',
  yellow: '#FFB02E',
  blue: '#55A0FF',
  magenta: '#FF3B8B',
  cyan: '#19E6FF',
  white: '#F4F4F4',
  brightBlack: '#6A7585',
  brightRed: '#FF5C7A',
  brightGreen: '#8FF0B5',
  brightYellow: '#FFC65C',
  brightBlue: '#7FB5FF',
  brightMagenta: '#FF6BA6',
  brightCyan: '#55EAD4',
  brightWhite: '#FFFFFF',
};

/** where this pane sits (S2 split view): full when alone, left/right when
 *  the active tab shares the surface with the pinned tab, hidden otherwise.
 *  Panes stay absolutely positioned so hidden ones never affect layout; the
 *  ResizeObserver + syncSize path absorbs the width change on (un)split. */
export type PaneLayout = 'full' | 'left' | 'right' | 'hidden';

export const LAYOUT_CLASS: Record<PaneLayout, string> = {
  full: 'absolute inset-0',
  left: 'absolute inset-y-0 left-0 w-1/2',
  right: 'absolute inset-y-0 right-0 w-1/2',
  hidden: 'absolute inset-0 invisible',
};

export function TerminalPane({
  sessionId,
  cwd,
  active,
  layout = 'full',
  font,
  onActivate,
}: {
  sessionId: string;
  cwd: string;
  active: boolean;
  layout?: PaneLayout;
  /** effective font (defaults + settings); panes render only after the
   *  workspace has resolved it, then accept live settings refreshes */
  font?: EffectiveTerminalFont;
  /** clicking into a visible-but-inactive pane makes its tab active */
  onActivate?: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState('0/0');
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchRef = useRef<{
    findNext(term: string, options?: object): boolean;
    findPrevious(term: string, options?: object): boolean;
    clearDecorations(): void;
  } | null>(null);
  // latest xterm handle for activation and live font refresh
  const termRef = useRef<{
    focus(): void;
    fit(): void;
    copySelection(): void;
    selectAll(): void;
    applyFont(font: EffectiveTerminalFont): void;
  } | null>(null);
  // the term is created ASYNC (dynamic import) — it must read the CURRENT
  // active state when it finally exists, or the first focus is lost
  const activeRef = useRef(active);
  activeRef.current = active;
  // the initial font resolves before mounting; later settings refreshes
  // update this ref and the live xterm through applyFont below
  const fontRef = useRef(font);
  fontRef.current = font;
  // hidden panes must NOT resize their PTY: an invisible element keeps
  // full-container geometry, so during a split every hidden session would
  // get SIGWINCHed to the WRONG width on each layout change (TUIs then
  // redraw scrollback at that width). Freeze while hidden; the layout
  // effect refits on reveal.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  useEffect(() => {
    const el = container.current;
    const api = window.electron?.pty;
    if (!el || !api) return;
    let disposed = false;
    // resources register the moment they exist (NOT in a batch at the end):
    // the destructor can run between any two awaits, and anything created
    // before it must still be released — splice makes disposal idempotent
    const cleanup: Array<() => void> = [];
    const dispose = () => {
      for (const fn of cleanup.splice(0)) fn();
    };

    (async () => {
      const [
        { Terminal },
        { FitAddon },
        { SearchAddon },
        { WebLinksAddon },
        { WebglAddon },
      ] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/addon-search'),
        import('@xterm/addon-web-links'),
        import('@xterm/addon-webgl'),
      ]);
      if (disposed) return;

      const f = fontRef.current;
      const term = new Terminal({
        fontFamily: f?.family ?? TERMINAL_FONT.family,
        fontSize: f?.size ?? TERMINAL_FONT.size,
        lineHeight: f?.lineHeight ?? TERMINAL_FONT.lineHeight,
        letterSpacing: f?.letterSpacing ?? TERMINAL_FONT.letterSpacing,
        cursorBlink: true,
        scrollback: 50_000,
        theme: HUD_TERM_THEME,
      });
      cleanup.push(() => term.dispose());
      const fit = new FitAddon();
      term.loadAddon(fit);
      const search = new SearchAddon({ highlightLimit: 2_000 });
      term.loadAddon(search);
      searchRef.current = search;
      cleanup.push(() => {
        searchRef.current = null;
      });
      const webLinks = new WebLinksAddon((_event, uri) => {
        void api.openExternal(uri);
      });
      term.loadAddon(webLinks);
      term.open(el);
      try {
        const webgl = new WebglAddon();
        term.loadAddon(webgl);
        const contextLoss = webgl.onContextLoss(() => webgl.dispose());
        cleanup.push(() => contextLoss.dispose());
      } catch {
        // Canvas renderer remains active when WebGL is unavailable.
      }
      const fileLinks = term.registerLinkProvider({
        provideLinks: (bufferLineNumber, callback) => {
          const line = term.buffer.active
            .getLine(bufferLineNumber - 1)
            ?.translateToString(true);
          if (!line) {
            callback(undefined);
            return;
          }
          const links = findFileLinks(line).map(link => ({
            range: {
              start: { x: link.start, y: bufferLineNumber },
              end: { x: link.end, y: bufferLineNumber },
            },
            text: link.text,
            activate: () => void api.openPath(link.path, cwd),
          }));
          callback(links.length > 0 ? links : undefined);
        },
      });
      cleanup.push(() => fileLinks.dispose());
      // handled shortcuts must CONSUME their key event (D28): on macOS an
      // unconsumed key equivalent is re-dispatched to the application menu
      // after the renderer declines it, so ⌘V here PLUS the Edit ▸ Paste
      // role (registered ⌘V accelerator) once wrote the clipboard to the
      // PTY twice
      let operatorInputPending = false;
      let operatorInputTimer: ReturnType<typeof setTimeout> | null = null;
      const markOperatorInput = () => {
        operatorInputPending = true;
        if (operatorInputTimer) clearTimeout(operatorInputTimer);
        // A dead/non-producing key or pointer event must not label unrelated
        // terminal protocol data forever. xterm emits interactive data well
        // inside this bound.
        operatorInputTimer = setTimeout(() => {
          operatorInputPending = false;
          operatorInputTimer = null;
        }, 250);
      };
      // Capture the browser event before xterm translates it into onData.
      // attachCustomKeyEventHandler is a shortcut filter, not a dependable
      // provenance hook: xterm may emit data before invoking that filter.
      const onTerminalKeyDown = (event: KeyboardEvent) => {
        if (event.metaKey) return;
        if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(event.key))
          return;
        markOperatorInput();
      };
      const onTerminalPointerDown = () => markOperatorInput();
      el.addEventListener('keydown', onTerminalKeyDown, true);
      el.addEventListener('pointerdown', onTerminalPointerDown, true);
      cleanup.push(() => {
        el.removeEventListener('keydown', onTerminalKeyDown, true);
        el.removeEventListener('pointerdown', onTerminalPointerDown, true);
      });
      // The pane claims exactly the chords it implements; a declined chord
      // (for example ⌘⇧F quick feedback) bubbles on to the workspace layers.
      term.attachCustomKeyEventHandler(event => {
        const verb = matchTerminalChord(event);
        if (!verb) return true;
        event.preventDefault();
        switch (verb) {
          case 'find':
            setSearchOpen(true);
            requestAnimationFrame(() => searchInput.current?.focus());
            break;
          case 'copy': {
            const selection = term.getSelection();
            if (selection) void api.copyText(selection);
            break;
          }
          case 'paste':
            void api.pasteClipboard(sessionId);
            break;
          case 'select-all':
            term.selectAll();
            break;
        }
        return false;
      });
      // paste is ONE verb with ONE implementation (D28): a menu-driven
      // Edit ▸ Paste lands as a DOM paste event on xterm's textarea —
      // capture it before xterm's text-only default and route it through
      // the same image-aware main-process write as ⌘V
      const onDomPaste = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        void api.pasteClipboard(sessionId);
      };
      el.addEventListener('paste', onDomPaste, true);
      cleanup.push(() => el.removeEventListener('paste', onDomPaste, true));
      fit.fit();
      // the ONE fit-then-propagate path (pane resize, activation, resync)
      const syncSize = () => {
        if (layoutRef.current === 'hidden') return; // frozen while hidden
        if (el.offsetWidth === 0 || el.offsetHeight === 0) return;
        fit.fit();
        void api.resize(sessionId, term.cols, term.rows);
      };
      termRef.current = {
        focus: () => term.focus(),
        fit: syncSize,
        copySelection: () => {
          const selection = term.getSelection();
          if (selection) void api.copyText(selection);
        },
        selectAll: () => term.selectAll(),
        applyFont: next => {
          term.options.fontFamily = next.family;
          term.options.fontSize = next.size;
          term.options.lineHeight = next.lineHeight;
          term.options.letterSpacing = next.letterSpacing;
          syncSize();
        },
      };
      cleanup.push(() => {
        termRef.current = null;
      });

      // Subscribe before taking the replay snapshot. Absolute cursors make the
      // handoff lossless without replaying bytes emitted during the IPC call.
      let snapshotCursor = Number.POSITIVE_INFINITY;
      const pendingData: Array<{ data: string; cursor: number }> = [];
      const offData = api.onData(({ id, data, cursor }) => {
        if (id !== sessionId) return;
        if (snapshotCursor === Number.POSITIVE_INFINITY) {
          pendingData.push({ data, cursor });
        } else if (cursor > snapshotCursor) {
          term.write(data);
          snapshotCursor = cursor;
        }
      });
      cleanup.push(offData);
      const snapshot = await api.bufferSnapshot(sessionId);
      if (disposed) {
        // unmounted while the buffer fetch was in flight — the destructor
        // already ran; release what was created since
        dispose();
        return;
      }
      const catchup = await api.bufferSince(sessionId, snapshot.cursor);
      if (disposed) {
        dispose();
        return;
      }
      if (snapshot.text) term.write(snapshot.text);
      if (catchup.text) term.write(catchup.text);
      snapshotCursor = catchup.cursor;
      for (const item of pendingData) {
        if (item.cursor <= snapshotCursor) continue;
        term.write(item.data);
        snapshotCursor = item.cursor;
      }
      pendingData.length = 0;
      void api.resize(sessionId, term.cols, term.rows);
      if (activeRef.current) term.focus();
      // Late re-sync for TUIs that were mid-init when a resize landed
      // (before their WINCH handler existed). A same-size TIOCSWINSZ emits
      // NO SIGWINCH, so a plain re-resize is a kernel-level no-op — wiggle
      // one row and back to force two real signals, ending at the true size.
      const resync = setTimeout(() => {
        if (el.offsetWidth === 0 || el.offsetHeight === 0) return;
        fit.fit();
        const { cols, rows } = term;
        void api
          .resize(sessionId, cols, rows > 1 ? rows - 1 : rows + 1)
          .then(() => api.resize(sessionId, cols, rows));
      }, 1500);
      cleanup.push(() => clearTimeout(resync));

      // the exit marker arrives through the data stream (the session manager
      // appends it to the buffer too, so replays after a fast death show it)
      const input = term.onData(data => {
        const operatorEngaged = operatorInputPending;
        operatorInputPending = false;
        if (operatorInputTimer) clearTimeout(operatorInputTimer);
        operatorInputTimer = null;
        void api.write(sessionId, data, operatorEngaged);
      });
      cleanup.push(() => input.dispose());
      cleanup.push(() => {
        if (operatorInputTimer) clearTimeout(operatorInputTimer);
      });
      const ro = new ResizeObserver(syncSize);
      ro.observe(el);
      cleanup.push(() => ro.disconnect());

      // harness introspection (Playwright asserts on buffer contents)
      if (process.env.NODE_ENV !== 'production') {
        const w = window as unknown as {
          __XTERMS__?: Record<string, unknown>;
        };
        w.__XTERMS__ = { ...w.__XTERMS__, [sessionId]: term };
      }
    })();

    return () => {
      disposed = true;
      dispose();
    };
  }, [cwd, sessionId]);

  useEffect(() => {
    if (!searchOpen || !searchQuery) {
      searchRef.current?.clearDecorations();
      setSearchResult('0/0');
      return;
    }
    const found = searchRef.current?.findNext(searchQuery, {
      incremental: true,
    });
    setSearchResult(found ? 'match' : '0/0');
  }, [searchOpen, searchQuery]);

  const stepSearch = (direction: 'next' | 'previous') => {
    if (!searchQuery) return;
    const search = searchRef.current;
    const found =
      direction === 'next'
        ? search?.findNext(searchQuery)
        : search?.findPrevious(searchQuery);
    setSearchResult(found ? 'match' : '0/0');
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery('');
    searchRef.current?.clearDecorations();
    termRef.current?.focus();
  };

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
      termRef.current?.focus();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', closeOnEscape, true);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (font) termRef.current?.applyFont(font);
  }, [font]);

  // refit when the pane's geometry changes (activation, split/unsplit —
  // it may have been hidden during a container resize); focus follows the
  // ACTIVE tab only, so in a split the driven pane keeps the keyboard
  useEffect(() => {
    if (!termRef.current) return;
    if (layout !== 'hidden') termRef.current.fit();
    if (active) termRef.current.focus();
  }, [active, layout]);

  // rename editors (⌘E, double-click) steal DOM focus; on commit/cancel the
  // keyboard must land back in the active terminal, not on <body>
  useEffect(() => {
    const refocus = () => {
      if (activeRef.current) termRef.current?.focus();
    };
    window.addEventListener(FOCUS_ACTIVE_TERMINAL_EVENT, refocus);
    return () =>
      window.removeEventListener(FOCUS_ACTIVE_TERMINAL_EVENT, refocus);
  }, []);

  return (
    <div
      data-pane={layout}
      className={`terminal-pane ${LAYOUT_CLASS[layout]}`}
      style={
        {
          '--terminal-font-stroke': `${font?.fontStrokeWidth ?? TERMINAL_FONT.fontStrokeWidth}px`,
          ...(layout === 'right'
            ? { borderLeft: '1px solid rgba(80,230,255,0.2)' }
            : {}),
        } as CSSProperties
      }
      onMouseDown={
        onActivate && !active && layout !== 'hidden' ? onActivate : undefined
      }
      onContextMenu={event => {
        event.preventDefault();
        setContextMenu({
          x: Math.min(event.clientX, window.innerWidth - 160),
          y: Math.min(event.clientY, window.innerHeight - 120),
        });
      }}
    >
      <div ref={container} className="absolute inset-0" />
      {searchOpen && (
        <div
          data-terminal-search
          className="absolute right-3 top-3 z-20 flex h-9 items-center border border-white/15 bg-zinc-950 px-2 shadow-lg"
        >
          <input
            ref={searchInput}
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
            onKeyDown={event => {
              event.stopPropagation();
              if (event.key === 'Escape') closeSearch();
              if (event.key === 'Enter') {
                stepSearch(event.shiftKey ? 'previous' : 'next');
              }
            }}
            aria-label="Search terminal scrollback"
            className="h-full w-56 bg-transparent text-sm text-zinc-100 outline-none"
            placeholder="Search"
          />
          <span className="w-12 text-center font-mono text-chrome-micro text-zinc-500">
            {searchResult}
          </span>
          <button
            type="button"
            className="grid h-7 w-7 place-items-center text-zinc-400 hover:text-white"
            aria-label="Previous terminal match"
            title="Previous match"
            onClick={() => stepSearch('previous')}
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="grid h-7 w-7 place-items-center text-zinc-400 hover:text-white"
            aria-label="Next terminal match"
            title="Next match"
            onClick={() => stepSearch('next')}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="grid h-7 w-7 place-items-center text-zinc-400 hover:text-white"
            aria-label="Close terminal search"
            title="Close search"
            onClick={closeSearch}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {contextMenu && (
        <div
          role="menu"
          aria-label="Terminal actions"
          className="fixed z-50 min-w-36 border border-white/15 bg-zinc-950 py-1 text-sm text-zinc-200 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={event => event.stopPropagation()}
        >
          <button
            role="menuitem"
            className="block w-full px-3 py-1.5 text-left hover:bg-white/10"
            onClick={() => {
              termRef.current?.copySelection();
              setContextMenu(null);
            }}
          >
            Copy
          </button>
          <button
            role="menuitem"
            className="block w-full px-3 py-1.5 text-left hover:bg-white/10"
            onClick={() => {
              void window.electron?.pty?.pasteClipboard(sessionId);
              setContextMenu(null);
              termRef.current?.focus();
            }}
          >
            Paste
          </button>
          <button
            role="menuitem"
            className="block w-full px-3 py-1.5 text-left hover:bg-white/10"
            onClick={() => {
              termRef.current?.selectAll();
              setContextMenu(null);
            }}
          >
            Select All
          </button>
        </div>
      )}
    </div>
  );
}

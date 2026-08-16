// No 'use client' directive: only imported by the client workspace surface.

/**
 * One xterm.js pane bound to one PTY session (decision 0005).
 *
 * Lifecycle: mounts once per session and STAYS mounted while the session
 * lives — inactive tabs are hidden with CSS, not unmounted, so no output is
 * lost between tab switches. On (re)mount the main-process scrollback buffer
 * is replayed first, so renderer reloads restore what you saw.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type { ITheme } from '@xterm/xterm';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import { useAppearance } from '@/components/appearance/appearance-provider';
import { FOCUS_ACTIVE_TERMINAL_EVENT } from './session-jump';
import { TERMINAL_FONT } from './terminal-font';
import type { EffectiveTerminalFont } from './terminal-font';
import { createTerminalLinkProvider } from './terminal-link-provider';
import {
  createTerminalSizeSync,
  publishTerminalGeometry,
  terminalInsetVariables,
} from './terminal-geometry';
import {
  terminalTargetCopyText,
  terminalTargetCopyVerb,
  terminalTargetFromUri,
  terminalTargetLabel,
  type TerminalTarget,
} from './terminal-targets';
import { matchTerminalChord } from './terminal-chords';
import {
  XTERM_MINIMUM_CONTRAST_RATIO,
  xtermThemeForAppearance,
} from './terminal-theme';
import { WORKSPACE_HUD } from './workspace-theme';

export { TERMINAL_FONT, resolveTerminalFont } from './terminal-font';
export type { EffectiveTerminalFont } from './terminal-font';

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
  const { resolved } = useAppearance();
  const terminalTheme = useMemo(
    () => xtermThemeForAppearance(resolved),
    [resolved]
  );
  const pane = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState('0/0');
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    target: TerminalTarget | null;
  } | null>(null);
  // A target that could not be opened must SAY so. Silence is what made the
  // original report read as "clicking does nothing" (BUG-004).
  const [notice, setNotice] = useState<string | null>(null);
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
    applyTheme(theme: Readonly<ITheme>): void;
  } | null>(null);
  // the term is created ASYNC (dynamic import) — it must read the CURRENT
  // active state when it finally exists, or the first focus is lost
  const activeRef = useRef(active);
  activeRef.current = active;
  // the initial font resolves before mounting; later settings refreshes
  // update this ref and the live xterm through applyFont below
  const fontRef = useRef(font);
  fontRef.current = font;
  // Theme refresh is orthogonal to xterm/PTY lifecycle. An async constructor
  // reads the latest snapshot; an existing terminal receives it in place.
  const themeRef = useRef(terminalTheme);
  themeRef.current = terminalTheme;
  // hidden panes must NOT resize their PTY: an invisible element keeps
  // full-container geometry, so during a split every hidden session would
  // get SIGWINCHed to the WRONG width on each layout change (TUIs then
  // redraw scrollback at that width). Freeze while hidden; the layout
  // effect refits on reveal.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // ONE act of opening, whatever recognised the target: hovered plain text,
  // an OSC 8 hyperlink an Agent emitted, or the context menu.
  const openTarget = useCallback(
    (target: TerminalTarget) => {
      const api = window.electron?.pty;
      if (!api) return;
      const opened =
        target.kind === 'url'
          ? api.openExternal(target.url)
          : api.openPath(target.path, cwd);
      void opened.catch((error: unknown) => {
        setNotice(
          `Could not open ${terminalTargetLabel(target)} — ${describeOpenFailure(error)}`
        );
      });
    },
    [cwd]
  );
  const openTargetRef = useRef(openTarget);
  openTargetRef.current = openTarget;
  // The target under the pointer, kept current by the SAME link vocabulary
  // that decides what is clickable — this is what lets right-click copy a
  // link instead of offering verbs that know nothing about one.
  const hoveredTarget = useRef<TerminalTarget | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6_000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const el = container.current;
    const paneEl = pane.current;
    const api = window.electron?.pty;
    if (!el || !paneEl || !api) return;
    let disposed = false;
    // resources register the moment they exist (NOT in a batch at the end):
    // the destructor can run between any two awaits, and anything created
    // before it must still be released — splice makes disposal idempotent
    const cleanup: Array<() => void> = [];
    const dispose = () => {
      for (const fn of cleanup.splice(0)) fn();
    };

    (async () => {
      const [{ Terminal }, { FitAddon }, { SearchAddon }, { WebglAddon }] =
        await Promise.all([
          import('@xterm/xterm'),
          import('@xterm/addon-fit'),
          import('@xterm/addon-search'),
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
        theme: themeRef.current,
        minimumContrastRatio: XTERM_MINIMUM_CONTRAST_RATIO,
        // OSC 8 hyperlinks — the form Codex and Claude Code emit — are
        // resolved by xterm's OWN built-in provider, which outranks every
        // registered one. Left unconfigured it falls back to
        // `confirm('Do you want to navigate to …')` + `window.open()`, and
        // Electron's window-open handler denies that window, so the operator
        // approved a navigation that could never happen. Claiming the handler
        // is what deletes that dialog and routes the hyperlink through the
        // same open path as recognised text. `allowNonHttpProtocols` admits
        // `file://` citations, which the built-in filter dropped outright.
        linkHandler: {
          allowNonHttpProtocols: true,
          activate: (_event, uri) => {
            const target = terminalTargetFromUri(uri);
            if (!target) {
              setNotice(`Exawatt does not open ${describeScheme(uri)} links.`);
              return;
            }
            openTargetRef.current(target);
          },
          hover: (_event, uri) => {
            hoveredTarget.current = terminalTargetFromUri(uri);
          },
          leave: () => {
            hoveredTarget.current = null;
          },
        },
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
      term.open(el);
      try {
        const webgl = new WebglAddon();
        term.loadAddon(webgl);
        const contextLoss = webgl.onContextLoss(() => webgl.dispose());
        cleanup.push(() => contextLoss.dispose());
      } catch {
        // Canvas renderer remains active when WebGL is unavailable.
      }
      // ONE provider for recognised text: URLs and local paths come out of
      // the same vocabulary, so priority ordering between competing
      // providers can no longer decide that a line's paths do not exist.
      const links = term.registerLinkProvider(
        createTerminalLinkProvider(term, {
          activate: target => openTargetRef.current(target),
          hover: target => {
            hoveredTarget.current = target;
          },
          leave: () => {
            hoveredTarget.current = null;
          },
        })
      );
      cleanup.push(() => links.dispose());
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
      publishTerminalGeometry(paneEl, term.cols, term.rows);
      // the ONE fit-then-propagate path (pane resize, activation, resync):
      // inset → fit → published geometry → PTY window size, in that order,
      // from one place. Nothing else may resize the PTY (BUG-019).
      const syncSize = createTerminalSizeSync({
        pane: paneEl,
        measure: el,
        term,
        fit: () => fit.fit(),
        resize: (cols, rows) => void api.resize(sessionId, cols, rows),
        frozen: () => layoutRef.current === 'hidden', // frozen while hidden
      });
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
        applyTheme: next => {
          term.options.theme = next;
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
      syncSize();
      if (activeRef.current) term.focus();
      // Late re-sync for TUIs that were mid-init when a resize landed
      // (before their WINCH handler existed). A same-size TIOCSWINSZ emits
      // NO SIGWINCH, so a plain re-resize is a kernel-level no-op — wiggle
      // one row and back to force two real signals. The TRUE size still
      // comes from the one owner; only the extra signal is added here.
      const resync = setTimeout(() => {
        syncSize();
        if (layoutRef.current === 'hidden') return;
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

  // Deliberately no fit/resize here: appearance never changes cell metrics.
  useEffect(() => {
    termRef.current?.applyTheme(terminalTheme);
  }, [terminalTheme]);

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
      ref={pane}
      data-pane={layout}
      className={`terminal-pane ${LAYOUT_CLASS[layout]}`}
      style={
        {
          '--terminal-font-stroke': `${font?.fontStrokeWidth ?? TERMINAL_FONT.fontStrokeWidth}px`,
          ...terminalInsetVariables(),
          // the inset gutter is terminal ground, not app chrome — it carries
          // the same background the cells paint on
          background: terminalTheme.background,
          ...(layout === 'right'
            ? { borderLeft: `1px solid ${WORKSPACE_HUD.strokeSoft}` }
            : {}),
        } as CSSProperties
      }
      onMouseDown={
        onActivate && !active && layout !== 'hidden' ? onActivate : undefined
      }
      onContextMenu={event => {
        event.preventDefault();
        setContextMenu({
          x: Math.min(event.clientX, window.innerWidth - 200),
          y: Math.min(event.clientY, window.innerHeight - 180),
          // snapshot what the pointer is on, so later mouse movement cannot
          // change what the open menu is about
          target: hoveredTarget.current,
        });
      }}
    >
      <div ref={container} className="absolute inset-0" />
      {searchOpen && (
        <div
          data-terminal-search
          className="absolute right-3 top-3 z-20 flex h-9 items-center border px-2 shadow-lg"
          style={{
            color: WORKSPACE_HUD.text,
            background: WORKSPACE_HUD.bg.panel,
            borderColor: WORKSPACE_HUD.strokeSoft,
          }}
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
            className="h-full w-56 bg-transparent text-sm outline-none"
            placeholder="Search"
          />
          <span
            className="w-12 text-center font-mono text-chrome-micro"
            style={{ color: WORKSPACE_HUD.textDim }}
          >
            {searchResult}
          </span>
          <button
            type="button"
            className="grid h-7 w-7 place-items-center text-hud-text-dim hover:text-hud-text"
            aria-label="Previous terminal match"
            title="Previous match"
            onClick={() => stepSearch('previous')}
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="grid h-7 w-7 place-items-center text-hud-text-dim hover:text-hud-text"
            aria-label="Next terminal match"
            title="Next match"
            onClick={() => stepSearch('next')}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="grid h-7 w-7 place-items-center text-hud-text-dim hover:text-hud-text"
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
          className="fixed z-50 min-w-36 border py-1 text-sm shadow-xl"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
            color: WORKSPACE_HUD.text,
            background: WORKSPACE_HUD.bg.panel,
            borderColor: WORKSPACE_HUD.strokeSoft,
          }}
          onPointerDown={event => event.stopPropagation()}
        >
          {contextMenu.target && (
            <>
              <button
                role="menuitem"
                data-terminal-open-target
                className="block w-full truncate px-3 py-1.5 text-left hover:bg-hud-fill-hi"
                onClick={() => {
                  const target = contextMenu.target;
                  setContextMenu(null);
                  if (target) openTarget(target);
                }}
              >
                Open {terminalTargetLabel(contextMenu.target)}
              </button>
              <button
                role="menuitem"
                data-terminal-copy-target
                className="block w-full px-3 py-1.5 text-left hover:bg-hud-fill-hi"
                onClick={() => {
                  const target = contextMenu.target;
                  setContextMenu(null);
                  if (target) {
                    void window.electron?.pty?.copyText(
                      terminalTargetCopyText(target)
                    );
                  }
                }}
              >
                {terminalTargetCopyVerb(contextMenu.target)}
              </button>
              <div
                role="separator"
                className="my-1 border-t"
                style={{ borderColor: WORKSPACE_HUD.strokeSoft }}
              />
            </>
          )}
          <button
            role="menuitem"
            className="block w-full px-3 py-1.5 text-left hover:bg-hud-fill-hi"
            onClick={() => {
              termRef.current?.copySelection();
              setContextMenu(null);
            }}
          >
            Copy
          </button>
          <button
            role="menuitem"
            className="block w-full px-3 py-1.5 text-left hover:bg-hud-fill-hi"
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
            className="block w-full px-3 py-1.5 text-left hover:bg-hud-fill-hi"
            onClick={() => {
              termRef.current?.selectAll();
              setContextMenu(null);
            }}
          >
            Select All
          </button>
        </div>
      )}
      {notice && (
        <div
          data-terminal-notice
          role="status"
          className="absolute bottom-3 left-3 z-20 max-w-md border px-3 py-2 font-sans text-xs"
          style={{
            color: WORKSPACE_HUD.text,
            background: WORKSPACE_HUD.bg.panel,
            borderColor: WORKSPACE_HUD.strokeSoft,
          }}
        >
          {notice}
        </div>
      )}
    </div>
  );
}

/** IPC rejections arrive wrapped in the invoke channel's own prose. */
function describeOpenFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.split('Error: ').pop()?.trim() || raw;
  return message.startsWith('ENOENT')
    ? 'it no longer exists at that location'
    : message;
}

function describeScheme(uri: string): string {
  const scheme = uri.match(/^([A-Za-z][A-Za-z0-9+.-]*):/);
  return scheme ? `${scheme[1]}:` : 'these';
}

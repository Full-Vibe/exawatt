// No 'use client' directive: only imported by the client workspace surface.

/**
 * One xterm.js pane bound to one PTY session (decision 0005).
 *
 * Lifecycle: mounts once per session and STAYS mounted while the session
 * lives — inactive tabs are hidden with CSS, not unmounted, so no output is
 * lost between tab switches. On (re)mount the main-process scrollback buffer
 * is replayed first, so renderer reloads restore what you saw.
 */
import { useEffect, useRef } from 'react';
import '@xterm/xterm/css/xterm.css';
import { FOCUS_ACTIVE_TERMINAL_EVENT } from './session-jump';
import { TERMINAL_FONT } from './terminal-font';
import type { EffectiveTerminalFont } from './terminal-font';

export { TERMINAL_FONT, resolveTerminalFont } from './terminal-font';
export type { EffectiveTerminalFont } from './terminal-font';

const HUD_TERM_THEME = {
  background: '#04060B',
  foreground: '#DCEBFF',
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
  white: '#DCEBFF',
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

const LAYOUT_CLASS: Record<PaneLayout, string> = {
  full: 'absolute inset-0',
  left: 'absolute inset-y-0 left-0 w-1/2',
  right: 'absolute inset-y-0 right-0 w-1/2',
  hidden: 'absolute inset-0 invisible',
};

export function TerminalPane({
  sessionId,
  active,
  layout = 'full',
  font,
  onActivate,
}: {
  sessionId: string;
  active: boolean;
  layout?: PaneLayout;
  /** effective font (defaults + settings); panes render only after the
   *  workspace has resolved it, so it is fixed for the pane's lifetime */
  font?: EffectiveTerminalFont;
  /** clicking into a visible-but-inactive pane makes its tab active */
  onActivate?: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  // latest xterm handle for the activation effect below
  const termRef = useRef<{ focus(): void; fit(): void } | null>(null);
  // the term is created ASYNC (dynamic import) — it must read the CURRENT
  // active state when it finally exists, or the first focus is lost
  const activeRef = useRef(active);
  activeRef.current = active;
  // font is fixed for the pane's lifetime (workspace gates rendering until
  // settings resolve); ref keeps it out of the mount effect's deps
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
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);
      if (disposed) return;

      const f = fontRef.current;
      const term = new Terminal({
        fontFamily: f?.family ?? TERMINAL_FONT.family,
        fontSize: f?.size ?? TERMINAL_FONT.size,
        lineHeight: f?.lineHeight ?? TERMINAL_FONT.lineHeight,
        cursorBlink: true,
        scrollback: 8000,
        theme: HUD_TERM_THEME,
      });
      cleanup.push(() => term.dispose());
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(el);
      fit.fit();
      // the ONE fit-then-propagate path (pane resize, activation, resync)
      const syncSize = () => {
        if (layoutRef.current === 'hidden') return; // frozen while hidden
        if (el.offsetWidth === 0 || el.offsetHeight === 0) return;
        fit.fit();
        void api.resize(sessionId, term.cols, term.rows);
      };
      termRef.current = { focus: () => term.focus(), fit: syncSize };
      cleanup.push(() => {
        termRef.current = null;
      });

      // replay main-process scrollback (renderer reloads, late attach)
      const backlog = await api.buffer(sessionId);
      if (disposed) {
        // unmounted while the buffer fetch was in flight — the destructor
        // already ran; release what was created since
        dispose();
        return;
      }
      if (backlog) term.write(backlog);
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
      const offData = api.onData(({ id, data }) => {
        if (id === sessionId) term.write(data);
      });
      cleanup.push(offData);
      const input = term.onData((data) => {
        void api.write(sessionId, data);
      });
      cleanup.push(() => input.dispose());
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
  }, [sessionId]);

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
      ref={container}
      data-pane={layout}
      className={LAYOUT_CLASS[layout]}
      style={
        layout === 'right'
          ? { borderLeft: '1px solid rgba(80,230,255,0.2)' }
          : undefined
      }
      onMouseDown={
        onActivate && !active && layout !== 'hidden' ? onActivate : undefined
      }
    />
  );
}

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

/** single home for the terminal font config; the workspace client derives
 *  its spawn-size estimate from these same numbers */
export const TERMINAL_FONT = {
  size: 13,
  lineHeight: 1.25,
  /** measured Geist Mono advance at size 13 (estimate; fit refines) */
  cellWidthEstimate: 7.8,
} as const;

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

/** next/font families only exist as CSS vars — resolve to a concrete list
 *  because xterm measures glyphs via canvas and cannot use var() */
function resolveMonoFont(): string {
  if (typeof document !== 'undefined') {
    const v = getComputedStyle(document.body)
      .getPropertyValue('--font-geist-mono')
      .trim();
    if (v) return `${v}, Menlo, monospace`;
  }
  return 'Menlo, Monaco, monospace';
}

export function TerminalPane({
  sessionId,
  active,
}: {
  sessionId: string;
  active: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  // latest xterm handle for the activation effect below
  const termRef = useRef<{ focus(): void; fit(): void } | null>(null);
  // the term is created ASYNC (dynamic import) — it must read the CURRENT
  // active state when it finally exists, or the first focus is lost
  const activeRef = useRef(active);
  activeRef.current = active;

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

      const term = new Terminal({
        fontFamily: resolveMonoFont(),
        fontSize: TERMINAL_FONT.size,
        lineHeight: TERMINAL_FONT.lineHeight,
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
        if (el.offsetWidth === 0 || el.offsetHeight === 0) return; // hidden
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

  // refit + focus when this pane becomes the active tab (it may have been
  // hidden during a container resize)
  useEffect(() => {
    if (active && termRef.current) {
      termRef.current.fit();
      termRef.current.focus();
    }
  }, [active]);

  return (
    <div
      ref={container}
      className={`absolute inset-0 ${active ? '' : 'invisible'}`}
    />
  );
}

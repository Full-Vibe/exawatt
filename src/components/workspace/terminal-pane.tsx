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
    let cleanup: Array<() => void> = [];

    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);
      if (disposed) return;

      const term = new Terminal({
        fontFamily: resolveMonoFont(),
        fontSize: 13,
        lineHeight: 1.25,
        cursorBlink: true,
        scrollback: 8000,
        theme: HUD_TERM_THEME,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(el);
      fit.fit();
      termRef.current = {
        focus: () => term.focus(),
        fit: () => {
          fit.fit();
          void api.resize(sessionId, term.cols, term.rows);
        },
      };

      // replay main-process scrollback (renderer reloads, late attach)
      const backlog = await api.buffer(sessionId);
      if (backlog) term.write(backlog);
      void api.resize(sessionId, term.cols, term.rows);
      if (activeRef.current) term.focus();

      const offData = api.onData(({ id, data }) => {
        if (id === sessionId) term.write(data);
      });
      const offExit = api.onExit(({ id, exitCode }) => {
        if (id === sessionId) {
          term.write(`\r\n\x1b[38;5;244m[session exited ${exitCode}]\x1b[0m\r\n`);
        }
      });
      const input = term.onData((data) => {
        void api.write(sessionId, data);
      });
      const ro = new ResizeObserver(() => {
        // hidden panes have zero size — fitting there corrupts cols/rows
        if (el.offsetWidth > 0 && el.offsetHeight > 0) {
          fit.fit();
          void api.resize(sessionId, term.cols, term.rows);
        }
      });
      ro.observe(el);

      // harness introspection (Playwright asserts on buffer contents)
      if (process.env.NODE_ENV !== 'production') {
        const w = window as unknown as {
          __XTERMS__?: Record<string, unknown>;
        };
        w.__XTERMS__ = { ...w.__XTERMS__, [sessionId]: term };
      }

      cleanup = [
        offData,
        offExit,
        () => input.dispose(),
        () => ro.disconnect(),
        () => term.dispose(),
      ];
    })();

    return () => {
      disposed = true;
      for (const fn of cleanup) fn();
      termRef.current = null;
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

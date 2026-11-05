/**
 * The renderer half of Session liveness (ENG-002, ENG-016; BUG-330): tell main
 * which terminal panes this window shows and how far each has painted.
 *
 * Main knows when each Session's process wrote; only this page knows whether
 * a pane painted it. Each pane reports the highest `pty:data` cursor xterm has
 * RENDERED (not merely parsed), and whether it is shown. All panes of the
 * window travel in one `pty:report-paint` call (`PtyPaintReport`), and main
 * decides what is a stall (`electron/main/pty/session-liveness.ts`).
 *
 * Cheap by construction (ENG-008 E14): a report goes out at most every
 * `intervalMs` while some shown pane paints new output, plus one at once when
 * a pane is shown, hidden or closed or the page changes visibility. No timer
 * exists while nothing paints, and a hidden page paints nothing, so it sends
 * one report saying so and then nothing.
 */
import type { PtyPaintReport } from '@exawatt/core/desktop-bridge';

/** The most often a painting window reports. Well inside main's bound. */
export const PAINT_REPORT_INTERVAL_MS = 2_000;

export interface PaneLiveness {
  /** xterm rendered everything up to this output cursor. */
  painted(cursor: number): void;
  /** The pane is laid out on screen (not the hidden layout). */
  shown(shown: boolean): void;
  dispose(): void;
}

export interface PaintReporterDependencies {
  send(report: PtyPaintReport): void;
  documentVisible(): boolean;
  onVisibilityChange(listener: () => void): () => void;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  intervalMs?: number;
}

interface Registration {
  id: string;
  painted: number | null;
  shown: boolean;
}

export function createPaintReporter(deps: PaintReporterDependencies): {
  register(id: string): PaneLiveness;
} {
  const intervalMs = deps.intervalMs ?? PAINT_REPORT_INTERVAL_MS;
  const registrations = new Set<Registration>();
  let timer: unknown = null;
  let timerIsImmediate = false;
  let offVisibility: (() => void) | null = null;

  const flush = () => {
    timer = null;
    const visible = deps.documentVisible();
    const panes: PtyPaintReport['panes'] = [];
    if (visible) {
      for (const registration of registrations) {
        if (!registration.shown || registration.painted === null) continue;
        panes.push({ id: registration.id, painted: registration.painted });
      }
    }
    deps.send({ visible, panes });
  };

  const schedule = (immediate: boolean) => {
    if (timer !== null) {
      if (!immediate || timerIsImmediate) return;
      deps.clearTimer(timer);
    }
    timerIsImmediate = immediate;
    timer = deps.setTimer(flush, immediate ? 0 : intervalMs);
  };

  return {
    register(id) {
      const registration: Registration = { id, painted: null, shown: false };
      registrations.add(registration);
      offVisibility ??= deps.onVisibilityChange(() => schedule(true));
      return {
        painted(cursor) {
          if (registration.painted !== null && cursor <= registration.painted)
            return;
          const first = registration.painted === null;
          registration.painted = cursor;
          // a pane's first paint makes it reportable at all; later ones are
          // progress, which main needs only every few seconds
          // (a hidden page already said so, and owes nothing more)
          if (registration.shown && deps.documentVisible()) schedule(first);
        },
        shown(shown) {
          if (registration.shown === shown) return;
          registration.shown = shown;
          if (registration.painted !== null) schedule(true);
        },
        dispose() {
          if (!registrations.delete(registration)) return;
          if (registration.shown && registration.painted !== null)
            schedule(true);
          if (registrations.size === 0) {
            offVisibility?.();
            offVisibility = null;
          }
        },
      };
    },
  };
}

let windowReporter: ReturnType<typeof createPaintReporter> | null = null;

/** This window's reporter, bound to the desktop bridge. */
export function paneLiveness(): ReturnType<typeof createPaintReporter> {
  windowReporter ??= createPaintReporter({
    send: report => {
      // A report that fails to arrive leaves main's last one standing, which
      // reads as "not painting": the honest answer when this page cannot
      // reach main. Nothing here retries or pretends otherwise.
      void window.electron?.pty?.reportPaint(report).catch(() => {});
    },
    documentVisible: () => document.visibilityState === 'visible',
    onVisibilityChange: listener => {
      document.addEventListener('visibilitychange', listener);
      return () => document.removeEventListener('visibilitychange', listener);
    },
    setTimer: (run, ms) => setTimeout(run, ms),
    clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  });
  return windowReporter;
}

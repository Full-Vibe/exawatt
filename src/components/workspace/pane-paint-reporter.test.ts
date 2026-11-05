import { describe, expect, it } from 'vitest';
import type { PtyPaintReport } from '@exawatt/core/desktop-bridge';
import {
  createPaintReporter,
  PAINT_REPORT_INTERVAL_MS,
} from './pane-paint-reporter';

/** A manual clock: timers run only when the test advances time. */
function reporter() {
  let clock = 0;
  let visible = true;
  let visibilityListener: (() => void) | null = null;
  const timers = new Map<number, { at: number; run: () => void }>();
  let nextTimer = 1;
  const sent: PtyPaintReport[] = [];
  const paint = createPaintReporter({
    send: report => sent.push(structuredClone(report)),
    documentVisible: () => visible,
    onVisibilityChange: listener => {
      visibilityListener = listener;
      return () => {
        visibilityListener = null;
      };
    },
    setTimer: (run, ms) => {
      const id = nextTimer++;
      timers.set(id, { at: clock + ms, run });
      return id;
    },
    clearTimer: handle => {
      timers.delete(handle as number);
    },
  });
  const advance = (ms: number) => {
    const until = clock + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= until)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      clock = due[1].at;
      due[1].run();
    }
    clock = until;
  };
  return {
    paint,
    sent,
    advance,
    pendingTimers: () => timers.size,
    hasVisibilityListener: () => visibilityListener !== null,
    setVisible(next: boolean) {
      visible = next;
      visibilityListener?.();
    },
  };
}

describe('the pane paint reporter', () => {
  it('reports a shown pane at its first paint, then at most once an interval', () => {
    const r = reporter();
    const pane = r.paint.register('pty-1');
    pane.shown(true);
    expect(r.sent).toEqual([]);
    pane.painted(100);
    r.advance(0);
    expect(r.sent).toEqual([
      { visible: true, panes: [{ id: 'pty-1', painted: 100 }] },
    ]);
    for (let i = 1; i <= 60; i += 1) {
      pane.painted(100 + i);
      r.advance(100);
    }
    // six seconds of paints at ten a second: three reports, not sixty
    expect(r.sent).toHaveLength(1 + 6_000 / PAINT_REPORT_INTERVAL_MS);
    expect(r.sent.at(-1)).toEqual({
      visible: true,
      panes: [{ id: 'pty-1', painted: 160 }],
    });
  });

  it('keeps no timer while nothing paints', () => {
    const r = reporter();
    const pane = r.paint.register('pty-1');
    pane.shown(true);
    pane.painted(100);
    r.advance(PAINT_REPORT_INTERVAL_MS);
    const settled = r.sent.length;
    // repeated renders of the same output (cursor blink, selection) are not progress
    pane.painted(100);
    pane.painted(90);
    expect(r.pendingTimers()).toBe(0);
    r.advance(60_000);
    expect(r.sent).toHaveLength(settled);
  });

  it('lists only shown panes, and says at once when one is hidden or closed', () => {
    const r = reporter();
    const a = r.paint.register('pty-1');
    const b = r.paint.register('pty-2');
    a.shown(true);
    b.shown(false);
    a.painted(10);
    b.painted(20);
    r.advance(0);
    expect(r.sent.at(-1)).toEqual({
      visible: true,
      panes: [{ id: 'pty-1', painted: 10 }],
    });
    b.shown(true);
    r.advance(0);
    expect(r.sent.at(-1)?.panes).toEqual([
      { id: 'pty-1', painted: 10 },
      { id: 'pty-2', painted: 20 },
    ]);
    a.dispose();
    r.advance(0);
    expect(r.sent.at(-1)?.panes).toEqual([{ id: 'pty-2', painted: 20 }]);
  });

  it('a hidden page says so once and then owes nothing', () => {
    const r = reporter();
    const pane = r.paint.register('pty-1');
    pane.shown(true);
    pane.painted(10);
    r.advance(0);
    r.setVisible(false);
    r.advance(0);
    expect(r.sent.at(-1)).toEqual({ visible: false, panes: [] });
    const count = r.sent.length;
    pane.painted(20); // a scrolled-back pane still parses
    r.advance(60_000);
    expect(r.sent).toHaveLength(count);
    r.setVisible(true);
    r.advance(0);
    expect(r.sent.at(-1)).toEqual({
      visible: true,
      panes: [{ id: 'pty-1', painted: 20 }],
    });
  });

  it('lets go of the page once its last pane is gone', () => {
    const r = reporter();
    const pane = r.paint.register('pty-1');
    expect(r.hasVisibilityListener()).toBe(true);
    pane.dispose();
    expect(r.hasVisibilityListener()).toBe(false);
    pane.dispose();
    expect(r.hasVisibilityListener()).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  createSessionLiveness,
  DELIVERY_GAP_MS,
  PAINT_STALL_MS,
  type SessionLivenessOptions,
} from './session-liveness';

type Line = { event: string; fields: Record<string, unknown> };

function harness(overrides: Partial<SessionLivenessOptions> = {}) {
  let clock = 1_000_000;
  const lines: Line[] = [];
  const liveness = createSessionLiveness({
    record: (event, fields = {}) => lines.push({ event, fields }),
    session: id =>
      id === 'pty-1'
        ? {
            durableSessionId: 'session-a',
            harness: 'claude',
            harnessSessionId: 'conv-1',
          }
        : undefined,
    windowFacts: () => ({ shown: true, focused: false }),
    now: () => clock,
    ...overrides,
  });
  let cursor = 0;
  return {
    liveness,
    lines,
    stalls: () => lines.filter(line => line.event === 'liveness.stall'),
    cleared: () =>
      lines.filter(line => line.event === 'liveness.stall-cleared'),
    advance(ms: number) {
      clock += ms;
    },
    /** The harness writes one redraw of its working line. */
    write(id = 'pty-1', bytes = 64) {
      cursor += bytes;
      liveness.output(id, cursor);
      return cursor;
    },
    get cursor() {
      return cursor;
    },
    /** A Claude Code working counter: one redraw a second for `seconds`. */
    workFor(seconds: number, id = 'pty-1') {
      for (let i = 0; i < seconds; i += 1) {
        clock += 1_000;
        cursor += 64;
        liveness.output(id, cursor);
      }
    },
  };
}

describe('session liveness: the pane side', () => {
  it('stays silent while a shown pane keeps painting what main delivers', () => {
    const t = harness();
    t.write();
    t.liveness.report(7, {
      visible: true,
      panes: [{ id: 'pty-1', painted: t.cursor }],
    });
    for (let i = 0; i < 60; i += 1) {
      t.workFor(2);
      // the renderer's report trails delivery by a chunk, as the real one does
      t.liveness.report(7, {
        visible: true,
        panes: [{ id: 'pty-1', painted: t.cursor - 64 }],
      });
    }
    expect(t.stalls()).toEqual([]);
  });

  it('names the pane when delivery continues and nothing is painted', () => {
    const t = harness();
    t.write();
    t.liveness.report(7, {
      visible: true,
      panes: [{ id: 'pty-1', painted: t.cursor }],
    });
    const paintedAt = t.cursor;
    t.workFor(PAINT_STALL_MS / 1000 + 1);
    expect(t.stalls()).toEqual([
      {
        event: 'liveness.stall',
        fields: {
          durableSessionId: 'session-a',
          ptyId: 'pty-1',
          harness: 'claude',
          harnessSessionId: 'conv-1',
          side: 'pane',
          unpaintedMs: PAINT_STALL_MS,
          unpaintedChars: t.cursor - paintedAt,
          windowId: 7,
          windowShown: true,
          windowFocused: false,
        },
      },
    ]);
    // one record per episode, however long it lasts
    t.workFor(60);
    expect(t.stalls()).toHaveLength(1);

    t.liveness.report(7, {
      visible: true,
      panes: [{ id: 'pty-1', painted: t.cursor }],
    });
    expect(t.cleared()).toEqual([
      {
        event: 'liveness.stall-cleared',
        fields: expect.objectContaining({
          side: 'pane',
          cause: 'painted',
          stalledMs: (PAINT_STALL_MS / 1000 + 1 + 60) * 1000 - 1000,
          windowId: 7,
        }),
      },
    ]);
  });

  it('reads a renderer that stops reporting at all as a pane that stopped painting', () => {
    const t = harness();
    t.write();
    t.liveness.report(7, {
      visible: true,
      panes: [{ id: 'pty-1', painted: t.cursor }],
    });
    // no report ever again: the page froze
    t.workFor(30);
    expect(t.stalls().map(line => line.fields.side)).toEqual(['pane']);
  });

  it('counts slow progress as painting, not as a stop', () => {
    const t = harness();
    t.write();
    t.liveness.report(7, {
      visible: true,
      panes: [{ id: 'pty-1', painted: t.cursor }],
    });
    let painted = t.cursor;
    for (let i = 0; i < 30; i += 1) {
      t.workFor(2);
      painted += 32; // half the delivery rate, but moving
      t.liveness.report(7, {
        visible: true,
        panes: [{ id: 'pty-1', painted }],
      });
    }
    expect(t.stalls()).toEqual([]);
  });

  it('owes nothing to a hidden page or a hidden pane', () => {
    const t = harness();
    t.write();
    t.liveness.report(7, { visible: false, panes: [] });
    t.workFor(60);
    t.liveness.report(7, { visible: true, panes: [] });
    t.workFor(60);
    expect(t.stalls()).toEqual([]);
  });

  it('closes an open pane stall when the page is hidden', () => {
    const t = harness();
    t.write();
    t.liveness.report(7, {
      visible: true,
      panes: [{ id: 'pty-1', painted: t.cursor }],
    });
    t.workFor(20);
    t.liveness.report(7, { visible: false, panes: [] });
    expect(t.cleared().map(line => line.fields.cause)).toEqual(['page-hidden']);
    t.workFor(60);
    expect(t.stalls()).toHaveLength(1);
  });

  it('judges unpainted output from after a delivery gap, not across it', () => {
    // A machine that slept, or a main thread that was blocked, delivers
    // nothing for a while; the pane had no output to paint in between.
    const t = harness();
    t.write();
    t.liveness.report(7, {
      visible: true,
      panes: [{ id: 'pty-1', painted: t.cursor }],
    });
    t.write();
    t.advance(10 * 60_000);
    t.workFor(PAINT_STALL_MS / 1000 - 2);
    t.liveness.report(7, {
      visible: true,
      panes: [{ id: 'pty-1', painted: t.cursor }],
    });
    expect(t.stalls()).toEqual([]);
    expect(DELIVERY_GAP_MS).toBeLessThan(PAINT_STALL_MS);
  });

  it('does not convict a pane for a final burst that changed nothing on screen', () => {
    // xterm renders only rows a write dirtied; a closing title update can
    // leave the last cursor unpainted with nothing more coming.
    const t = harness();
    t.write();
    t.liveness.report(7, {
      visible: true,
      panes: [{ id: 'pty-1', painted: t.cursor }],
    });
    t.write();
    t.advance(10 * 60_000);
    expect(t.stalls()).toEqual([]);
  });

  it('clears and stops watching when the renderer goes away', () => {
    const t = harness();
    t.write();
    t.liveness.report(7, {
      visible: true,
      panes: [{ id: 'pty-1', painted: t.cursor }],
    });
    t.workFor(20);
    t.liveness.windowGone(7, 'renderer-gone');
    expect(t.cleared().map(line => line.fields.cause)).toEqual([
      'renderer-gone',
    ]);
    expect(
      t.lines
        .filter(line => line.event === 'liveness.paint-reporting')
        .map(line => line.fields)
    ).toEqual([
      { windowId: 7, state: 'started' },
      { windowId: 7, state: 'stopped', reason: 'renderer-gone' },
    ]);
    t.workFor(60);
    expect(t.stalls()).toHaveLength(1);
  });

  it('answers for the pane further behind when two panes show one Session', () => {
    const t = harness();
    t.write();
    const start = t.cursor;
    t.liveness.report(7, {
      visible: true,
      panes: [
        { id: 'pty-1', painted: start },
        { id: 'pty-1', painted: start },
      ],
    });
    for (let i = 0; i < 10; i += 1) {
      t.workFor(2);
      t.liveness.report(7, {
        visible: true,
        panes: [
          { id: 'pty-1', painted: t.cursor },
          { id: 'pty-1', painted: start },
        ],
      });
    }
    expect(t.stalls().map(line => line.fields.side)).toEqual(['pane']);
  });
});

describe('session liveness: the harness side', () => {
  it('names the harness when a reported turn goes silent, and how long it lasted', () => {
    const t = harness();
    t.workFor(5);
    const lastOutput = t.cursor;
    t.advance(12_000);
    t.liveness.turnStale('pty-1', { quietMs: 12_000, children: 0 });
    expect(t.stalls()).toEqual([
      {
        event: 'liveness.stall',
        fields: {
          durableSessionId: 'session-a',
          ptyId: 'pty-1',
          harness: 'claude',
          harnessSessionId: 'conv-1',
          side: 'harness',
          silentMs: 12_000,
          childCount: 0,
          inputBeforeSilence: false,
          inputDuringSilence: false,
        },
      },
    ]);
    // the same silence reported twice is still one episode
    t.liveness.turnStale('pty-1', { quietMs: 13_000, children: 0 });
    expect(t.stalls()).toHaveLength(1);

    t.advance(68_000);
    t.write();
    expect(t.cursor).toBeGreaterThan(lastOutput);
    expect(t.cleared()).toEqual([
      {
        event: 'liveness.stall-cleared',
        fields: expect.objectContaining({
          side: 'harness',
          cause: 'output',
          stalledMs: 80_000,
        }),
      },
    ]);
  });

  it('says when the operator typed just before the silence (an Escape ends a turn too)', () => {
    const t = harness();
    t.workFor(3);
    t.liveness.input('pty-1');
    t.advance(200);
    t.write(); // "Interrupted", then nothing
    t.advance(12_000);
    t.liveness.turnStale('pty-1', { quietMs: 12_000, children: 0 });
    expect(t.stalls()[0].fields).toMatchObject({
      inputBeforeSilence: true,
      inputDuringSilence: false,
    });
  });

  it('says when the operator typed into the silence and nothing echoed', () => {
    const t = harness();
    t.workFor(3);
    t.advance(5_000);
    t.liveness.input('pty-1');
    t.advance(7_000);
    t.liveness.turnStale('pty-1', { quietMs: 12_000, children: 0 });
    expect(t.stalls()[0].fields).toMatchObject({
      inputBeforeSilence: false,
      inputDuringSilence: true,
    });
  });

  it('closes a harness stall when the process exits', () => {
    const t = harness();
    t.workFor(3);
    t.advance(12_000);
    t.liveness.turnStale('pty-1', { quietMs: 12_000, children: 0 });
    t.advance(3_000);
    t.liveness.ended('pty-1');
    expect(t.cleared()[0].fields).toMatchObject({
      side: 'harness',
      cause: 'exited',
      stalledMs: 15_000,
    });
  });
});

describe('session liveness: idle Sessions and failures', () => {
  it('writes nothing for an idle Session that produces nothing', () => {
    const t = harness();
    t.write();
    t.liveness.report(7, {
      visible: true,
      panes: [{ id: 'pty-1', painted: t.cursor }],
    });
    t.advance(24 * 60 * 60_000);
    t.liveness.report(7, {
      visible: true,
      panes: [{ id: 'pty-1', painted: t.cursor }],
    });
    expect(t.stalls()).toEqual([]);
    expect(t.cleared()).toEqual([]);
  });

  it('owes nothing to a pane whose Session has written nothing in this run', () => {
    const t = harness();
    t.liveness.report(7, {
      visible: true,
      panes: [{ id: 'pty-9', painted: 0 }],
    });
    t.advance(60_000);
    expect(t.stalls()).toEqual([]);
  });

  it('records one failure and switches itself off instead of reaching the output path', () => {
    let calls = 0;
    const t = harness({
      session: () => {
        calls += 1;
        throw new TypeError('boom');
      },
    });
    t.workFor(3);
    t.advance(12_000);
    expect(() =>
      t.liveness.turnStale('pty-1', { quietMs: 12_000, children: 0 })
    ).not.toThrow();
    expect(() => t.workFor(5)).not.toThrow();
    expect(t.lines).toEqual([
      {
        event: 'liveness.failed',
        fields: { where: 'turn-stale', error: 'TypeError' },
      },
    ]);
    expect(calls).toBe(1);
  });
});

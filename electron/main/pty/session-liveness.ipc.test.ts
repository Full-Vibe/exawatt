/**
 * Session liveness through the IPC boundary as it really is: the renderer's
 * report leaves through preload's `reportPaint`, crosses `ipcRenderer.invoke`
 * as a structured clone on a later task, is read by the channel's argument
 * boundary and lands in the handler `pty-ipc.ts` registers. Main's side hears
 * the Session owner's `data`/`exit` events and the attention monitor's
 * `reported-turn-stale`, and a reporting window is a `webContents` that can
 * crash or be destroyed. Nothing here can do what the real boundary cannot.
 */
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { DesktopBridge } from '@exawatt/core/desktop-bridge';

const ORIGIN = 'http://127.0.0.1:43123';

const boundary = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  exposed: null as unknown,
  sender: null as unknown,
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: unknown, ...args: unknown[]) => unknown
    ) => boundary.handlers.set(channel, handler),
  },
  contextBridge: {
    exposeInMainWorld: (_name: string, api: unknown) => {
      boundary.exposed = api;
    },
  },
  ipcRenderer: {
    // One invoke: arguments cloned, delivered on a later task, the answer
    // cloned back. A rejection crosses as an Error, as Electron's does.
    invoke: (channel: string, ...args: unknown[]) =>
      new Promise((resolve, reject) => {
        const cloned = structuredClone(args);
        setTimeout(() => {
          const handler = boundary.handlers.get(channel);
          if (!handler) {
            reject(new Error(`No handler registered for '${channel}'`));
            return;
          }
          Promise.resolve()
            .then(() =>
              handler(
                {
                  sender: boundary.sender,
                  senderFrame: { url: `${ORIGIN}/workspace` },
                },
                ...cloned
              )
            )
            .then(value => resolve(structuredClone(value)))
            .catch((error: unknown) =>
              reject(
                new Error(
                  `Error invoking remote method '${channel}': ${String(error)}`
                )
              )
            );
        }, 0);
      }),
    sendSync: () => ({}),
    on: () => undefined,
    removeListener: () => undefined,
  },
}));

const { handleBounded } = await import('../ipc-arguments');
const { setTrustedRendererOrigin } = await import('../ipc-security');
const { attachSessionLiveness, PAINT_STALL_MS } =
  await import('./session-liveness');
await import('../preload');
const bridge = boundary.exposed as DesktopBridge;

/** A `webContents`: an id and the lifecycle events Electron emits. */
class FakeSender extends EventEmitter {
  constructor(readonly id: number) {
    super();
  }
}

function scenario() {
  setTrustedRendererOrigin(ORIGIN);
  let clock = 5_000_000;
  const lines: Array<{ event: string; fields: Record<string, unknown> }> = [];
  const sessions = Object.assign(new EventEmitter(), {
    list: () => [
      {
        id: 'pty-1',
        durableSessionId: 'session-a',
        harness: 'claude',
        harnessSessionId: 'conv-1',
      },
    ],
  });
  const attention = new EventEmitter();
  const liveness = attachSessionLiveness({
    record: (event, fields = {}) => lines.push({ event, fields }),
    sessions,
    attention,
    now: () => clock,
  });
  // the registration `pty-ipc.ts` makes, through the same bounded door
  boundary.handlers.delete('pty:report-paint');
  handleBounded('pty:report-paint', (event, report) =>
    liveness.report(event.sender, report)
  );
  const sender = new FakeSender(7);
  boundary.sender = sender;
  let cursor = 0;
  return {
    lines,
    sender,
    sessions,
    attention,
    tick(ms: number) {
      clock += ms;
    },
    write() {
      cursor += 80;
      sessions.emit('data', 'pty-1', 'redraw', cursor);
      return cursor;
    },
    workFor(seconds: number) {
      for (let i = 0; i < seconds; i += 1) {
        clock += 1_000;
        cursor += 80;
        sessions.emit('data', 'pty-1', 'redraw', cursor);
      }
    },
    get cursor() {
      return cursor;
    },
    events: (name: string) => lines.filter(line => line.event === name),
  };
}

describe('session liveness over the real IPC shape', () => {
  it('names the pane from reports that crossed preload and the boundary', async () => {
    const s = scenario();
    s.write();
    await bridge.pty.reportPaint({
      visible: true,
      panes: [{ id: 'pty-1', painted: s.cursor }],
    });
    s.workFor(PAINT_STALL_MS / 1000 + 2);
    expect(s.events('liveness.stall').map(line => line.fields)).toEqual([
      expect.objectContaining({
        durableSessionId: 'session-a',
        side: 'pane',
        windowId: 7,
      }),
    ]);

    // An unreadable report is refused at the boundary: it can neither clear
    // the stall nor read as "caught up".
    await expect(
      bridge.pty.reportPaint({
        visible: true,
        panes: [{ id: 'pty-1', painted: -1 }],
      })
    ).rejects.toThrow('Invalid paint report');
    expect(s.events('liveness.stall-cleared')).toEqual([]);

    await bridge.pty.reportPaint({
      visible: true,
      panes: [{ id: 'pty-1', painted: s.cursor }],
    });
    expect(s.events('liveness.stall-cleared').map(line => line.fields)).toEqual(
      [expect.objectContaining({ side: 'pane', cause: 'painted' })]
    );
  });

  it('closes the pane watch when the reporting renderer crashes', async () => {
    const s = scenario();
    s.write();
    await bridge.pty.reportPaint({
      visible: true,
      panes: [{ id: 'pty-1', painted: s.cursor }],
    });
    s.workFor(PAINT_STALL_MS / 1000 + 2);
    s.sender.emit('render-process-gone');
    expect(s.events('liveness.stall-cleared').map(line => line.fields)).toEqual(
      [expect.objectContaining({ side: 'pane', cause: 'renderer-gone' })]
    );
    s.workFor(60);
    expect(s.events('liveness.stall')).toHaveLength(1);
    expect(
      s.events('liveness.paint-reporting').map(line => line.fields.state)
    ).toEqual(['started', 'stopped']);
  });

  it('names the harness from the attention monitor’s stale turn, and its recovery from output', async () => {
    const s = scenario();
    s.workFor(3);
    await bridge.pty.reportPaint({
      visible: true,
      panes: [{ id: 'pty-1', painted: s.cursor }],
    });
    s.tick(12_000);
    s.attention.emit('reported-turn-stale', 'pty-1', {
      quietMs: 12_000,
      staleMs: 12_000,
      ownTurn: 'generating',
      children: 0,
    });
    s.tick(48_000);
    s.write();
    expect(s.events('liveness.stall').map(line => line.fields)).toEqual([
      expect.objectContaining({ side: 'harness', silentMs: 12_000 }),
    ]);
    expect(s.events('liveness.stall-cleared').map(line => line.fields)).toEqual(
      [
        expect.objectContaining({
          side: 'harness',
          cause: 'output',
          stalledMs: 60_000,
        }),
      ]
    );
    // the pane painted everything the harness wrote: no pane stall
    expect(
      s.events('liveness.stall').filter(line => line.fields.side === 'pane')
    ).toEqual([]);
  });
});

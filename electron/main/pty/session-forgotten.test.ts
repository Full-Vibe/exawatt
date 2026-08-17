import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * BUG-025 — the Session-forgotten contract, proven on the REAL manager.
 *
 * `node-pty` is a native binding built for Electron's ABI, so it cannot load
 * under plain Node. Nothing here needs a real process: the subject is the
 * lifecycle boundary, not the terminal.
 */
const spawned: FakePty[] = [];
const spawnEnvironments: Array<Record<string, string>> = [];

class FakePty {
  pid = 4242;
  private dataHandlers: Array<(data: string) => void> = [];
  private exitHandlers: Array<(event: { exitCode: number }) => void> = [];
  onData(handler: (data: string) => void): { dispose(): void } {
    this.dataHandlers.push(handler);
    return { dispose() {} };
  }
  emit(data: string): void {
    for (const handler of this.dataHandlers) handler(data);
  }
  onExit(handler: (event: { exitCode: number }) => void): {
    dispose(): void;
  } {
    this.exitHandlers.push(handler);
    return { dispose() {} };
  }
  write(_data: string): void {}
  resize(_cols: number, _rows: number): void {}
  kill(_signal?: string): void {
    for (const handler of this.exitHandlers) handler({ exitCode: 0 });
  }
}

vi.mock('node-pty', () => ({
  spawn: (
    _shell: string,
    _args: string[],
    options: { env: Record<string, string> }
  ) => {
    const proc = new FakePty();
    spawned.push(proc);
    spawnEnvironments.push(options.env);
    return proc;
  },
}));

vi.mock('./process-groups', () => ({
  stopProcessGroups: async (
    pids: number[],
    kill: (pid: number, signal: string) => void
  ) => {
    for (const pid of pids) kill(pid, 'SIGKILL');
  },
}));

const { PtySessionManager } = await import('./session-manager');
const { ContextSummarizer } = await import('./context-summarizer');

let cwd: string;

beforeEach(() => {
  spawned.length = 0;
  spawnEnvironments.length = 0;
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'exawatt-forget-'));
});

afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

function forgotten(manager: InstanceType<typeof PtySessionManager>): string[] {
  const ids: string[] = [];
  manager.on('session-forgotten', (durableSessionId: string) =>
    ids.push(durableSessionId)
  );
  return ids;
}

describe('PtySessionManager announces a forgotten Session', () => {
  it('identifies the resolved distribution to child terminals', async () => {
    const manager = new PtySessionManager();
    manager.setProductName('Acme Agent Console');
    const session = await manager.create({
      harness: 'shell',
      cwd,
      durableSessionId: 'session-distribution-name',
    });
    expect(spawnEnvironments[0].TERM_PROGRAM).toBe('Acme Agent Console');
    await manager.kill(session.id);
  });

  it('announces a close or archive even when this process never ran its PTY', () => {
    // A rehydrated tab: main holds its restored label and goal visual, and no
    // runtime record at all. This is the case the old `if (!found) return;`
    // silently skipped, so the restored 265 KB JPEG was never freed.
    const manager = new PtySessionManager();
    const ids = forgotten(manager);
    manager.forgetExited('session-never-launched');
    expect(ids).toEqual(['session-never-launched']);
  });

  it('announces the ledger reap that deletes the Session from disk', async () => {
    const manager = new PtySessionManager();
    const ids = forgotten(manager);
    await manager.purgeHistory('session-reaped');
    expect(ids).toEqual(['session-reaped']);
  });

  it('announces an outright delete of a Session with no runtime record', async () => {
    const manager = new PtySessionManager();
    const ids = forgotten(manager);
    await manager.deleteSession('session-deleted');
    expect(ids).toEqual(['session-deleted']);
  });

  it('never announces a Session whose process is still running', async () => {
    const manager = new PtySessionManager();
    const session = await manager.create({
      harness: 'shell',
      cwd,
      durableSessionId: 'session-live',
    });
    const ids = forgotten(manager);
    manager.forgetExited('session-live');
    await manager.purgeHistory('session-live');
    expect(ids).toEqual([]);
    expect(manager.list().map(item => item.id)).toContain(session.id);
    await manager.kill(session.id);
  });

  it('announces a kill exactly once, after the runtime record is gone', async () => {
    const manager = new PtySessionManager();
    const session = await manager.create({
      harness: 'shell',
      cwd,
      durableSessionId: 'session-killed',
    });
    const ids = forgotten(manager);
    await manager.kill(session.id);
    expect(ids).toEqual(['session-killed']);
    expect(manager.list()).toEqual([]);
  });
});

describe('closing a Session frees its main-process context', () => {
  it('releases the goal visual a closed Session was holding', async () => {
    const manager = new PtySessionManager();
    const summarizer = new ContextSummarizer({
      generateLabel: async () => ({
        label: 'Improve agent context summaries',
        relationship: 'new_context' as const,
        confidence: 1,
      }),
      generateGoalVisual: async () => ({
        identityKey: 'goal-identity',
        dataUrl: `data:image/jpeg;base64,${'YWJj'.repeat(64)}`,
      }),
    });
    summarizer.attach(manager);
    summarizer.setAccessToken('jwt');
    const session = await manager.create({
      harness: 'shell',
      cwd,
      durableSessionId: 'session-closed',
      initialPrompt: 'Implement reopen closed tab',
    });
    summarizer.seedFromTask(session.durableSessionId, 'Implement reopen tab');
    await vi.waitFor(() =>
      expect(summarizer.getGoalVisual('session-closed')?.state).toBe('ready')
    );

    // The operator's close: stop, then forget the runtime record (D23). Disk
    // history is deliberately untouched — the ledger still owns it.
    await manager.stop(session.id);
    manager.forgetExited('session-closed');

    expect(summarizer.getSummary('session-closed')).toBeNull();
    expect(summarizer.getGoalVisual('session-closed')).toBeNull();
  });

  it('frees memory without deleting the Session a day earlier than before', async () => {
    // The operator's data must not move. Closing and archiving stay soft
    // deletes: retained history survives, so the Session stays resumable and
    // the 14-day ledger reap remains the app's only destroyer of Session data.
    const store = fs.mkdtempSync(path.join(os.tmpdir(), 'exawatt-history-'));
    try {
      const manager = new PtySessionManager();
      await manager.configurePersistence(path.join(store, 'sessions'));
      const session = await manager.create({
        harness: 'shell',
        cwd,
        durableSessionId: 'session-parked',
      });
      spawned.at(-1)?.emit('work the operator will want back\r\n');
      await manager.stop(session.id);
      await manager.flushHistory();

      manager.forgetExited('session-parked');
      const afterClose = await manager.retainedHistory('session-parked');
      expect(afterClose.text).toContain('work the operator will want back');

      // Only the reap destroys it.
      await manager.purgeHistory('session-parked');
      const afterReap = await manager.retainedHistory('session-parked');
      expect(afterReap.text).toBe('');
    } finally {
      fs.rmSync(store, { recursive: true, force: true });
    }
  });
});

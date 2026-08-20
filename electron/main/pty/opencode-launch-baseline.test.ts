import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression for the reported bug: launching OpenCode with a composer prompt
 * threw "OpenCode launch requires an exact pre-turn session snapshot: ..."
 * and aborted the whole launch (no PTY, no Session) whenever the pre-spawn
 * `opencode session list --format json` read failed - e.g. non-JSON stdout.
 * The same failure, hit moments later by `beginOpencodeIdentityCapture`, was
 * already tolerated there without losing the Session. The fix makes the
 * pre-spawn read tolerate it the same way instead of hard-failing `create()`.
 */
const spawned: FakePty[] = [];

class FakePty {
  pid = 4242;
  private dataHandlers: Array<(data: string) => void> = [];
  private exitHandlers: Array<(event: { exitCode: number }) => void> = [];
  onData(handler: (data: string) => void): { dispose(): void } {
    this.dataHandlers.push(handler);
    return { dispose() {} };
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
  spawn: () => {
    const proc = new FakePty();
    spawned.push(proc);
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

vi.mock('./resume-candidates', () => ({
  listResumeCandidates: vi.fn(async (harness: string) => {
    if (harness === 'opencode') {
      throw new Error('OpenCode session catalog returned invalid JSON');
    }
    return [];
  }),
  invalidateResumeCandidates: vi.fn(),
  reconcileResumeIdentities: vi.fn(async () => []),
  opencodeSessionAgent: vi.fn(async () => null),
}));

const { PtySessionManager } = await import('./session-manager');

let cwd: string;

beforeEach(() => {
  spawned.length = 0;
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'exawatt-opencode-baseline-'));
});

afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

describe('launching OpenCode when the pre-spawn catalog snapshot fails', () => {
  it('still creates the Session instead of aborting the launch', async () => {
    const manager = new PtySessionManager();
    const session = await manager.create({
      harness: 'opencode',
      cwd,
      durableSessionId: 'session-opencode-baseline',
      initialPrompt: 'Review provider routing',
    });

    expect(session.harness).toBe('opencode');
    expect(spawned).toHaveLength(1);
    expect(manager.list().map(s => s.durableSessionId)).toContain(
      'session-opencode-baseline'
    );

    // Let the background identity-capture retry loop unwind promptly instead
    // of leaving a dangling timer once the Session is gone.
    await manager.kill(session.id);
    await new Promise(resolve => setTimeout(resolve, 150));
  });
});

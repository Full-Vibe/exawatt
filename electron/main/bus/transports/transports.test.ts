import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { claudeSocketTransport, findClaudeSocket } from './claude-socket';
import { codexQueueTransport } from './codex-queue';
import { terminalInputTransport } from './terminal-input';
import { undeliverableTransport } from './undeliverable';
import {
  context,
  envelope,
  recordingTerminal,
  target,
} from './fixtures.test-support';

/**
 * Every transport plugin, against its contract: the delivery state each
 * outcome records, and the exact bytes each door receives.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function scratch(): string {
  // Unix socket paths are short-limited, so the scratch dir stays near /tmp.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bus-'));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A Claude Code session as it registers itself, with a listening socket. */
async function claudeSession(dir: string, sessionId: string) {
  const sessions = path.join(dir, 'sessions');
  fs.mkdirSync(sessions, { recursive: true });
  const socketPath = path.join(dir, 's.sock');
  const received: string[] = [];
  let arrived!: () => void;
  const firstMessage = new Promise<void>(resolve => (arrived = resolve));
  const server = net.createServer(socket => {
    let text = '';
    socket.on('data', chunk => (text += chunk.toString('utf8')));
    socket.on('end', () => {
      received.push(text);
      arrived();
    });
  });
  await new Promise<void>(resolve => server.listen(socketPath, resolve));
  cleanups.push(() => server.close());
  fs.writeFileSync(
    path.join(sessions, `${process.pid}.json`),
    JSON.stringify({
      pid: process.pid,
      sessionId,
      messagingSocketPath: socketPath,
      updatedAt: 2,
    })
  );
  return { socketPath, received, server, firstMessage };
}

/** The Session's own environment, naming `dir` as Claude's config dir. */
function claudeHome(dir: string) {
  return async () => ({ CLAUDE_CONFIG_DIR: dir });
}

describe('claude-socket', () => {
  const sessionId = target().harnessSessionId!;

  it('posts one JSON user line carrying exactly the stamped text, and reads delivered', async () => {
    const dir = scratch();
    const claude = await claudeSession(dir, sessionId);
    const transport = claudeSocketTransport();
    const ctx = context({ sourceEnvironment: claudeHome(dir) });
    const result = await transport.deliver(envelope, target(), ctx);
    expect(result).toEqual({ state: 'delivered', adapter: 'claude-socket' });
    await claude.firstMessage;
    expect(claude.received).toHaveLength(1);
    const lines = claude.received[0].split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({
      type: 'user',
      message: { role: 'user', content: ctx.text },
    });
  });

  it('finds the socket by the session id Exawatt allocated, never by recency', async () => {
    const dir = scratch();
    await claudeSession(dir, sessionId);
    fs.writeFileSync(
      path.join(dir, 'sessions', '1.json'),
      JSON.stringify({
        pid: 1,
        sessionId: 'someone-else',
        messagingSocketPath: '/nope.sock',
        updatedAt: 99,
      })
    );
    expect(
      await findClaudeSocket(path.join(dir, 'sessions'), sessionId, () => true)
    ).toEqual({ socket: path.join(dir, 's.sock') });
  });

  it('reads undeliverable, with the reason, when no live session holds the id', async () => {
    const dir = scratch();
    await claudeSession(dir, sessionId);
    const dead = claudeSocketTransport({ alive: () => false });
    const result = await dead.deliver(
      envelope,
      target(),
      context({ sourceEnvironment: claudeHome(dir) })
    );
    expect(result.state).toBe('undeliverable');
    expect(result.reason).toMatch(/socket/);
  });

  it('names an unreadable registry rather than claiming there is no socket', async () => {
    const dir = scratch();
    fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true });
    // Claude was rewriting this entry: torn, and it may be this Session's.
    fs.writeFileSync(path.join(dir, 'sessions', '7.json'), '{"pid": 7, "sess');
    const result = await claudeSocketTransport({ alive: () => true }).deliver(
      envelope,
      target(),
      context({ sourceEnvironment: claudeHome(dir) })
    );
    expect(result.state).toBe('undeliverable');
    expect(result.reason).toMatch(/registry could not be read/);
  });

  it('reads undeliverable before Claude Code has named its conversation', async () => {
    const result = await claudeSocketTransport().deliver(
      envelope,
      target({ harnessSessionId: null }),
      context({ sourceEnvironment: claudeHome(scratch()) })
    );
    expect(result.state).toBe('undeliverable');
  });

  it('reads undeliverable when the socket refuses the connection', async () => {
    const dir = scratch();
    const claude = await claudeSession(dir, sessionId);
    await new Promise<void>(resolve => claude.server.close(() => resolve()));
    const result = await claudeSocketTransport().deliver(
      envelope,
      target(),
      context({ sourceEnvironment: claudeHome(dir) })
    );
    expect(result.state).toBe('undeliverable');
    expect(result.reason).toMatch(/refused/);
  });

  it('looks where the Session’s own environment says Claude registered, never Exawatt’s', async () => {
    const dir = scratch();
    const claude = await claudeSession(dir, sessionId);
    // A Finder-launched Exawatt lacks the shell's CLAUDE_CONFIG_DIR (here,
    // it even names another one); the Session's login shell has it.
    const before = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = scratch();
    cleanups.push(() => {
      if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = before;
    });
    const result = await claudeSocketTransport().deliver(
      envelope,
      target(),
      context({ sourceEnvironment: claudeHome(dir) })
    );
    expect(result.state).toBe('delivered');
    await claude.firstMessage;
  });

  it('falls back to the Session’s own HOME when it sets no CLAUDE_CONFIG_DIR', async () => {
    const home = scratch();
    const claude = await claudeSession(path.join(home, '.claude'), sessionId);
    const result = await claudeSocketTransport().deliver(
      envelope,
      target(),
      context({ sourceEnvironment: async () => ({ HOME: home }) })
    );
    expect(result.state).toBe('delivered');
    await claude.firstMessage;
  });
});

describe('codex-queue', () => {
  it('queues for the exact thread with the text in the environment, and declares its turn-start settle', async () => {
    const transport = codexQueueTransport('codex');
    const ctx = context();
    const result = await transport.deliver(
      envelope,
      target({ harness: 'codex' }),
      ctx
    );
    expect(result.state).toBe('queued');
    expect(result.adapter).toBe('codex-queue');
    expect(transport.queuedUntilTurnStart).toBe(true);
    expect(ctx.commands).toEqual([
      {
        executable: 'codex',
        args: [
          'queue',
          '--thread',
          target().harnessSessionId,
          '--message',
          { env: 'EXAWATT_BUS_MESSAGE', value: ctx.text },
        ],
      },
    ]);
  });

  it('reads undeliverable with the CLI’s own words when the queue refuses', async () => {
    const result = await codexQueueTransport().deliver(
      envelope,
      target({ harness: 'codex' }),
      context({
        runSourceCommand: async () => ({
          exitCode: 1,
          stdout: '',
          stderr: 'error: unknown thread\nmore',
        }),
      })
    );
    expect(result).toEqual({
      state: 'undeliverable',
      reason: 'codex queue refused it: error: unknown thread',
      adapter: 'codex-queue',
    });
  });

  it('reads undeliverable before Codex has named its thread, without running anything', async () => {
    const ctx = context();
    const result = await codexQueueTransport().deliver(
      envelope,
      target({ harness: 'codex', harnessSessionId: null }),
      ctx
    );
    expect(result.state).toBe('undeliverable');
    expect(ctx.commands).toEqual([]);
  });
});

describe('terminal-input', () => {
  const peer = terminalInputTransport({
    delivered: 'terminal',
    holdWhile: ['blocked'],
  });
  const operator = terminalInputTransport({
    delivered: 'delivered',
    holdWhile: ['running', 'blocked'],
  });

  it('pastes the text bracketed, then presses Enter as a separate write after the TUI answered', async () => {
    const terminal = recordingTerminal(true);
    const ctx = context({
      terminal: terminal.door,
      text: 'line one\nline two',
    });
    const result = await peer.deliver(envelope, target(), ctx);
    expect(result).toEqual({ state: 'terminal', adapter: 'terminal-input' });
    expect(terminal.writes).toEqual([
      '\x1b[200~line one\nline two\x1b[201~',
      '\r',
    ]);
    expect(terminal.events).toEqual(['write', 'settled', 'submit']);
  });

  it('keeps a message to one line when the TUI has no bracketed paste', async () => {
    const terminal = recordingTerminal(false);
    await peer.deliver(
      envelope,
      target(),
      context({ terminal: terminal.door, text: 'a\n\nb' })
    );
    expect(terminal.writes).toEqual(['a b', '\r']);
  });

  it('records the operator’s own turn as delivered', async () => {
    const terminal = recordingTerminal(true);
    const result = await operator.deliver(
      envelope,
      target(),
      context({ terminal: terminal.door, text: '/compact' })
    );
    expect(result.state).toBe('delivered');
    expect(terminal.writes[0]).toBe('\x1b[200~/compact\x1b[201~');
  });

  it('reads undeliverable, the Agent exited, when the paste lands on an exited Session', async () => {
    const terminal = recordingTerminal(true, { exitedBefore: 'write' });
    const result = await peer.deliver(
      envelope,
      target(),
      context({ terminal: terminal.door, text: 'hello' })
    );
    expect(result).toEqual({
      state: 'undeliverable',
      reason: expect.stringMatching(/The Agent exited/),
      adapter: 'terminal-input',
    });
    expect(terminal.writes).toEqual([]);
  });

  it('reads undeliverable when the Agent exits between the paste and Enter', async () => {
    const terminal = recordingTerminal(true, { exitedBefore: 'submit' });
    const result = await operator.deliver(
      envelope,
      target(),
      context({ terminal: terminal.door, text: 'hello' })
    );
    expect(result.state).toBe('undeliverable');
    expect(result.reason).toMatch(/The Agent exited/);
  });

  it('reads undeliverable for a Session with no terminal', async () => {
    expect((await peer.deliver(envelope, target(), context())).state).toBe(
      'undeliverable'
    );
  });
});

describe('undeliverable', () => {
  it('names its reason and holds nothing', async () => {
    const transport = undeliverableTransport('No door here');
    expect(transport.holdWhile).toEqual([]);
    expect(await transport.deliver(envelope, target(), context())).toEqual({
      state: 'undeliverable',
      reason: 'No door here',
      adapter: 'none',
    });
  });
});

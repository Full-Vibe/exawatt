import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveAgentAddress } from '@exawatt/core';

/**
 * ENG-029 C4: a launched Agent is named by main, before its process starts,
 * and keeps that name across a relaunch of the same durable Session.
 */
const processes = vi.hoisted(() => [] as Array<{ exit: () => void }>);
vi.mock('node-pty', () => ({
  spawn: () => {
    let onExit: (event: { exitCode: number }) => void = () => {};
    const process = {
      pid: 4242,
      onData: () => ({ dispose() {} }),
      onExit: (fn: typeof onExit) => {
        onExit = fn;
        return { dispose() {} };
      },
      write() {},
      resize() {},
      kill() {},
      exit: () => onExit({ exitCode: 0 }),
    };
    processes.push(process);
    return process;
  },
}));
vi.mock('./process-groups', () => ({
  stopProcessGroups: vi.fn(async () => {}),
}));
const { PtySessionManager } = await import('./session-manager');

let root: string;
let cwd: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'exawatt-agent-name-'));
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'exawatt-agent-cwd-'));
});

afterEach(() => {
  for (const process of processes.splice(0)) process.exit();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(cwd, { recursive: true, force: true });
});

async function manager() {
  const created = new PtySessionManager();
  await created.configurePersistence(path.join(root, 'sessions'));
  return created;
}

describe('Agent names at launch', () => {
  it('names each launch per Project and keeps the name on relaunch', async () => {
    const first = await manager();
    const announced: string[][] = [];
    first.on('agent-names', (records: { name: string }[]) =>
      announced.push(records.map(record => record.name))
    );
    const a = await first.create({
      harness: 'claude',
      cwd,
      projectKey: 'project-one',
      durableSessionId: 'session-a',
    });
    const b = await first.create({
      harness: 'claude',
      cwd,
      projectKey: 'project-one',
      durableSessionId: 'session-b',
    });
    const shell = await first.create({ harness: 'shell', cwd });
    expect([a.agentName, b.agentName, shell.agentName]).toEqual([
      'claude-1',
      'claude-2',
      null,
    ]);
    expect(announced.at(-1)).toEqual(['claude-1', 'claude-2']);
    await first.stopAll();

    // A new main process, the same durable Session: the same name.
    const second = await manager();
    const relaunched = await second.create({
      harness: 'claude',
      cwd,
      projectKey: 'project-one',
      durableSessionId: 'session-b',
    });
    expect(relaunched.agentName).toBe('claude-2');
  });

  it('renames into the live row and the directory the bus resolves against', async () => {
    const owner = await manager();
    const session = await owner.create({
      harness: 'codex',
      cwd,
      projectKey: 'project-one',
      durableSessionId: 'session-a',
    });
    await owner.ensureAgentNames([
      {
        durableSessionId: 'session-b',
        projectKey: 'project-one',
        harness: 'codex',
      },
    ]);
    expect(await owner.renameAgent('session-a', 'codex-2')).toMatchObject({
      ok: false,
      code: 'taken',
    });
    expect(await owner.renameAgent('session-a', 'reviewer')).toMatchObject({
      ok: true,
    });
    expect(owner.list().find(row => row.id === session.id)?.agentName).toBe(
      'reviewer'
    );
    const resolved = resolveAgentAddress(
      owner.agentDirectory(),
      'project-one',
      '@reviewer'
    );
    expect(resolved).toMatchObject({
      kind: 'agent',
      agent: { durableSessionId: 'session-a', ptyId: session.id },
    });
  });

  it('frees a name only when the Session is gone for good', async () => {
    const owner = await manager();
    await owner.create({
      harness: 'claude',
      cwd,
      projectKey: 'project-one',
      durableSessionId: 'session-a',
    });
    processes.at(-1)!.exit();
    await owner.closeSession('session-a');
    expect(owner.agentNameRecords()).toHaveLength(1);
    await owner.purgeHistory('session-a');
    expect(owner.agentNameRecords()).toEqual([]);
  });
});

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveAgentAddress, type AgentNameRecord } from '@exawatt/core';
import { BusDirectory } from '../bus/directory';

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

  it('re-keys a moved Agent into its live row, the bus, and every window', async () => {
    const owner = await manager();
    const announced: string[][] = [];
    owner.on('agent-names', (records: { name: string }[]) =>
      announced.push(records.map(record => record.name).sort())
    );
    await owner.create({
      harness: 'claude',
      cwd,
      projectKey: 'project-one',
      durableSessionId: 'session-a',
    });
    const moved = await owner.create({
      harness: 'claude',
      cwd,
      projectKey: 'project-two',
      durableSessionId: 'session-b',
    });
    expect(moved.agentName).toBe('claude-1');
    announced.length = 0;

    // Its tab moved into project-one, where claude-1 is taken: re-dealt,
    // with the record count unchanged.
    await owner.ensureAgentNames([
      {
        durableSessionId: 'session-b',
        projectKey: 'project-one',
        harness: 'claude',
      },
    ]);
    expect(owner.list().find(row => row.id === moved.id)?.agentName).toBe(
      'claude-2'
    );
    expect(announced).toEqual([['claude-1', 'claude-2']]);
    const bus = new BusDirectory(owner);
    expect(bus.resolve('project-one', '@claude-2')).toMatchObject({
      ok: true,
      addressee: { entry: { sessionId: 'session-b', name: 'claude-2' } },
    });
    expect(bus.resolve('project-one', '@claude-1')).toMatchObject({
      ok: true,
      addressee: { entry: { sessionId: 'session-a' } },
    });

    // Asking again for what it already is changes nothing and tells no one.
    await owner.ensureAgentNames([
      {
        durableSessionId: 'session-b',
        projectKey: 'project-one',
        harness: 'claude',
      },
    ]);
    expect(announced).toHaveLength(1);
  });

  it('answers a request it can never satisfy as skipped, with the reason', async () => {
    const owner = await manager();
    const answer = await owner.ensureAgentNames([
      {
        durableSessionId: 'not a session id',
        projectKey: 'p',
        harness: 'claude',
      },
      { durableSessionId: 'session-x', projectKey: '', harness: 'claude' },
      { durableSessionId: 'session-y', projectKey: 'p', harness: 'shell' },
      { durableSessionId: 'session-z', projectKey: 'p', harness: 'codex' },
    ]);
    expect(answer.records.map(record => record.durableSessionId)).toEqual([
      'session-z',
    ]);
    expect(answer.skipped.map(skip => skip.durableSessionId)).toEqual([
      'not a session id',
      'session-x',
      'session-y',
    ]);
    expect(answer.skipped.every(skip => skip.reason.length > 0)).toBe(true);
  });

  it('tells every window when a deleted or purged Session frees its name', async () => {
    const owner = await manager();
    // A second window's mirror: main's push replaces it whole, as the
    // renderer's `publishAgentNames` does.
    let mirror = new Map<string, string>();
    let pushes = 0;
    owner.on('agent-names', (records: AgentNameRecord[]) => {
      pushes += 1;
      mirror = new Map(
        records.map(record => [record.durableSessionId, record.name])
      );
    });
    const live = await owner.create({
      harness: 'claude',
      cwd,
      projectKey: 'project-one',
      durableSessionId: 'session-a',
    });
    await owner.create({
      harness: 'claude',
      cwd,
      projectKey: 'project-one',
      durableSessionId: 'session-b',
    });
    await owner.ensureAgentNames([
      {
        durableSessionId: 'session-c',
        projectKey: 'project-one',
        harness: 'codex',
      },
    ]);
    expect([...mirror.values()].sort()).toEqual([
      'claude-1',
      'claude-2',
      'codex-1',
    ]);

    // A live Session deleted: killed, and its name freed everywhere.
    await owner.deleteSession('session-a');
    expect(owner.list().some(row => row.id === live.id)).toBe(false);
    expect([...mirror.keys()].sort()).toEqual(['session-b', 'session-c']);

    // A Session with no process deleted.
    await owner.deleteSession('session-c');
    expect([...mirror.keys()]).toEqual(['session-b']);

    // An exited Session's history purged: its row, too, wears no name.
    processes.at(-1)!.exit();
    await owner.purgeHistory('session-b');
    expect(mirror.size).toBe(0);
    expect(
      owner
        .list()
        .filter(row => row.durableSessionId === 'session-b')
        .every(row => row.agentName === null)
    ).toBe(true);

    // Freeing a name no Session had tells no one.
    const before = pushes;
    await owner.deleteSession('session-never-named');
    expect(pushes).toBe(before);
  });

  it("names the launcher's rows by the Session that ran them (BUG-117)", async () => {
    const owner = await manager();
    await owner.create({
      harness: 'codex',
      cwd,
      projectKey: 'project-one',
      durableSessionId: 'session-a',
      resumeSessionId: '019a0000-0000-7000-8000-00000000000a',
    });
    await owner.ensureAgentNames([
      {
        durableSessionId: 'session-b',
        projectKey: 'project-one',
        harness: 'claude',
      },
    ]);
    const nameOf = owner.conversationAgentNames();
    expect(
      nameOf({
        harness: 'codex',
        durableSessionId: null,
        providerSessionId: '019a0000-0000-7000-8000-00000000000a',
      })
    ).toBe('codex-1');
    expect(
      nameOf({
        harness: 'claude',
        durableSessionId: 'session-b',
        providerSessionId: null,
      })
    ).toBe('claude-1');
    expect(
      nameOf({
        harness: 'claude',
        durableSessionId: null,
        providerSessionId: '019a0000-0000-7000-8000-00000000000a',
      })
    ).toBeNull();
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

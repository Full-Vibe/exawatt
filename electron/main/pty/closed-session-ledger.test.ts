import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClosedSessionLedger } from './closed-session-ledger';

describe('ClosedSessionLedger (D23)', () => {
  let dir: string;
  let file: string;
  let purged: string[];
  let clock: number;

  const make = (retentionMs = 1000) =>
    new ClosedSessionLedger(
      file,
      async id => {
        purged.push(id);
      },
      () => clock,
      retentionMs
    );

  const entry = (id: string) => ({
    durableSessionId: id,
    title: 'Claude Code',
    titleKind: 'default' as const,
    goal: 'Ship code review fixes',
    harness: 'claude',
    cwd: '/repo',
    projectDir: '/repo',
    projectName: 'repo',
    harnessSessionId: 'provider-1',
    initialTask: null,
  });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exa-ledger-'));
    file = path.join(dir, 'closed-sessions.json');
    purged = [];
    clock = 100_000;
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips add → list → take, newest first, persisted across instances', () => {
    const ledger = make();
    ledger.add(entry('a'));
    clock += 10;
    ledger.add(entry('b'));

    const reloaded = make();
    expect(reloaded.list().map(e => e.durableSessionId)).toEqual(['b', 'a']);

    const taken = reloaded.take('a');
    expect(taken?.goal).toBe('Ship code review fixes');
    expect(taken?.titleKind).toBe('default');
    expect(taken?.closedAt).toBe(100_000);
    expect(
      make()
        .list()
        .map(e => e.durableSessionId)
    ).toEqual(['b']);
    // take never purges history — reopen must find it intact
    expect(purged).toEqual([]);
  });

  it('re-closing the same durable Session replaces the older entry', () => {
    const ledger = make();
    ledger.add(entry('a'));
    clock += 50;
    ledger.add({ ...entry('a'), goal: 'Newer goal' });
    const entries = ledger.list();
    expect(entries).toHaveLength(1);
    expect(entries[0].goal).toBe('Newer goal');
    expect(entries[0].closedAt).toBe(100_050);
  });

  it('reap deletes only expired entries and purges exactly their history', async () => {
    const ledger = make(1000);
    ledger.add(entry('old'));
    clock += 2000;
    ledger.add(entry('young'));

    expect(await ledger.reap()).toBe(1);
    expect(ledger.list().map(e => e.durableSessionId)).toEqual(['young']);
    expect(purged).toEqual(['old']);

    // idempotent: nothing further to reap
    expect(await ledger.reap()).toBe(0);
  });

  it('a corrupt ledger file reads as empty and heals on next write', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, '{not json');
    const ledger = make();
    expect(ledger.list()).toEqual([]);
    ledger.add(entry('a'));
    expect(make().list()).toHaveLength(1);
  });

  it('take on an unknown id returns null without touching the file', () => {
    const ledger = make();
    ledger.add(entry('a'));
    expect(ledger.take('missing')).toBeNull();
    expect(ledger.list()).toHaveLength(1);
  });
});

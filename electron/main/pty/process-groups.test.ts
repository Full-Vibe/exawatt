import { describe, expect, it, vi } from 'vitest';
import { execFileSync, spawn } from 'child_process';
import { parseProcessTable } from './process-groups';

describe('parseProcessTable', () => {
  it('parses macOS ps output and ignores malformed rows', () => {
    expect(
      parseProcessTable('  12    12\n  19    12\nnope\n 31 31 extra\n')
    ).toEqual([
      { pid: 12, pgid: 12 },
      { pid: 19, pgid: 12 },
    ]);
  });
});

it('escalates and removes a process group with descendants', async () => {
  if (process.platform === 'win32') return;
  const child = spawn('/bin/sh', ['-c', "trap '' HUP; sleep 30 & wait"], {
    detached: true,
    stdio: 'ignore',
  });
  if (!child.pid) throw new Error('No child pid');
  try {
    await vi.waitFor(
      () => {
        const table = parseProcessTable(
          execFileSync('/bin/ps', ['-axo', 'pid=,pgid='], {
            encoding: 'utf8',
          })
        );
        expect(table).toContainEqual({ pid: child.pid, pgid: child.pid });
      },
      { timeout: 3_000, interval: 10 }
    );
    const { stopProcessGroups } = await import('./process-groups');
    await stopProcessGroups(
      [child.pid],
      (_pid, signal) => child.kill(signal as NodeJS.Signals),
      50
    );
    const table = parseProcessTable(
      execFileSync('/bin/ps', ['-axo', 'pid=,pgid='], { encoding: 'utf8' })
    );
    expect(table.some(entry => entry.pgid === child.pid)).toBe(false);
  } finally {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // Already verified gone.
    }
  }
});

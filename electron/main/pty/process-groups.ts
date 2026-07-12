import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface ProcessTableEntry {
  pid: number;
  pgid: number;
}

export function parseProcessTable(output: string): ProcessTableEntry[] {
  return output
    .split('\n')
    .map(line => line.trim().split(/\s+/).map(Number))
    .filter(parts => parts.length === 2 && parts.every(Number.isFinite))
    .map(([pid, pgid]) => ({ pid, pgid }));
}

async function processTable(): Promise<ProcessTableEntry[]> {
  if (process.platform === 'win32') return [];
  const { stdout } = await execFileAsync('/bin/ps', ['-axo', 'pid=,pgid=']);
  return parseProcessTable(stdout);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function remaining(groups: Set<number>): Promise<Set<number>> {
  const table = await processTable();
  return new Set(
    table.filter(item => groups.has(item.pgid)).map(item => item.pgid)
  );
}

/** Stop and verify PTY process groups without ever signaling Exawatt's group. */
export async function stopProcessGroups(
  pids: number[],
  fallback: (pid: number, signal: string) => void,
  graceMs = 1_500
): Promise<void> {
  if (pids.length === 0) return;
  if (process.platform === 'win32') {
    for (const pid of pids) fallback(pid, 'SIGTERM');
    return;
  }

  const table = await processTable();
  const ownGroup = table.find(item => item.pid === process.pid)?.pgid;
  const safeGroups = new Set<number>();
  for (const pid of pids) {
    const entry = table.find(item => item.pid === pid);
    if (entry && entry.pgid === pid && entry.pgid !== ownGroup) {
      safeGroups.add(entry.pgid);
      try {
        process.kill(-entry.pgid, 'SIGHUP');
      } catch {
        // It exited between ps and signal.
      }
    } else {
      fallback(pid, 'SIGHUP');
    }
  }

  const deadline = Date.now() + graceMs;
  let unresolved = await remaining(safeGroups);
  while (unresolved.size > 0 && Date.now() < deadline) {
    await sleep(75);
    unresolved = await remaining(unresolved);
  }
  for (const group of unresolved) {
    try {
      process.kill(-group, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
  if (unresolved.size > 0) {
    await sleep(100);
    const survivors = await remaining(unresolved);
    if (survivors.size > 0) {
      throw new Error(
        `Could not stop process groups: ${Array.from(survivors).join(', ')}`
      );
    }
  }
}

import { execFileSync } from 'node:child_process';

function processes() {
  return execFileSync('ps', ['-axo', 'pid=,pgid=,lstart=,command='], {
    encoding: 'utf8',
    timeout: 2_000,
  })
    .split('\n')
    .flatMap(line => {
      const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
      return match
        ? [
            {
              pid: Number(match[1]),
              group: Number(match[2]),
              identity: match[3],
            },
          ]
        : [];
    });
}

/** Playwright's POSIX launch is detached. Retain verified identities before
 * closing main so reparented Chromium helpers remain ours, while PID/group
 * reuse and the harness's own process group fail closed. */
export function captureElectronProcessGroup(pid) {
  if (process.platform === 'win32' || !Number.isSafeInteger(pid) || pid <= 1)
    return null;
  const initial = processes();
  const leader = initial.find(entry => entry.pid === pid);
  const harness = initial.find(entry => entry.pid === process.pid);
  if (!leader || leader.group !== pid || !harness || harness.group === pid)
    return null;
  const owned = new Map();
  for (const entry of initial.filter(entry => entry.group === pid))
    owned.set(entry.pid, entry.identity);

  function currentOwnedGroup() {
    const current = processes();
    if (current.find(entry => entry.pid === process.pid)?.group === pid)
      return [];
    const members = current.filter(entry => entry.group === pid);
    // A surviving captured identity proves this is still our group. Matching
    // only its numeric PGID would admit an unrelated group after PID reuse.
    return members.some(entry => owned.get(entry.pid) === entry.identity)
      ? members
      : [];
  }

  return {
    captureMembers() {
      for (const entry of currentOwnedGroup())
        owned.set(entry.pid, entry.identity);
    },
    forceKill() {
      if (currentOwnedGroup().length === 0) return false;
      try {
        process.kill(-pid, 'SIGKILL');
        return true;
      } catch (error) {
        if (error.code === 'ESRCH') return false;
        throw error;
      }
    },
  };
}

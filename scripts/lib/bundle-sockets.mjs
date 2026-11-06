/**
 * The internet sockets held by the processes of one app bundle, for the
 * community network check (ENG-030 OS4, BUG-337).
 *
 * A process belongs to the bundle when its EXECUTABLE IMAGE lies inside it:
 * the file the kernel mapped at exec, which `lsof` lists as the process's
 * first `txt` entry. A process cannot change it. Everything else a process
 * is listed by can be: `ps -o comm` is read from the process's own argument
 * memory, and Next's server rewrites that when it sets `process.title`, so
 * the renderer server, running the bundle's helper binary, was listed as
 * `next-server (v16…)` and never sampled. Ancestry is no better (see
 * `community-network-observatory.mjs`): pids are recycled, and a recycled
 * parent pid once put a sibling agent's traffic on the build's record.
 *
 * One sample is two `lsof` reads. The first, system-wide, names the processes
 * holding any internet socket. The second lists every open file of exactly
 * those, and each process's image and sockets come from that one read of
 * that one process: a pid that changed hands between the two reads describes
 * the process that holds it now, image and sockets alike, so a stranger's
 * socket can never be put on the bundle's record.
 */

import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** `lsof` exits 1 when a listed process has gone; what it printed stands. */
async function lsof(args, exec) {
  try {
    return (await exec('lsof', args, { maxBuffer: 64 * 1024 * 1024 })).stdout;
  } catch (error) {
    if (typeof error?.stdout === 'string') return error.stdout;
    throw error;
  }
}

/**
 * `lsof -F pftn` output -> the bundle's processes and the remote peers their
 * internet sockets hold. A listener has no peer and is not one.
 *
 * @param {string} output
 * @param {string} bundlePath the bundle's real path, without a trailing slash
 */
export function parseBundleSockets(output, bundlePath) {
  const prefix = `${bundlePath}/`;
  /** @type {Map<number, { image: string | null, peers: Array<{ address: string, port: number, raw: string }> }>} */
  const processes = new Map();
  let current = null;
  let fd = null;
  let type = null;
  for (const line of output.split('\n')) {
    const tag = line[0];
    const value = line.slice(1);
    if (tag === 'p') {
      current = { image: null, peers: [] };
      processes.set(Number(value), current);
      fd = type = null;
    } else if (!current) {
      continue;
    } else if (tag === 'f') {
      fd = value;
      type = null;
    } else if (tag === 't') {
      type = value;
    } else if (tag === 'n') {
      if (fd === 'txt' && current.image === null) current.image = value;
      if (type !== 'IPv4' && type !== 'IPv6') continue;
      const arrow = value.indexOf('->');
      if (arrow < 0) continue;
      const remote = value.slice(arrow + 2).replace(/\s*\(.*\)$/, '');
      const port = remote.lastIndexOf(':');
      if (port < 0) continue;
      current.peers.push({
        address: remote.slice(0, port),
        port: Number(remote.slice(port + 1)),
        raw: remote,
      });
    }
  }
  const pids = [];
  const peers = [];
  for (const [pid, entry] of processes) {
    if (!entry.image?.startsWith(prefix)) continue;
    pids.push(pid);
    const command = entry.image.slice(entry.image.lastIndexOf('/') + 1);
    for (const peer of entry.peers) peers.push({ pid, command, ...peer });
  }
  return { pids, peers };
}

/**
 * One sample: the bundle's processes that hold an internet socket, and every
 * remote peer they hold.
 *
 * @param {string} bundlePath
 * @param {{ exec?: typeof execFileAsync }} [options]
 * @returns {Promise<{ pids: number[], peers: Array<{ pid: number, command: string, address: string, port: number, raw: string }> }>}
 */
export async function sampleBundleSockets(bundlePath, options = {}) {
  const exec = options.exec ?? execFileAsync;
  const holders = await lsof(['-nP', '-i', '-F', 'p'], exec);
  const pids = [
    ...new Set(
      holders
        .split('\n')
        .filter(line => line.startsWith('p'))
        .map(line => line.slice(1))
    ),
  ];
  if (pids.length === 0) return { pids: [], peers: [] };
  const files = await lsof(['-nP', '-p', pids.join(','), '-F', 'pftn'], exec);
  return parseBundleSockets(files, realpathSync(bundlePath));
}

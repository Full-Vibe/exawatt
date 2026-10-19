/**
 * Claude Code's peer door (B0 verdicts, 2026-10-15; Claude Code 2.1.300).
 *
 * Each interactive Claude Code session registers itself in
 * `<config dir>/sessions/<pid>.json` with its `sessionId` and a
 * `messagingSocketPath`. A same-user process connects and writes ONE JSON
 * line, `{"type":"user","message":{"role":"user","content":…}}`; Claude reads
 * it at once when idle and between tool calls when busy. No auth line is
 * needed from an outside process, and the socket answers nothing, so
 * `delivered` means "the socket accepted it". The injected `--settings` file
 * carries `crossSessionInbound: accept`, so a YOLO launch delivers too.
 *
 * Exawatt allocates the session id (`--session-id`), so the registry entry is
 * found by that id, never by recency or cwd, in the config directory the
 * Session's own environment names.
 */
import fs from 'fs';
import net from 'net';
import path from 'path';
import type { DeliveryResult } from '@exawatt/core';
import { readConfigFile, type ConfigFileGrammar } from '@exawatt/core/server';
import { claudeConfigDir } from '../../pty/harness-homes';
import type { BusTransport } from './types';

const ADAPTER = 'claude-socket';

interface ClaudeRegistryEntry {
  pid?: unknown;
  sessionId?: unknown;
  messagingSocketPath?: unknown;
  updatedAt?: unknown;
}

interface ClaudeSocketOptions {
  /** Whether a registered pid is still running. */
  alive?: (pid: number) => boolean;
}

const REGISTRY_ENTRY: ConfigFileGrammar<ClaudeRegistryEntry> = {
  name: 'JSON',
  parse: text => {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object'
      ? (value as ClaudeRegistryEntry)
      : null;
  },
};

/** The live socket for a Session, or why none was found: a registry entry
 *  that could not be read may have been this Session's. */
type ClaudeSocketLookup =
  | { socket: string }
  | { socket: null; unreadable: number };

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The socket of the live Claude Code process holding `sessionId`. */
export async function findClaudeSocket(
  sessionsDir: string,
  sessionId: string,
  alive: (pid: number) => boolean = processAlive
): Promise<ClaudeSocketLookup> {
  let names: string[];
  try {
    names = await fs.promises.readdir(sessionsDir);
  } catch {
    return { socket: null, unreadable: 0 };
  }
  const matches: { socket: string; updatedAt: number }[] = [];
  let unreadable = 0;
  await Promise.all(
    names
      .filter(name => /^\d+\.json$/.test(name))
      .map(async name => {
        // Claude rewrites these files while it runs: an entry gone since
        // the listing is one fewer process; one that cannot be read (torn,
        // refused) is counted, so "no socket" is never claimed over it.
        const read = await readConfigFile(
          path.join(sessionsDir, name),
          REGISTRY_ENTRY
        );
        if (read.status === 'missing') return;
        if (read.status === 'unreadable') {
          unreadable += 1;
          return;
        }
        const entry = read.value;
        if (
          entry.sessionId !== sessionId ||
          typeof entry.messagingSocketPath !== 'string' ||
          typeof entry.pid !== 'number' ||
          !alive(entry.pid)
        )
          return;
        matches.push({
          socket: entry.messagingSocketPath,
          updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : 0,
        });
      })
  );
  matches.sort((a, b) => b.updatedAt - a.updatedAt);
  return matches[0]
    ? { socket: matches[0].socket }
    : { socket: null, unreadable };
}

/** Write one line to a Unix socket; resolves with the failure code or null. */
function postLine(socketPath: string, line: string): Promise<string | null> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (failure: string | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(failure);
    };
    const socket = net.createConnection(socketPath);
    socket.setTimeout(5_000, () =>
      finish('the socket did not accept the message')
    );
    socket.once('error', error =>
      finish((error as NodeJS.ErrnoException).code ?? error.message)
    );
    socket.once('connect', () => {
      socket.end(line, () => finish(null));
    });
  });
}

export function claudeSocketTransport(
  options: ClaudeSocketOptions = {}
): BusTransport {
  const alive = options.alive ?? processAlive;
  return {
    kind: ADAPTER,
    // Claude registers its socket as it starts; a message to a tab still
    // starting waits for it instead of failing.
    holdWhile: ['starting'],
    async deliver(_envelope, target, context): Promise<DeliveryResult> {
      if (!target.harnessSessionId) {
        return {
          state: 'undeliverable',
          reason: 'Claude Code has not named this conversation yet',
          adapter: ADAPTER,
        };
      }
      const lookup = await findClaudeSocket(
        path.join(
          claudeConfigDir(await context.sourceEnvironment()),
          'sessions'
        ),
        target.harnessSessionId,
        alive
      );
      if (lookup.socket === null) {
        return {
          state: 'undeliverable',
          reason:
            lookup.unreadable > 0
              ? "Claude Code's session registry could not be read, so its message socket is unknown"
              : 'Claude Code has no message socket for this Session (a version before peer messages, or it is still starting)',
          adapter: ADAPTER,
        };
      }
      const socket = lookup.socket;
      const failure = await postLine(
        socket,
        `${JSON.stringify({
          type: 'user',
          message: { role: 'user', content: context.text },
        })}\n`
      );
      return failure
        ? {
            state: 'undeliverable',
            reason: `Claude Code's message socket refused it (${failure})`,
            adapter: ADAPTER,
          }
        : { state: 'delivered', adapter: ADAPTER };
    },
  };
}

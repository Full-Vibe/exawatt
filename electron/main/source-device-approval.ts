import type { SourceTransport } from '@exawatt/core';
import { H2_WRITE_SCOPES } from './connected-gateway-authority';
import type { SshDestination } from './ssh-tunnel';
import { isRecord } from './untrusted-input';

/**
 * Send access as a step in setting up a server (ENG-033 H2.4 P3).
 *
 * Raising Exawatt's device from reading to sending is approved on the source,
 * with the source's own device tooling. The operator decided on 2026-09-24
 * that the step is "one-click to run that command or let the user copy and
 * run it themselves" (decision `0037`, amendment of that date). This module is
 * the half of both paths that decides WHAT gets approved: which pending
 * request is Exawatt's own, and the exact command that approves it.
 *
 * The rule that carries it: Exawatt approves only a request it can prove is
 * its own. The source's pairing list names every pending request with the
 * device that made it; the device id is the source's own derivation from the
 * public key that signed the handshake, so a request carrying Exawatt's device
 * id (and, when listed, its public key) was made by the key Exawatt holds.
 * Anything else, including a request the list does not identify, is someone
 * else's and is never approved here. Verified 2026-09-24 against OpenClaw
 * 2026.7.1-2 on the operator's servers: `devices list --json` answers
 * `{ pending, paired }`, and every pending entry carries `requestId`,
 * `deviceId`, and `publicKey`.
 */

/** Exawatt's own device on a source, as that source's pairing list names it. */
interface OwnDeviceIdentity {
  deviceId: string;
  publicKey: string;
}

/**
 * What the pairing list said about Exawatt's own standing request.
 *
 * `none` and `unreadable` are different facts and stay different: `none` is a
 * list that was read and holds no request from this device, `unreadable` is a
 * list Exawatt could not read or could not use, which says nothing at all
 * about what is pending.
 */
export type OwnPendingRequest =
  | { kind: 'found'; requestId: string }
  | { kind: 'none' }
  | { kind: 'unreadable' };

/** The source's own read of its pairing list, argument by argument. */
export const LIST_DEVICES_ARGV: readonly string[] = [
  'openclaw',
  'devices',
  'list',
  '--json',
];

/** The source's own approval of one pending request, argument by argument. */
export function approveDeviceArgv(requestId: string): readonly string[] {
  return ['openclaw', 'devices', 'approve', requestId];
}

/**
 * A request id Exawatt will hand to a remote shell. The id is source-supplied
 * text, so it is held to a tighter grammar than the transport's own argument
 * check: letters, digits, `-` and `_`, which covers the UUIDs OpenClaw issues.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;

/** The only role and scopes a request Exawatt approves may carry. */
const APPROVABLE_ROLE = 'operator';
const APPROVABLE_SCOPES: ReadonlySet<string> = new Set(H2_WRITE_SCOPES);

function pairingListOf(output: string): Record<string, unknown> | null {
  const text = output.trim();
  const candidates = [text];
  // A CLI may print a notice before its JSON. The list starts on its own line.
  const start = text.search(/^\{/mu);
  if (start > 0) candidates.push(text.slice(start));
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (isRecord(parsed)) return parsed;
    } catch {
      // Try the next reading.
    }
  }
  return null;
}

/**
 * Only what Exawatt itself asks for: the operator role, and read plus write.
 * A standing request for more, even one from this device, is not approved
 * here, because approving it would grant what Exawatt never asks for.
 */
function asksOnlyForSendAccess(entry: Record<string, unknown>): boolean {
  const { scopes, role, roles } = entry;
  if (!Array.isArray(scopes) || scopes.length === 0) return false;
  if (!scopes.every(scope => APPROVABLE_SCOPES.has(scope as string))) {
    return false;
  }
  if (role !== undefined && role !== APPROVABLE_ROLE) return false;
  if (
    roles !== undefined &&
    (!Array.isArray(roles) || !roles.every(value => value === APPROVABLE_ROLE))
  ) {
    return false;
  }
  return true;
}

/**
 * Exawatt's own standing request in a source's `devices list --json` output.
 *
 * A request is Exawatt's when its device id is Exawatt's and its public key,
 * when the list carries one, is Exawatt's too. Among Exawatt's own, the first
 * the source lists is taken; OpenClaw lists pending requests newest first.
 */
export function findOwnPendingRequest(
  output: string,
  self: OwnDeviceIdentity
): OwnPendingRequest {
  const list = pairingListOf(output);
  if (list === null || !Array.isArray(list.pending)) {
    return { kind: 'unreadable' };
  }
  let unusable = false;
  for (const entry of list.pending) {
    if (!isRecord(entry)) continue;
    const { deviceId, publicKey, requestId } = entry;
    if (typeof deviceId !== 'string' || deviceId.trim() !== self.deviceId) {
      continue;
    }
    if (publicKey !== undefined && publicKey !== self.publicKey) continue;
    if (
      typeof requestId !== 'string' ||
      !REQUEST_ID_PATTERN.test(requestId) ||
      !asksOnlyForSendAccess(entry)
    ) {
      unusable = true;
      continue;
    }
    return { kind: 'found', requestId };
  }
  return unusable ? { kind: 'unreadable' } : { kind: 'none' };
}

/**
 * The SSH login a source's approval runs over, or null for a source Exawatt
 * reaches without one. Field by field, like the tunnel target, so nothing a
 * later record shape adds can reach an `ssh` argument vector.
 */
export function sshDestinationOf(
  transport: SourceTransport
): SshDestination | null {
  if (transport.kind === 'ssh-alias') {
    return { kind: 'ssh-alias', alias: transport.alias };
  }
  if (transport.kind === 'ssh-manual') {
    return {
      kind: 'ssh-manual',
      host: transport.host,
      user: transport.user,
      port: transport.port,
      identityFile: transport.identityFile,
    };
  }
  return null;
}

/** One word for a POSIX shell, quoted only when it has to be. */
function shellWord(value: string): string {
  return /^[A-Za-z0-9._@:/+=,-]+$/u.test(value)
    ? value
    : `'${value.replace(/'/gu, `'\\''`)}'`;
}

const DEFAULT_SSH_PORT = 22;

/**
 * What the operator runs by hand to approve Exawatt's request, in order, from
 * this machine: the login Exawatt itself uses, then the source's approval.
 * With the request id unknown, the list comes first so the operator can find
 * it; the lines never name an id Exawatt did not read from the source.
 */
export function approveCommandsFor(
  transport: SourceTransport,
  requestId: string | null
): readonly string[] {
  const approve =
    requestId === null
      ? ['openclaw devices list', 'openclaw devices approve <request id>']
      : [`openclaw devices approve ${requestId}`];
  const destination = sshDestinationOf(transport);
  if (destination === null) return approve;
  if (destination.kind === 'ssh-alias') {
    return [`ssh ${shellWord(destination.alias)}`, ...approve];
  }
  const login = ['ssh'];
  if (destination.port !== DEFAULT_SSH_PORT) {
    login.push('-p', String(destination.port));
  }
  if (destination.identityFile) {
    login.push('-i', shellWord(destination.identityFile));
  }
  login.push(shellWord(`${destination.user}@${destination.host}`));
  return [login.join(' '), ...approve];
}

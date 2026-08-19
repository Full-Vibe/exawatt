import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { stopChildProcess } from './child-process-lifecycle';

/**
 * ENG-010 C1: the SSH-forwarded transport into a source's own loopback Gateway.
 *
 * The OpenClaw Gateway on a customer-hosted source listens on that server's
 * loopback interface only, so the only honest way in is a port forward over an
 * SSH connection the operator already has. This module owns the whole lifecycle
 * of that forward in Electron main: validation before spawn, readiness, failure
 * classification, and a shutdown that leaves no orphaned `ssh` behind.
 *
 * Two properties matter more than anything else here.
 *
 * 1. Nothing operator-controlled may reach `ssh` as an option. Every part of a
 *    destination is a string the operator types or picks, and `ssh` reads a
 *    leading dash as an option, so an unvalidated alias, host, user, or key
 *    path is remote code execution on this machine (see
 *    `resolveSshDestination`).
 * 2. No failure detail may carry infrastructure identity. `ssh` stderr names
 *    hosts, users, ports, and key paths; those never leave this module. A
 *    failure resolves to one of a fixed set of sentences written in this file
 *    instead, and nothing is ever interpolated into one.
 *
 * This module also owns the SSH DESTINATION model, which `gateway-bootstrap.ts`
 * shares. Both modules hand operator-supplied server access to `ssh`, and the
 * validation that keeps it inert is the one thing neither may reimplement: a
 * second copy is a second chance to get it wrong.
 */

export type SshTunnelFailureClass =
  /** Rejected before spawning: the target itself is not usable. */
  | 'invalid-target'
  /** DNS, routing, refused on the SSH port, or a connect timeout. */
  | 'host-unreachable'
  /** The server answered and refused the login. */
  | 'auth-rejected'
  /** The server was reached but the forward failed or nothing listens. */
  | 'gateway-down'
  /** Reached none of the above; the operator gets diagnostics, not a guess. */
  | 'unknown';

export interface SshTunnelFailure {
  class: SshTunnelFailureClass;
  /** Bounded, redacted operator-facing detail. Never raw stderr. */
  message: string;
}

/**
 * How to reach one server, in the two shapes a configured source can hold.
 *
 * The discriminants match `SourceTransport`'s so the persisted record and the
 * thing handed to `ssh` are read with the same vocabulary. The alias case is
 * the ordinary one: the operator's own SSH configuration supplies host, user,
 * port, and key. The manual case is for an operator with no config entry, and
 * every field it carries is one more argument that has to be proved inert.
 */
export type SshDestination =
  | { kind: 'ssh-alias'; alias: string }
  | {
      kind: 'ssh-manual';
      host: string;
      user: string;
      port: number;
      identityFile: string | null;
    };

export type SshTunnelTarget = SshDestination & {
  /** Port the Gateway listens on, on the remote loopback interface. */
  remotePort: number;
  /** Defaults to 127.0.0.1. */
  remoteHost?: string;
  connectTimeoutSeconds?: number;
};

export interface SshTunnel {
  /** Loopback port on this machine that now forwards to the remote Gateway. */
  readonly localPort: number;
  readonly closed: boolean;
  close(): Promise<void>;
  onClosed(listener: (failure: SshTunnelFailure | null) => void): () => void;
}

export type OpenSshTunnelResult =
  | { ok: true; tunnel: SshTunnel }
  | { ok: false; failure: SshTunnelFailure };

export interface SshTunnelDependencies {
  spawn?: typeof import('node:child_process').spawn;
  /** Reserves and returns a free loopback port. */
  allocatePort?: () => Promise<number>;
  /** Probes whether the forward is actually accepting connections. */
  probeLocalPort?: (port: number) => Promise<boolean>;
  /** Whether a named private key file can be opened for reading here. */
  canReadIdentityFile?: (path: string) => boolean;
}

export const DEFAULT_CONNECT_TIMEOUT_SECONDS = 10;
const MAX_CONNECT_TIMEOUT_SECONDS = 120;
const LOOPBACK_HOST = '127.0.0.1';

/**
 * The forward is up the moment the local listener accepts, which is normally
 * within a few probes of the spawn. Retries are cheap loopback connects, so the
 * budget only exists to keep the schedule finite; the connect deadline below is
 * what actually ends a hopeless open (200 * 150ms = 30s, comfortably past the
 * default 12s deadline, so the deadline classifies rather than the budget).
 */
const PROBE_RETRY_MS = 150;
const PROBE_ATTEMPT_BUDGET = 200;
const PROBE_SOCKET_TIMEOUT_MS = 1_000;

/**
 * Give `ssh` a moment past its own ConnectTimeout before we give up on it. Its
 * exit carries stderr we can classify precisely; our deadline can only say
 * "unreachable". Preferring its answer makes the operator-facing failure more
 * accurate whenever `ssh` is able to produce one.
 */
const READINESS_GRACE_MS = 2_000;

/** SIGTERM, then SIGKILL, then stop waiting. Bounded so a wedged child cannot
 * wedge app shutdown; SIGKILL has already been delivered by then. */
const CLOSE_FORCE_AFTER_MS = 2_000;
const CLOSE_FAIL_AFTER_MS = 8_000;

/** stderr is captured only to classify a failure, so a rolling tail is enough.
 * Capping it keeps a chatty or hostile server from growing main's heap. */
const STDERR_CAPTURE_MAX = 8 * 1024;

const MESSAGE_MAX = 200;

/**
 * The fallback sentence for each class, used when nothing more precise is
 * known. Every string an operator ever reads is a literal in this file, which
 * is what makes the redaction invariant checkable: no code path interpolates a
 * host, user, port, or key path into a failure message.
 *
 * A class may have SEVERAL fixed sentences (see `SPECIFIC_MESSAGES` and
 * `INVALID_TARGET_REASONS`), because a class answers "what kind of failure"
 * and the sentence has to answer "which field did you get wrong". A manually
 * entered server is four fields the operator typed, so collapsing all four
 * mistakes into one sentence about the server being offline sends three of
 * them to the wrong place.
 */
const FAILURE_MESSAGES: Record<SshTunnelFailureClass, string> = {
  'invalid-target':
    'That SSH target cannot be used. Check the server details and the Gateway port, then try again.',
  'host-unreachable':
    'Could not reach that server over SSH. Check that it is online and reachable from this machine.',
  'auth-rejected':
    'The server refused the SSH login. Check that your key is loaded and authorized for that login.',
  'gateway-down':
    'The server was reached but the Gateway port did not forward. Check that the Gateway is running there.',
  unknown:
    'The SSH tunnel closed for an unrecognized reason. Open source diagnostics for the connection detail.',
};

/**
 * The sentences that name a FIELD rather than a category, keyed by what `ssh`
 * was able to tell us. Each stays inside its class, so the product's failure
 * vocabulary is unchanged and only the operator's next step gets sharper.
 */
const SPECIFIC_MESSAGES = {
  address_unresolved:
    'That server address could not be found. Check the hostname or IP address you entered for the server.',
  ssh_port_silent:
    'Nothing answered on that SSH port. Check the SSH port you entered, and that the server is online.',
  identity_file_refused:
    'That key file was refused. Check that it is the private key for this login and that only you can read it.',
  host_key_changed:
    'The server offered a different SSH host key than the one this machine already trusts. Verify the server first.',
} as const;

const INVALID_TARGET_REASONS = {
  alias:
    'That SSH alias is not usable. Use an alias from your SSH config made of letters, numbers, dots, dashes, or underscores.',
  server_host:
    'That server address is not usable. Use a hostname or an IPv4 address with no other characters.',
  user: 'That login name is not usable. Use a name made of letters, numbers, dots, dashes, or underscores.',
  ssh_port:
    'That SSH port is not usable. Use the port the server accepts SSH on, between 1 and 65535.',
  identity_file:
    'That key file path is not usable. Use the full path to the private key file, starting with a slash.',
  identity_file_unreadable:
    'That key file could not be read. Check the path to the private key file and that this account can open it.',
  remote_host:
    'That remote host is not usable. Use the loopback address the Gateway listens on, normally 127.0.0.1.',
  remote_port:
    'That remote port is not usable. Use the port the Gateway listens on, between 1 and 65535.',
  timeout: `That connect timeout is not usable. Use a whole number of seconds between 1 and ${MAX_CONNECT_TIMEOUT_SECONDS}.`,
  port_allocation:
    'Could not reserve a local port for the tunnel. Close other software holding loopback ports and try again.',
  launch:
    'Could not start ssh on this machine. Check that the OpenSSH client is installed and on the path.',
} as const;

type InvalidTargetReason = keyof typeof INVALID_TARGET_REASONS;

function bounded(text: string): string {
  return text.length <= MESSAGE_MAX
    ? text
    : `${text.slice(0, MESSAGE_MAX - 1)}…`;
}

function failure(failureClass: SshTunnelFailureClass): SshTunnelFailure {
  return {
    class: failureClass,
    message: bounded(FAILURE_MESSAGES[failureClass]),
  };
}

function invalidTarget(reason: InvalidTargetReason): SshTunnelFailure {
  return {
    class: 'invalid-target',
    message: bounded(INVALID_TARGET_REASONS[reason]),
  };
}

const ALIAS_PATTERN = /^[A-Za-z0-9._-]{1,255}$/;
const IPV4_PATTERN =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

const USER_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
/** Absolute, and nothing a terminal, a log line, or `ssh` could reinterpret. */
const IDENTITY_FILE_PATTERN = /^\/[^\u0000-\u0020\u007f]{1,511}$/;

/**
 * An alias is operator-supplied text that we hand to `ssh` as a bare argument,
 * and `ssh` parses any argument beginning with `-` as an OPTION. So an alias of
 * `-oProxyCommand=id` is not a bad hostname, it is arbitrary command execution
 * on this machine. The character class also excludes whitespace, quotes, and
 * shell metacharacters so the value stays inert if it is ever logged or echoed.
 *
 * This check runs before anything is spawned, and `buildDestinationArgs`
 * additionally places `--` ahead of the destination so neither guard alone is
 * load-bearing.
 */
function isSafeAlias(alias: unknown): alias is string {
  return (
    typeof alias === 'string' &&
    !alias.startsWith('-') &&
    ALIAS_PATTERN.test(alias)
  );
}

function isSafeHost(host: unknown): host is string {
  if (typeof host !== 'string' || host.startsWith('-')) return false;
  // An all-numeric host is an address, so hold it to address rules. DNS syntax
  // would happily accept `999.1.1.1` as a hostname, and accepting a mistyped
  // address as a name to resolve turns a typo into a lookup for a name the
  // operator never meant to send anywhere.
  if (/^[0-9.]+$/.test(host)) return IPV4_PATTERN.test(host);
  return HOSTNAME_PATTERN.test(host);
}

/**
 * The login name travels as the left half of `user@host`, so it is held to the
 * same rule as the alias: no leading dash, and none of the characters that
 * would let it grow a second destination, an option, or a shell word.
 */
function isSafeUser(user: unknown): user is string {
  return (
    typeof user === 'string' && !user.startsWith('-') && USER_PATTERN.test(user)
  );
}

/**
 * A key path reaches `ssh` as the value of `-i`, so a relative path or one
 * beginning with a dash is refused outright: requiring a leading slash rejects
 * every option-shaped value by construction. Whitespace and control characters
 * are refused for the reason the alias grammar refuses them: the value stays
 * one inert word wherever it is later printed, and a path that looks like two
 * arguments never reads as two.
 */
function isSafeIdentityFile(path: unknown): path is string {
  return typeof path === 'string' && IDENTITY_FILE_PATTERN.test(path);
}

function isPort(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= 1 &&
    (value as number) <= 65535
  );
}

/** Which part of a destination was refused. One reason, one fixed sentence. */
export type SshDestinationFault =
  | 'alias'
  | 'server_host'
  | 'user'
  | 'ssh_port'
  | 'identity_file';

/**
 * Validate one destination and rebuild it as a fresh literal, so unknown fields
 * on the input are dropped rather than carried toward `ssh`.
 */
export function resolveSshDestination(
  value: unknown
):
  | { ok: true; destination: SshDestination }
  | { ok: false; fault: SshDestinationFault } {
  if (!value || typeof value !== 'object') {
    return { ok: false, fault: 'alias' };
  }
  const candidate = value as Partial<Record<string, unknown>>;

  if (candidate.kind === 'ssh-manual') {
    if (!isSafeHost(candidate.host)) {
      return { ok: false, fault: 'server_host' };
    }
    if (!isSafeUser(candidate.user)) return { ok: false, fault: 'user' };
    if (!isPort(candidate.port)) return { ok: false, fault: 'ssh_port' };
    const identityFile = candidate.identityFile ?? null;
    if (identityFile !== null && !isSafeIdentityFile(identityFile)) {
      return { ok: false, fault: 'identity_file' };
    }
    return {
      ok: true,
      destination: {
        kind: 'ssh-manual',
        host: candidate.host,
        user: candidate.user,
        port: candidate.port,
        identityFile,
      },
    };
  }

  if (!isSafeAlias(candidate.alias)) return { ok: false, fault: 'alias' };
  return {
    ok: true,
    destination: { kind: 'ssh-alias', alias: candidate.alias },
  };
}

/**
 * The tail of every `ssh` argument vector: the options a destination needs,
 * then `--`, then the destination itself.
 *
 * - `-p` carries the SSH port for a manually entered server; an alias takes its
 *   port from the operator's own SSH configuration.
 * - `IdentitiesOnly=yes` accompanies `-i` so `ssh` offers the named key and
 *   nothing else. Without it an agent holding several keys offers them all and
 *   the server closes the connection with "too many authentication failures",
 *   which reads as a refused login rather than as the wrong key.
 * - `--` ends option parsing, so neither an alias nor a `user@host` can be read
 *   as an option even if validation above were ever weakened.
 *
 * Throws on an unusable destination. Callers validate first; the throw is the
 * last line of defence for anyone else.
 */
export function buildDestinationArgs(
  destination: SshDestination
): readonly string[] {
  const resolved = resolveSshDestination(destination);
  if (!resolved.ok) {
    throw new Error('Refusing to build an ssh command for an unusable target');
  }
  if (resolved.destination.kind === 'ssh-alias') {
    return ['--', resolved.destination.alias];
  }
  const { host, user, port, identityFile } = resolved.destination;
  return [
    '-p',
    String(port),
    ...(identityFile === null
      ? []
      : ['-o', 'IdentitiesOnly=yes', '-i', identityFile]),
    '--',
    `${user}@${host}`,
  ];
}

/**
 * Whether the named private key file can actually be opened here.
 *
 * `isSafeIdentityFile` above checks the SHAPE of the path, which is a security
 * check and says nothing about whether the file exists. Both bounds matter:
 * `isFile` refuses a directory or a device, whose read `ssh` would also refuse,
 * and the readability check is what separates "you typed the wrong path" from
 * "your key is not authorized".
 */
function defaultCanReadIdentityFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * True when a destination names a key file this machine cannot read.
 *
 * Checked BEFORE any connection, which is the whole point. `ssh` handed an
 * unreadable `-i` warns about it, offers nothing, and lets the server end the
 * session with `Permission denied (publickey)`. That is a REFUSED LOGIN: it
 * spends an authentication attempt on the operator's server, and it reports
 * back the one sentence that sends them to check authorization instead of the
 * path they just typed. Servers that ban on refused logins count that attempt.
 *
 * Exported so `gateway-bootstrap.ts` applies the same rule to the same field;
 * a second copy would be a second chance for the two to disagree.
 */
export function namesUnreadableIdentityFile(
  destination: SshDestination,
  canRead: (path: string) => boolean = defaultCanReadIdentityFile
): boolean {
  if (destination.kind !== 'ssh-manual') return false;
  const { identityFile } = destination;
  if (identityFile === null) return false;
  try {
    return canRead(identityFile) !== true;
  } catch {
    return true;
  }
}

const DESTINATION_FAULT_REASONS: Record<
  SshDestinationFault,
  InvalidTargetReason
> = {
  alias: 'alias',
  server_host: 'server_host',
  user: 'user',
  ssh_port: 'ssh_port',
  identity_file: 'identity_file',
};

interface ResolvedTarget {
  destination: SshDestination;
  remoteHost: string;
  remotePort: number;
  connectTimeoutSeconds: number;
}

function resolveTarget(
  target: SshTunnelTarget
):
  | { ok: true; target: ResolvedTarget }
  | { ok: false; failure: SshTunnelFailure } {
  if (!target || typeof target !== 'object') {
    return { ok: false, failure: invalidTarget('alias') };
  }
  const destination = resolveSshDestination(target);
  if (!destination.ok) {
    return {
      ok: false,
      failure: invalidTarget(DESTINATION_FAULT_REASONS[destination.fault]),
    };
  }
  const remoteHost = target.remoteHost ?? LOOPBACK_HOST;
  if (!isSafeHost(remoteHost)) {
    return { ok: false, failure: invalidTarget('remote_host') };
  }
  if (!isPort(target.remotePort)) {
    return { ok: false, failure: invalidTarget('remote_port') };
  }
  const connectTimeoutSeconds =
    target.connectTimeoutSeconds ?? DEFAULT_CONNECT_TIMEOUT_SECONDS;
  if (
    !Number.isInteger(connectTimeoutSeconds) ||
    connectTimeoutSeconds < 1 ||
    connectTimeoutSeconds > MAX_CONNECT_TIMEOUT_SECONDS
  ) {
    return { ok: false, failure: invalidTarget('timeout') };
  }
  return {
    ok: true,
    target: {
      destination: destination.destination,
      remoteHost,
      remotePort: target.remotePort,
      connectTimeoutSeconds,
    },
  };
}

/**
 * The exact argument vector, never a command string. `openSshTunnel` validates
 * the target before calling this, so every value below is already known inert.
 *
 * Each option earns its place:
 * - `-N` runs no remote command; this connection exists only to carry a forward.
 * - `-T` allocates no TTY, so nothing on the far side can drive a terminal.
 * - `BatchMode=yes` never prompts. A password or passphrase prompt on a child
 *   with no TTY would hang forever and take the connect flow with it.
 * - `ExitOnForwardFailure=yes` turns a forward that could not be established
 *   into a process exit we can classify, instead of a live SSH session that
 *   silently forwards nothing.
 * - `ConnectTimeout` bounds the TCP/handshake phase inside `ssh` itself.
 * - `StrictHostKeyChecking=accept-new` accepts a first-sight host key but still
 *   refuses a CHANGED one, which is the case that means interception.
 * - The destination tail from `buildDestinationArgs` ends with `--`, so neither
 *   an alias nor a `user@host` can ever be read as an option.
 */
export function buildSshArgs(
  target: SshTunnelTarget,
  localPort: number
): readonly string[] {
  const resolved = resolveTarget(target);
  if (!resolved.ok) {
    throw new Error('Refusing to build an ssh command for an unusable target');
  }
  return buildArgsFor(resolved.target, localPort);
}

function buildArgsFor(
  target: ResolvedTarget,
  localPort: number
): readonly string[] {
  const { remoteHost, connectTimeoutSeconds } = target;
  return [
    '-N',
    '-T',
    '-o',
    'BatchMode=yes',
    '-o',
    'ExitOnForwardFailure=yes',
    '-o',
    `ConnectTimeout=${connectTimeoutSeconds}`,
    '-o',
    'StrictHostKeyChecking=accept-new',
    // Exawatt owns its own connection, never a shared multiplexed one.
    //
    // Found against a real server: with `ControlMaster auto` and a live
    // control socket, `ssh -N -L ...` hands the forward to the existing master
    // and exits 0 immediately. That looked like a failure here, but the worse
    // half is what happens when it looks like success: the forward belongs to
    // the master, so killing this child would leave a port open to the
    // operator's server after Exawatt believed it had detached. Owning the
    // connection is what makes close() mean what it says.
    '-o',
    'ControlMaster=no',
    '-o',
    'ControlPath=none',
    '-L',
    `${LOOPBACK_HOST}:${localPort}:${remoteHost}:${target.remotePort}`,
    ...buildDestinationArgs(target.destination),
  ];
}

/**
 * Ordered because the phrases overlap, and the first match wins.
 *
 * Forward failures come FIRST. `ssh` reports a failed forward with the same
 * words it uses for a failed connection: `channel 1: open failed: connect
 * failed: Connection refused` is the Gateway not listening on the far side,
 * while `ssh: connect to host ... port 22: Connection refused` is the server
 * itself being unreachable. Matching the forward-specific phrasing before the
 * generic transport phrasing is what keeps those two apart, and it is the
 * difference between telling the operator to start their Gateway and telling
 * them their server is down.
 *
 * Authentication comes second: its phrases are unambiguous, and a rejected
 * login is never a forward problem. Transport comes last, as the general case.
 */
const STDERR_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  failureClass: SshTunnelFailureClass;
  /** Names the field the operator got wrong, when `ssh` said which it was. */
  message?: string;
}> = [
  { pattern: /channel\s+.*open failed/i, failureClass: 'gateway-down' },
  { pattern: /open failed:\s*connect failed/i, failureClass: 'gateway-down' },
  { pattern: /administratively prohibited/i, failureClass: 'gateway-down' },
  { pattern: /remote port forwarding failed/i, failureClass: 'gateway-down' },
  { pattern: /bind:\s*address already in use/i, failureClass: 'gateway-down' },
  { pattern: /cannot listen to port/i, failureClass: 'gateway-down' },

  /*
   * The key-file phrases come BEFORE the generic refusal phrases, and the
   * order is the whole point. A live run against a real server proved that an
   * unreadable or wrongly permissioned `-i` never arrives ALONE: `ssh` warns
   * about the key, offers nothing, and the server then ends the session with
   * `Permission denied (publickey).` With these entries below that phrase they
   * could never win a match, so the key cases were dead entries and the
   * operator was told to check authorization for a key the client had already
   * refused to load.
   *
   * Only a manually entered server can produce them: an alias takes its key
   * from the operator's own SSH configuration, while a manual destination
   * names a key file that may be missing, unreadable, or the wrong one.
   */
  {
    pattern: /identity file .* not accessible/i,
    failureClass: 'auth-rejected',
    message: SPECIFIC_MESSAGES.identity_file_refused,
  },
  {
    pattern: /no such identity/i,
    failureClass: 'auth-rejected',
    message: SPECIFIC_MESSAGES.identity_file_refused,
  },
  {
    pattern: /bad permissions/i,
    failureClass: 'auth-rejected',
    message: SPECIFIC_MESSAGES.identity_file_refused,
  },
  {
    pattern: /unprotected private key file/i,
    failureClass: 'auth-rejected',
    message: SPECIFIC_MESSAGES.identity_file_refused,
  },
  {
    pattern: /invalid format|error in libcrypto/i,
    failureClass: 'auth-rejected',
    message: SPECIFIC_MESSAGES.identity_file_refused,
  },

  // A CHANGED host key is the case that means interception, so it gets its
  // own sentence rather than the one about checking your key.
  {
    pattern:
      /host key verification failed|remote host identification has changed/i,
    failureClass: 'auth-rejected',
    message: SPECIFIC_MESSAGES.host_key_changed,
  },

  { pattern: /permission denied/i, failureClass: 'auth-rejected' },
  { pattern: /publickey/i, failureClass: 'auth-rejected' },
  {
    pattern: /too many authentication failures/i,
    failureClass: 'auth-rejected',
  },

  /*
   * A name that does not resolve and a port nothing answers are one class and
   * two different mistakes. The first is the address field; the second is the
   * port field, or a server that is genuinely down. Resolution failures are
   * matched first because `ssh` reports them before it ever tries to connect.
   */
  {
    pattern: /could not resolve hostname/i,
    failureClass: 'host-unreachable',
    message: SPECIFIC_MESSAGES.address_unresolved,
  },
  {
    pattern: /name or service not known|nodename nor servname/i,
    failureClass: 'host-unreachable',
    message: SPECIFIC_MESSAGES.address_unresolved,
  },
  {
    pattern: /no route to host/i,
    failureClass: 'host-unreachable',
    message: SPECIFIC_MESSAGES.ssh_port_silent,
  },
  {
    pattern: /network is unreachable/i,
    failureClass: 'host-unreachable',
    message: SPECIFIC_MESSAGES.ssh_port_silent,
  },
  {
    pattern: /operation timed out/i,
    failureClass: 'host-unreachable',
    message: SPECIFIC_MESSAGES.ssh_port_silent,
  },
  {
    pattern: /connection timed out/i,
    failureClass: 'host-unreachable',
    message: SPECIFIC_MESSAGES.ssh_port_silent,
  },
  {
    pattern: /connection refused/i,
    failureClass: 'host-unreachable',
    message: SPECIFIC_MESSAGES.ssh_port_silent,
  },
];

export function classifySshStderr(text: string): SshTunnelFailureClass {
  return classifySshFailure(text).class;
}

/**
 * The class AND the sentence, from one pass over the captured stderr. Callers
 * want both, and deriving them separately would let the two drift apart.
 */
export function classifySshFailure(text: string): SshTunnelFailure {
  if (typeof text !== 'string' || text.length === 0) return failure('unknown');
  for (const entry of STDERR_PATTERNS) {
    if (entry.pattern.test(text)) {
      return {
        class: entry.failureClass,
        message: bounded(entry.message ?? FAILURE_MESSAGES[entry.failureClass]),
      };
    }
  }
  return failure('unknown');
}

/**
 * Bind port 0 on loopback, read what the kernel assigned, release it.
 *
 * This is inherently racy: between our close and `ssh` binding the same port,
 * another process on this machine could take it. That race is survivable only
 * because of `ExitOnForwardFailure=yes` in the argument vector above. With it,
 * losing the race makes `ssh` exit with a local-bind error that classifies as
 * `gateway-down`, and the operator retries into a different port. Without it,
 * `ssh` would stay up forwarding nothing and we would report a healthy tunnel
 * pointed at whatever else grabbed the port.
 */
async function defaultAllocatePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen({ host: LOOPBACK_HOST, port: 0 }, () => {
      const address = server.address();
      const port =
        address && typeof address === 'object' ? address.port : undefined;
      server.close(() => {
        if (typeof port === 'number' && port > 0) resolve(port);
        else reject(new Error('Loopback port reservation returned no port'));
      });
    });
  });
}

/**
 * A connect that succeeds is the only proof the forward is live; `ssh` being
 * alive is not. The socket is destroyed immediately so probing never consumes
 * a Gateway connection slot or leaves a half-open connection behind.
 */
async function defaultProbeLocalPort(port: number): Promise<boolean> {
  return await new Promise<boolean>(resolve => {
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ready);
    };
    const socket = createConnection({ host: LOOPBACK_HOST, port });
    socket.setTimeout(PROBE_SOCKET_TIMEOUT_MS);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/**
 * The live tunnel. It owns the child from readiness onward and is the only
 * thing that may report why it ended: a deliberate `close` reports `null`, and
 * any other exit is classified from the captured stderr.
 */
class OwnedSshTunnel implements SshTunnel {
  readonly localPort: number;

  private readonly child: ChildProcess;
  private readonly readStderr: () => string;
  private readonly listeners = new Set<
    (failure: SshTunnelFailure | null) => void
  >();

  private settled = false;
  private endedWith: SshTunnelFailure | null = null;
  private deliberate = false;
  private closing: Promise<void> | null = null;

  constructor(
    child: ChildProcess,
    localPort: number,
    readStderr: () => string
  ) {
    this.child = child;
    this.localPort = localPort;
    this.readStderr = readStderr;

    this.child.on('exit', () => this.settle());
    // A child-level error after readiness (for example a failed signal) still
    // ends the tunnel; it must not surface as an unhandled 'error' event.
    this.child.on('error', () => this.settle());
  }

  get closed(): boolean {
    return this.settled;
  }

  /**
   * Idempotent. An orphaned `ssh` would hold a loopback port and keep an
   * authenticated connection to the operator's server open with nothing
   * watching it, so shutdown escalates SIGTERM to SIGKILL rather than waiting.
   * The bounded wait then resolves either way: by that point SIGKILL has been
   * delivered, and leaving the caller wedged would be the worse failure.
   */
  close(): Promise<void> {
    this.deliberate = true;
    if (!this.closing) {
      this.closing = stopChildProcess(this.child, {
        forceAfterMs: CLOSE_FORCE_AFTER_MS,
        failAfterMs: CLOSE_FAIL_AFTER_MS,
        failureMessage: 'The SSH tunnel process did not exit',
      })
        .catch(() => undefined)
        .then(() => {
          this.settle();
        });
    }
    return this.closing;
  }

  /**
   * Fires at most once per listener. Subscribing after the tunnel has already
   * ended delivers the recorded outcome immediately, so a caller can never miss
   * the notification by racing the child's exit.
   */
  onClosed(listener: (failure: SshTunnelFailure | null) => void): () => void {
    if (this.settled) {
      listener(this.endedWith);
      return () => undefined;
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private settle(): void {
    if (this.settled) return;
    this.settled = true;
    this.endedWith = this.deliberate
      ? null
      : classifySshFailure(this.readStderr());
    const pending = [...this.listeners];
    this.listeners.clear();
    for (const listener of pending) {
      try {
        listener(this.endedWith);
      } catch {
        // A subscriber's failure is not this tunnel's failure, and the
        // remaining subscribers still deserve the notification.
      }
    }
  }
}

/**
 * Open a bounded, read-only transport to a source's loopback Gateway.
 *
 * Fails closed at every step: an unusable target never spawns, an exit before
 * readiness is classified from stderr rather than retried blindly, and a
 * connect deadline with neither readiness nor exit kills the child instead of
 * leaving a connection to the operator's server open with nothing watching it.
 */
export async function openSshTunnel(
  target: SshTunnelTarget,
  deps: SshTunnelDependencies = {}
): Promise<OpenSshTunnelResult> {
  const resolved = resolveTarget(target);
  if (!resolved.ok) return { ok: false, failure: resolved.failure };

  const spawnProcess = deps.spawn ?? nodeSpawn;
  const allocatePort = deps.allocatePort ?? defaultAllocatePort;
  const probeLocalPort = deps.probeLocalPort ?? defaultProbeLocalPort;

  // Before a port is reserved and before anything is spawned: a key file this
  // machine cannot read is a mistake in the target, not a refusal by the
  // server, and attempting the login anyway would spend a refused login on the
  // operator's server to learn something already knowable here.
  if (
    namesUnreadableIdentityFile(
      resolved.target.destination,
      deps.canReadIdentityFile ?? defaultCanReadIdentityFile
    )
  ) {
    return { ok: false, failure: invalidTarget('identity_file_unreadable') };
  }

  let localPort: number;
  try {
    localPort = await allocatePort();
  } catch {
    return { ok: false, failure: invalidTarget('port_allocation') };
  }
  if (!isPort(localPort)) {
    return { ok: false, failure: invalidTarget('port_allocation') };
  }

  const args = buildArgsFor(resolved.target, localPort);

  let child: ChildProcess;
  try {
    child = spawnProcess('ssh', args, {
      // An argument array with no shell. There is no command string anywhere in
      // this module, so there is nothing for a shell to reinterpret.
      shell: false,
      // stdin is closed because BatchMode means nothing may prompt; stdout is
      // silent under -N; stderr is the only channel we read, and only to
      // classify a failure.
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
  } catch {
    return { ok: false, failure: invalidTarget('launch') };
  }

  // A ChildProcess with no 'error' listener throws on emit, and this child can
  // fail asynchronously long after any one phase has stopped listening. This
  // permanent no-op keeps that structural hazard out of every later branch.
  child.on('error', () => undefined);

  let stderrTail = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderrTail = (stderrTail + String(chunk)).slice(-STDERR_CAPTURE_MAX);
  });
  const readStderr = () => stderrTail;

  return await new Promise<OpenSshTunnelResult>(resolve => {
    let settled = false;
    let attempts = 0;
    let probeTimer: ReturnType<typeof setTimeout> | undefined;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;

    const detach = () => {
      clearTimeout(probeTimer);
      clearTimeout(deadlineTimer);
      child.off('exit', onExit);
      child.off('error', onError);
      // The stderr listener stays attached: after readiness the live tunnel
      // classifies an unexpected death from the same rolling buffer.
    };

    const fail = (ended: SshTunnelFailure) => {
      if (settled) return;
      settled = true;
      detach();
      // No half-open child survives a failed open. stopChildProcess returns
      // immediately when the child has already exited.
      void stopChildProcess(child, {
        forceAfterMs: CLOSE_FORCE_AFTER_MS,
        failAfterMs: CLOSE_FAIL_AFTER_MS,
        failureMessage: 'The SSH tunnel process did not exit',
      }).catch(() => undefined);
      resolve({ ok: false, failure: ended });
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      detach();
      resolve({
        ok: true,
        tunnel: new OwnedSshTunnel(child, localPort, readStderr),
      });
    };

    function onExit() {
      // ExitOnForwardFailure makes a broken forward an exit, so an exit before
      // readiness always carries a classifiable reason in stderr.
      fail(classifySshFailure(readStderr()));
    }

    function onError() {
      fail(failure('unknown'));
    }

    child.once('exit', onExit);
    child.once('error', onError);

    // Readiness is driven by the probe's own result, not by waiting out a fixed
    // delay: each answer either finishes the open or schedules exactly one more
    // attempt, and the deadline below ends the schedule from the outside.
    const attempt = () => {
      if (settled) return;
      attempts += 1;
      const onAnswer = (ready: boolean) => {
        if (settled) return;
        if (ready) {
          succeed();
          return;
        }
        if (attempts >= PROBE_ATTEMPT_BUDGET) {
          // ssh is still alive and the local forward never accepted, which is
          // the far side not listening rather than the server being down.
          fail(failure('gateway-down'));
          return;
        }
        probeTimer = setTimeout(attempt, PROBE_RETRY_MS);
      };
      probeLocalPort(localPort).then(
        ready => onAnswer(ready === true),
        () => onAnswer(false)
      );
    };

    deadlineTimer = setTimeout(
      () => fail(failure('host-unreachable')),
      resolved.target.connectTimeoutSeconds * 1_000 + READINESS_GRACE_MS
    );

    attempt();
  });
}

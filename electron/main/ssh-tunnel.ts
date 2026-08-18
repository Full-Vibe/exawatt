import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
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
 * 1. Nothing operator-controlled may reach `ssh` as an option. An SSH alias is
 *    a string the operator types or picks, and `ssh` reads a leading dash as an
 *    option, so an unvalidated alias is remote code execution on this machine
 *    (see `isSafeAlias`).
 * 2. No failure detail may carry infrastructure identity. `ssh` stderr names
 *    hosts, users, ports, and key paths; those never leave this module. Each
 *    failure class maps to one fixed operator-facing sentence instead.
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

export interface SshTunnelTarget {
  /** An alias from the operator's own SSH config. */
  alias: string;
  /** Port the Gateway listens on, on the remote loopback interface. */
  remotePort: number;
  /** Defaults to 127.0.0.1. */
  remoteHost?: string;
  connectTimeoutSeconds?: number;
}

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
 * One fixed sentence per class. These are the only strings that ever reach the
 * operator, which is what makes the redaction invariant checkable: no code path
 * interpolates a host, user, port, or key path into a failure message.
 */
const FAILURE_MESSAGES: Record<SshTunnelFailureClass, string> = {
  'invalid-target':
    'That SSH target cannot be used. Check the alias, remote host, and remote port, then try again.',
  'host-unreachable':
    'Could not reach that server over SSH. Check that it is online and reachable from this machine.',
  'auth-rejected':
    'The server refused the SSH login. Check that your key is loaded and authorized for this alias.',
  'gateway-down':
    'The server was reached but the Gateway port did not forward. Check that the Gateway is running there.',
  unknown:
    'The SSH tunnel closed for an unrecognized reason. Open source diagnostics for the connection detail.',
};

const INVALID_TARGET_REASONS = {
  alias:
    'That SSH alias is not usable. Use an alias from your SSH config made of letters, numbers, dots, dashes, or underscores.',
  host: 'That remote host is not usable. Use the loopback address the Gateway listens on, normally 127.0.0.1.',
  port: 'That remote port is not usable. Use the port the Gateway listens on, between 1 and 65535.',
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

/**
 * An alias is operator-supplied text that we hand to `ssh` as a bare argument,
 * and `ssh` parses any argument beginning with `-` as an OPTION. So an alias of
 * `-oProxyCommand=id` is not a bad hostname, it is arbitrary command execution
 * on this machine. The character class also excludes whitespace, quotes, and
 * shell metacharacters so the value stays inert if it is ever logged or echoed.
 *
 * This check runs before anything is spawned, and `buildSshArgs` additionally
 * places `--` ahead of the alias so neither guard alone is load-bearing.
 */
function isSafeAlias(alias: unknown): alias is string {
  return (
    typeof alias === 'string' &&
    !alias.startsWith('-') &&
    ALIAS_PATTERN.test(alias)
  );
}

function isSafeRemoteHost(host: unknown): host is string {
  if (typeof host !== 'string' || host.startsWith('-')) return false;
  // An all-numeric host is an address, so hold it to address rules. DNS syntax
  // would happily accept `999.1.1.1` as a hostname, and accepting a mistyped
  // address as a name to resolve turns a typo into a lookup for a name the
  // operator never meant to send anywhere.
  if (/^[0-9.]+$/.test(host)) return IPV4_PATTERN.test(host);
  return HOSTNAME_PATTERN.test(host);
}

function isPort(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= 1 &&
    (value as number) <= 65535
  );
}

interface ResolvedTarget {
  alias: string;
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
  if (!isSafeAlias(target.alias)) {
    return { ok: false, failure: invalidTarget('alias') };
  }
  const remoteHost = target.remoteHost ?? LOOPBACK_HOST;
  if (!isSafeRemoteHost(remoteHost)) {
    return { ok: false, failure: invalidTarget('host') };
  }
  if (!isPort(target.remotePort)) {
    return { ok: false, failure: invalidTarget('port') };
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
      alias: target.alias,
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
 * - `--` ends option parsing so the alias can never be read as an option.
 */
export function buildSshArgs(
  target: SshTunnelTarget,
  localPort: number
): readonly string[] {
  const remoteHost = target.remoteHost ?? LOOPBACK_HOST;
  const connectTimeoutSeconds =
    target.connectTimeoutSeconds ?? DEFAULT_CONNECT_TIMEOUT_SECONDS;
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
    '--',
    target.alias,
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
}> = [
  { pattern: /channel\s+.*open failed/i, failureClass: 'gateway-down' },
  { pattern: /open failed:\s*connect failed/i, failureClass: 'gateway-down' },
  { pattern: /administratively prohibited/i, failureClass: 'gateway-down' },
  { pattern: /remote port forwarding failed/i, failureClass: 'gateway-down' },
  { pattern: /bind:\s*address already in use/i, failureClass: 'gateway-down' },
  { pattern: /cannot listen to port/i, failureClass: 'gateway-down' },

  { pattern: /permission denied/i, failureClass: 'auth-rejected' },
  { pattern: /publickey/i, failureClass: 'auth-rejected' },
  {
    pattern: /too many authentication failures/i,
    failureClass: 'auth-rejected',
  },
  {
    pattern: /host key verification failed/i,
    failureClass: 'auth-rejected',
  },

  { pattern: /could not resolve hostname/i, failureClass: 'host-unreachable' },
  { pattern: /name or service not known/i, failureClass: 'host-unreachable' },
  { pattern: /no route to host/i, failureClass: 'host-unreachable' },
  { pattern: /network is unreachable/i, failureClass: 'host-unreachable' },
  { pattern: /operation timed out/i, failureClass: 'host-unreachable' },
  { pattern: /connection timed out/i, failureClass: 'host-unreachable' },
  { pattern: /connection refused/i, failureClass: 'host-unreachable' },
];

export function classifySshStderr(text: string): SshTunnelFailureClass {
  if (typeof text !== 'string' || text.length === 0) return 'unknown';
  for (const { pattern, failureClass } of STDERR_PATTERNS) {
    if (pattern.test(text)) return failureClass;
  }
  return 'unknown';
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
      : failure(classifySshStderr(this.readStderr()));
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

  let localPort: number;
  try {
    localPort = await allocatePort();
  } catch {
    return { ok: false, failure: invalidTarget('port_allocation') };
  }
  if (!isPort(localPort)) {
    return { ok: false, failure: invalidTarget('port_allocation') };
  }

  const args = buildSshArgs(resolved.target, localPort);

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

    const fail = (failureClass: SshTunnelFailureClass) => {
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
      resolve({ ok: false, failure: failure(failureClass) });
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
      fail(classifySshStderr(readStderr()));
    }

    function onError() {
      fail('unknown');
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
          fail('gateway-down');
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
      () => fail('host-unreachable'),
      resolved.target.connectTimeoutSeconds * 1_000 + READINESS_GRACE_MS
    );

    attempt();
  });
}

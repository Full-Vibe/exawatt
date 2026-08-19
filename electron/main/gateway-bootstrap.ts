import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SourceTransport } from '@exawatt/core';
import { readGatewayConfig, type OCGatewayConfig } from '@exawatt/core/server';
import { stopChildProcess } from './child-process-lifecycle';
import {
  buildDestinationArgs,
  namesUnreadableIdentityFile,
  resolveSshDestination,
  type SshDestination,
} from './ssh-tunnel';

/**
 * ENG-010 C1: the one-time, bounded credential bootstrap for a source's own
 * loopback Gateway.
 *
 * The Gateway a source runs listens on loopback and authenticates with a shared
 * token that lives in that machine's own OpenClaw configuration. Exawatt must
 * not make the operator go find and paste it, so this module reads the token
 * the source declares, hands it back in memory, and forgets it.
 *
 * A configured source is reached one of two ways, and `resolveGatewayCredential`
 * is the single seam that picks between them:
 *
 * - **Over SSH**, for a server the operator reaches with an alias or with
 *   manually entered host, login, port, and key. The read happens on the far
 *   side, over the connection the operator already authorized.
 * - **Locally**, for the operator's own machine, whose Gateway is one more
 *   configured source. There is no hop, no `ssh`, and nothing to execute: the
 *   configuration is right here, so it is simply read.
 *
 * THIS IS A BOOTSTRAP READ, NOT THE FLEET CONTRACT.
 *
 * The fleet contract is the OpenClaw Gateway WebSocket protocol, reached
 * through the SSH-forwarded tunnel in `ssh-tunnel.ts`. Remote shell scraping
 * must never become how Exawatt observes Agents: it has no events, no scopes,
 * no schema, and no revocation story. This module exists to obtain exactly one
 * credential exactly once so the Gateway pairing can happen, and nothing else
 * may be added to it. If a future milestone wants another remote fact, the
 * answer is a Gateway method, not another command here.
 *
 * The credential's custody is documented in the project brief: the shared
 * secret returned by a credential resolution is held in process memory for
 * one pairing and used once, to mint a scoped, per-device, revocable Gateway
 * token. That device token is what gets persisted. The shared secret is
 * admin-capable and must never be written to disk, to the keychain, to
 * diagnostics, or to a log line. See `GatewayBootstrapFacts.sharedToken`.
 *
 * Two security properties carry this module, the same two that carry
 * `ssh-tunnel.ts`:
 *
 * 1. Nothing operator-controlled or source-supplied may reach `ssh` as an
 *    option or as shell syntax. Destinations are validated by
 *    `resolveSshDestination`, which `ssh-tunnel.ts` owns so there is exactly
 *    one copy of that rule; remote arguments are validated here (see
 *    `isSafeRemoteArgument`).
 * 2. No failure detail may carry infrastructure identity. `ssh` stderr names
 *    hosts, users, ports, and key paths; it never leaves this module. A failure
 *    resolves to one of a fixed set of sentences written in this file instead,
 *    and nothing is ever interpolated into one.
 */

export interface RemoteExecResult {
  /** Process exit code, or null when the command was killed at our deadline. */
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs one bounded, non-interactive command on the source over SSH. */
export type RemoteExec = (
  destination: SshDestination,
  argv: readonly string[]
) => Promise<RemoteExecResult>;

/**
 * This machine's own OpenClaw installation, as the local path reads it.
 *
 * Injected so the local credential path is testable without touching the
 * operator's real configuration or their real secrets. The default reads the
 * same files OpenClaw itself does.
 */
export interface LocalGatewaySource {
  /** Parsed `openclaw.json`, or null when it cannot be read or parsed. */
  readConfig(): OCGatewayConfig | null;
  /** Bounded read of one named secret file, or null when there is not one. */
  readSecret(name: string): string | null;
}

export type GatewayBootstrapFailure =
  /** Rejected before anything ran: the target itself is not usable. */
  | 'invalid-target'
  /** DNS, routing, refused, or a connect timeout. */
  | 'unreachable'
  /** The server answered and refused the login. */
  | 'auth-rejected'
  /** The server was reached but OpenClaw is not installed or not on PATH. */
  | 'openclaw-missing'
  /** Reached and readable, but the source declares no usable shared token. */
  | 'token-unavailable'
  /** The configuration could not be read at all. */
  | 'unreadable-config'
  /** None of the above; the operator gets diagnostics, not a guess. */
  | 'unknown';

export interface GatewayBootstrapFacts {
  /** The source's own reported version string, or null when unreadable. */
  version: string | null;
  /** Loopback port the Gateway listens on. */
  gatewayPort: number;
  /**
   * Held in memory by the caller for one pairing, never persisted.
   *
   * This is the source's admin-capable shared secret. The caller uses it once,
   * to pair Exawatt's device identity for the scopes the current milestone
   * needs, persists the scoped device token the Gateway returns, and drops
   * this value. It must not be written to disk, to the OS keychain, to
   * diagnostics, to analytics, or to any log line, and it must not cross into
   * renderer state.
   */
  sharedToken: string;
  /**
   * How the token was obtained, for the source-detail evidence surface.
   *
   * `secret-file` is the indirection case: the configuration named where the
   * secret lives rather than holding it, and the named file was read.
   */
  tokenSource: 'cli' | 'config-file' | 'secret-file';
}

export type GatewayBootstrapResult =
  | { ok: true; facts: GatewayBootstrapFacts }
  | { ok: false; failure: GatewayBootstrapFailure; message: string };

/** Matches `ssh-tunnel.ts`. One handshake budget for a one-time read. */
const CONNECT_TIMEOUT_SECONDS = 10;

/** A version print or a small JSON read. Anything slower is a dead connection. */
const DEFAULT_EXEC_TIMEOUT_MS = 20_000;
const MIN_EXEC_TIMEOUT_MS = 1_000;
const MAX_EXEC_TIMEOUT_MS = 120_000;

/**
 * Output is captured only to parse a version, a token, and a port. Capping it
 * keeps a chatty or hostile server from growing Electron main's heap on what is
 * supposed to be a three-command bootstrap.
 */
const OUTPUT_CAPTURE_MAX = 256 * 1024;

/** Generous for any real shared secret, small enough to stay a bound. */
const MAX_TOKEN_LENGTH = 16_384;

/** Only used when the source does not declare one. Never assumed instead. */
export const FALLBACK_GATEWAY_PORT = 1337;

/**
 * Relative, so it resolves against the login user's home directory on the far
 * side without depending on `~` surviving argument handling.
 */
const REMOTE_CONFIG_PATH = '.openclaw/openclaw.json';

/** Where OpenClaw keeps the secrets its configuration points at. */
const LOCAL_STATE_DIR_NAME = '.openclaw';
const LOCAL_SECRETS_DIR_NAME = 'secrets';

/**
 * A secret name becomes a filename, so it is held to an identifier grammar with
 * no dot and no separator. `..` cannot be spelled, so no configuration value
 * can walk out of the secrets directory.
 */
const SECRET_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const MAX_REMOTE_ARGV = 16;
const MESSAGE_MAX = 200;

/**
 * Our own marker for "ssh could not be started on THIS machine". It is a fixed
 * constant rather than an OS error string precisely because everything in the
 * `stderr` field is treated as untrusted, host-naming text.
 */
const SSH_LAUNCH_FAILED = 'exawatt:ssh-launch-failed';

/**
 * The fallback sentence for each class, used when nothing more precise is
 * known. Every string an operator ever reads is a literal in this file, which
 * is what makes the redaction invariant checkable: no code path interpolates a
 * host, user, port, key path, or token into a failure message.
 *
 * A class may have several fixed sentences (see `SPECIFIC_MESSAGES`), because
 * the class says what kind of failure it was and the sentence has to say which
 * field the operator got wrong.
 */
const FAILURE_MESSAGES: Record<GatewayBootstrapFailure, string> = {
  'invalid-target':
    'That server target is not usable. Check the SSH alias, or the host, login, port, and key file you entered.',
  unreachable:
    'Could not reach that server over SSH. Check that it is online and reachable from this machine.',
  // Not "authorized for this alias": a manually entered server has no alias,
  // and this module serves both transports.
  'auth-rejected':
    'The server refused the SSH login. Check that your key is loaded and authorized for that login.',
  'openclaw-missing':
    'OpenClaw was not found on that server. Check that it is installed for this login and try again.',
  'token-unavailable':
    'No Gateway token could be read from that OpenClaw configuration. You can paste the token from it instead.',
  'unreadable-config':
    'Could not read the OpenClaw configuration for that source. Check that it exists and is readable, then try again.',
  unknown:
    'The Gateway credential could not be read for an unrecognized reason. Open source diagnostics for the connection detail.',
};

/**
 * The sentences that name a FIELD rather than a category. Each stays inside an
 * existing class, so the product's failure vocabulary is unchanged and only the
 * operator's next step gets sharper.
 */
const SPECIFIC_MESSAGES = {
  identity_file_unreadable:
    'That key file could not be read. Check the path to the private key file and that this account can open it.',
  identity_file_refused:
    'That key file was refused. Check that it is the private key for this login and that only you can read it.',
  address_unresolved:
    'That server address could not be found. Check the hostname or IP address you entered for the server.',
  ssh_port_silent:
    'Nothing answered on that SSH port. Check the SSH port you entered, and that the server is online.',
  host_key_changed:
    'The server offered a different SSH host key than the one this machine already trusts. Verify the server first.',
} as const;

function bounded(text: string): string {
  return text.length <= MESSAGE_MAX
    ? text
    : `${text.slice(0, MESSAGE_MAX - 1)}…`;
}

function failed(
  failure: GatewayBootstrapFailure,
  message: string = FAILURE_MESSAGES[failure]
): GatewayBootstrapResult {
  return { ok: false, failure, message: bounded(message) };
}

/**
 * `ssh alias cmd arg arg` does not exec an argument vector on the far side: it
 * joins the remaining arguments with spaces and hands the result to the remote
 * LOGIN SHELL, which parses it again. `shell: false` locally therefore protects
 * this machine and nothing else, so every remote argument is checked against a
 * conservative allowlist here.
 *
 * The allowlist admits letters, digits, and the punctuation the three commands
 * in this module actually need: `.` `_` `-` `/` `=` `:` `@` `+` `,`. It admits
 * none of `;` `|` `&` `$` backtick newline quote `>` `<` `(` `)` `*` `?` `\`
 * `#` `~` or whitespace, which is the entire set that could turn a remote
 * argument into a second remote command.
 *
 * Everything this module runs is a literal written in this file. The check
 * exists so that stays true: a source-supplied string, an operator-typed path,
 * or a future caller's parameter must never be able to reach `ssh` and become a
 * command.
 */
function isSafeRemoteArgument(value: unknown): value is string {
  return (
    typeof value === 'string' && /^[A-Za-z0-9._:@+,=/-]{1,512}$/.test(value)
  );
}

/**
 * The exact argument vector, never a command string.
 *
 * Each option earns its place:
 * - `-T` allocates no TTY, so nothing on the far side can drive a terminal.
 * - `BatchMode=yes` never prompts. A password or passphrase prompt on a child
 *   with no TTY would hang forever and take the connect flow with it.
 * - `ConnectTimeout` bounds the TCP/handshake phase inside `ssh` itself, so the
 *   common failure is classified by `ssh` rather than by our outer deadline.
 * - `StrictHostKeyChecking=accept-new` accepts a first-sight host key but still
 *   refuses a CHANGED one, which is the case that means interception.
 * - `ControlMaster=no` with `ControlPath=none` refuses connection multiplexing,
 *   for a reason a live run proved rather than a reason of principle. With the
 *   operator's own `ControlMaster auto` in effect and a control socket already
 *   open to that server, these commands ride the existing master and NO
 *   AUTHENTICATION HAPPENS AT ALL. A manually entered server whose key file did
 *   not exist bootstrapped successfully that way. That is the worst possible
 *   failure for this module: Exawatt tells the operator their details work,
 *   saves them, and the source breaks the moment the operator's own session
 *   expires. Owning the connection is what makes this read a real test of the
 *   credentials it was given. `ssh-tunnel.ts` refuses multiplexing for its own
 *   reason, and neither refusal covers the other module's case.
 * - The destination tail from `buildDestinationArgs` ends with `--`, so the
 *   destination can never be read as an option and the remote command follows
 *   it as ordinary arguments.
 *
 * Throws on an unusable destination or remote argument. Callers in this module
 * validate first; the throw is the last line of defence for anyone else.
 */
export function buildRemoteExecArgs(
  destination: SshDestination,
  argv: readonly string[]
): readonly string[] {
  if (
    !Array.isArray(argv) ||
    argv.length === 0 ||
    argv.length > MAX_REMOTE_ARGV ||
    !argv.every(isSafeRemoteArgument)
  ) {
    throw new Error('Refusing to run an unsafe remote command');
  }
  return [
    '-T',
    '-o',
    'BatchMode=yes',
    '-o',
    `ConnectTimeout=${CONNECT_TIMEOUT_SECONDS}`,
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'ControlMaster=no',
    '-o',
    'ControlPath=none',
    ...buildDestinationArgs(destination),
    ...argv,
  ];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseJsonObject(text: unknown): Record<string, unknown> | null {
  if (typeof text !== 'string' || text.length === 0) return null;
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

function boundedToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.length > MAX_TOKEN_LENGTH) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The literal shared token from a config file, or null when there is not one
 * there to read.
 *
 * Two observed shapes, both real:
 *
 * - `gateway.auth.token` is a plain string. That is the readable case.
 * - `gateway.auth.token` is an indirection object such as
 *   `{"source":"file","provider":"…","id":"value"}`. The literal secret is NOT
 *   in the file; the object only says where OpenClaw will go find it. There is
 *   nothing to return, and the source's own CLI is the only thing that can
 *   resolve it. Returning null here is what makes the CLI the preferred path
 *   rather than a fallback.
 *
 * An older shape puts the mode on `gateway.auth` as a string and the token
 * beside it on `gateway`; it is handled too so an older source still bootstraps.
 *
 * Total by construction: garbage in, null out, never a throw.
 */
export function parseConfigToken(configText: string): string | null {
  return literalTokenIn(asRecord(parseJsonObject(configText)?.gateway));
}

/**
 * The same read, over an already-parsed `gateway` section. The remote path
 * parses config TEXT it captured over SSH; the local path is handed the parsed
 * object by OpenClaw's own reader. Both end here, so there is one description
 * of where a Gateway token lives rather than two that can drift.
 */
function literalTokenIn(
  gateway: Record<string, unknown> | null
): string | null {
  if (!gateway) return null;
  const auth = gateway.auth;
  const authRecord = asRecord(auth);
  if (authRecord) return boundedToken(authRecord.token);
  if (typeof auth === 'string' && auth.trim().toLowerCase() === 'token') {
    return boundedToken(gateway.token);
  }
  return null;
}

/**
 * The indirection the live probe found on the operator's own machine:
 *
 *   "token": { "source": "file", "provider": "gateway_auth_token", "id": "value" }
 *
 * The literal secret is not in the configuration at all; the object names the
 * secret OpenClaw keeps beside it. This returns the provider name and nothing
 * else, and only for the exact shape observed:
 *
 * - `source` must be `file`. Any other source names a mechanism Exawatt does
 *   not implement, and guessing at one would be inventing a credential path.
 * - `id` must select the whole value. A field selector would mean the secret is
 *   structured, and reading the wrong field out of a structure is how a
 *   confident pairing failure gets built.
 * - the provider name must be a plain identifier. It becomes a filename, so the
 *   character class is what keeps config text from choosing a path: no slashes,
 *   no dots, and therefore no traversal.
 */
function secretProviderIn(
  gateway: Record<string, unknown> | null
): string | null {
  const auth = asRecord(gateway?.auth);
  const indirection = asRecord(auth?.token);
  if (!indirection) return null;
  if (indirection.source !== 'file') return null;
  if (indirection.id !== undefined && indirection.id !== 'value') return null;
  const provider = indirection.provider;
  if (typeof provider !== 'string' || !SECRET_NAME_PATTERN.test(provider)) {
    return null;
  }
  return provider;
}

/**
 * The declared loopback Gateway port, falling back only when the source does
 * not declare a usable one. Reading it matters: a source on a non-default port
 * would otherwise get a tunnel pointed at nothing.
 *
 * Total by construction: garbage in, documented default out, never a throw.
 */
export function parseGatewayPort(configText: string): number {
  return gatewayPortIn(asRecord(parseJsonObject(configText)?.gateway));
}

function gatewayPortIn(gateway: Record<string, unknown> | null): number {
  const port = gateway?.port;
  if (
    Number.isInteger(port) &&
    (port as number) >= 1 &&
    (port as number) <= 65535
  ) {
    return port as number;
  }
  return FALLBACK_GATEWAY_PORT;
}

/**
 * Pull the version out of a print like `OpenClaw 2026.7.1-2 (abc1234)`.
 *
 * Deliberately returns the version and not the parenthesized commit hash: the
 * hash is build provenance the operator cannot act on, while the version is
 * what a capability decision can key on. A bare hash carries no dots, so the
 * dotted-number shape below rejects it without needing to know about parens.
 *
 * Total by construction: garbage in, null out, never a throw.
 */
export function parseOpenClawVersion(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const firstLine = raw.slice(0, 4_096).split('\n')[0] ?? '';
  for (const rawToken of firstLine.split(/\s+/)) {
    const token = rawToken.replace(/^[('"]+|[)'",]+$/g, '');
    if (token.length === 0 || token.length > 64) continue;
    const candidate = token.startsWith('v') ? token.slice(1) : token;
    if (/^\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.]+)?$/.test(candidate))
      return candidate;
  }
  return null;
}

/**
 * Accept the source CLI's answer only when it looks like a credential.
 *
 * `openclaw config get` is a general-purpose reader, so on an absent or
 * indirect key it can print a diagnostic, a JSON object, or a placeholder
 * instead of failing. A shared secret is one whitespace-free line, so requiring
 * that shape rejects every one of those without needing to know the CLI's exact
 * error wording. A wrong accept here would be handed to the Gateway as a token
 * and fail the pairing with a confusing message, so this fails closed and lets
 * the config-file path answer instead.
 */
function parseCliToken(stdout: unknown): string | null {
  if (typeof stdout !== 'string') return null;
  let value = stdout.slice(0, OUTPUT_CAPTURE_MAX).trim();
  if (value.length === 0 || value.length > MAX_TOKEN_LENGTH) return null;
  // A CLI that prints values as JSON quotes a bare string; unwrap exactly that.
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1).trim();
  }
  if (value.length === 0) return null;
  if (/\s/.test(value)) return null;
  if (value.startsWith('{') || value.startsWith('[')) return null;
  if (/^(undefined|null|nil|none|\(null\))$/i.test(value)) return null;
  return value;
}

/**
 * Ordered because the phrases overlap, and the first match wins. This is the
 * same vocabulary `ssh-tunnel.ts` classifies, minus the forward-specific cases
 * that cannot arise here: this module runs a command, it does not open a `-L`.
 */
const TRANSPORT_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  failure: GatewayBootstrapFailure;
  /** Names the field the operator got wrong, when `ssh` said which it was. */
  message?: string;
}> = [
  /*
   * The key-file phrases come BEFORE the generic refusal phrases, for the
   * reason `ssh-tunnel.ts` orders them the same way: an unreadable or wrongly
   * permissioned `-i` never arrives alone. `ssh` warns about the key, offers
   * nothing, and the server ends the session with `Permission denied
   * (publickey).`, so below that phrase these could never win a match.
   */
  {
    pattern: /identity file .* not accessible/i,
    failure: 'auth-rejected',
    message: SPECIFIC_MESSAGES.identity_file_refused,
  },
  {
    pattern: /no such identity/i,
    failure: 'auth-rejected',
    message: SPECIFIC_MESSAGES.identity_file_refused,
  },
  {
    pattern: /bad permissions|unprotected private key file/i,
    failure: 'auth-rejected',
    message: SPECIFIC_MESSAGES.identity_file_refused,
  },
  {
    pattern: /invalid format|error in libcrypto/i,
    failure: 'auth-rejected',
    message: SPECIFIC_MESSAGES.identity_file_refused,
  },

  {
    pattern:
      /host key verification failed|remote host identification has changed/i,
    failure: 'auth-rejected',
    message: SPECIFIC_MESSAGES.host_key_changed,
  },

  { pattern: /permission denied/i, failure: 'auth-rejected' },
  { pattern: /publickey/i, failure: 'auth-rejected' },
  { pattern: /too many authentication failures/i, failure: 'auth-rejected' },

  {
    pattern: /could not resolve hostname/i,
    failure: 'unreachable',
    message: SPECIFIC_MESSAGES.address_unresolved,
  },
  {
    pattern: /name or service not known|nodename nor servname/i,
    failure: 'unreachable',
    message: SPECIFIC_MESSAGES.address_unresolved,
  },
  {
    pattern: /no route to host/i,
    failure: 'unreachable',
    message: SPECIFIC_MESSAGES.ssh_port_silent,
  },
  {
    pattern: /network is unreachable/i,
    failure: 'unreachable',
    message: SPECIFIC_MESSAGES.ssh_port_silent,
  },
  {
    pattern: /operation timed out/i,
    failure: 'unreachable',
    message: SPECIFIC_MESSAGES.ssh_port_silent,
  },
  {
    pattern: /connection timed out/i,
    failure: 'unreachable',
    message: SPECIFIC_MESSAGES.ssh_port_silent,
  },
  {
    pattern: /connection refused/i,
    failure: 'unreachable',
    message: SPECIFIC_MESSAGES.ssh_port_silent,
  },
  { pattern: /connection closed by remote host/i, failure: 'unreachable' },
];

/**
 * `ssh` reports its OWN failures with exit status 255 and passes any other
 * status straight through from the remote command.
 */
const SSH_ERROR_EXIT_CODE = 255;

/**
 * Why the SSH leg failed, or null when the leg worked and the REMOTE command is
 * what failed. Called only on a non-zero exit.
 */
interface TransportFault {
  failure: GatewayBootstrapFailure;
  message: string;
}

function classifyTransport(result: RemoteExecResult): TransportFault | null {
  const text = typeof result.stderr === 'string' ? result.stderr : '';
  if (text.includes(SSH_LAUNCH_FAILED)) {
    return { failure: 'unknown', message: FAILURE_MESSAGES.unknown };
  }
  // The exit-status gate is load-bearing, not a shortcut. A remote
  // `cat: …/openclaw.json: Permission denied` exits 1 and contains a phrase
  // this table maps to a refused login. Without the gate the operator would be
  // told to check their SSH key when the real answer is a file permission.
  if (result.code !== null && result.code !== SSH_ERROR_EXIT_CODE) return null;
  for (const { pattern, failure, message } of TRANSPORT_PATTERNS) {
    if (pattern.test(text)) {
      return { failure, message: message ?? FAILURE_MESSAGES[failure] };
    }
  }
  // Killed at our own deadline with nothing classifiable to say. For a
  // bootstrap read whose every command is sub-second, that is the server not
  // answering rather than the command misbehaving.
  if (result.code === null) {
    return { failure: 'unreachable', message: FAILURE_MESSAGES.unreachable };
  }
  return null;
}

/**
 * The remote login shell reports an absent binary with its own wording, and
 * every common shell uses one of these three phrasings. None of them overlaps a
 * transport phrase, and transport is classified first regardless.
 */
function indicatesMissingCommand(stderr: unknown): boolean {
  if (typeof stderr !== 'string') return false;
  return /command not found|not found|no such file/i.test(stderr);
}

interface RunOutcome {
  ok: true;
  result: RemoteExecResult;
}

async function runRemote(
  exec: RemoteExec,
  destination: SshDestination,
  argv: readonly string[]
): Promise<RunOutcome | { ok: false; failure: GatewayBootstrapFailure }> {
  // Re-checked here rather than trusted from the call site, so this stays true
  // no matter how the command literals above are edited later.
  if (
    argv.length === 0 ||
    argv.length > MAX_REMOTE_ARGV ||
    !argv.every(isSafeRemoteArgument)
  ) {
    return { ok: false, failure: 'invalid-target' };
  }
  let result: RemoteExecResult;
  try {
    result = await exec(destination, argv);
  } catch {
    // The injected exec is Exawatt's own code; a rejection is a defect here,
    // not an operator-actionable condition, so it stays 'unknown'.
    return { ok: false, failure: 'unknown' };
  }
  if (!result || typeof result !== 'object') {
    return { ok: false, failure: 'unknown' };
  }
  return {
    ok: true,
    result: {
      code: typeof result.code === 'number' ? result.code : null,
      stdout: typeof result.stdout === 'string' ? result.stdout : '',
      stderr: typeof result.stderr === 'string' ? result.stderr : '',
    },
  };
}

/**
 * Ask a remote source, once, for the credential its own Gateway expects.
 *
 * Three bounded reads over the connection the operator already authorized:
 * the source's version, its CLI's answer for the Gateway token, and its
 * configuration file.
 *
 * Fails closed at every step. Nothing here retries, nothing here writes, and
 * the returned token is never logged.
 */
export async function bootstrapGatewayCredentialOverSsh(
  destination: SshDestination,
  exec: RemoteExec,
  /**
   * Injected for the same reason `LocalGatewaySource` is: a unit test must be
   * able to describe a key file without one existing on the machine running
   * the test. The default is the real readability check.
   */
  canReadIdentityFile?: (path: string) => boolean
): Promise<GatewayBootstrapResult> {
  // Before ANY execution: a leading dash would make ssh read part of the
  // destination as an option, and `-oProxyCommand=…` is remote code execution
  // on this machine.
  const resolved = resolveSshDestination(destination);
  if (!resolved.ok) return failed('invalid-target');
  const target = resolved.destination;
  if (typeof exec !== 'function') return failed('unknown');

  // A key file this machine cannot read is a mistake in the target, not a
  // refusal by the server. Caught here, the operator is told which field is
  // wrong; left to `ssh`, it becomes a refused login on their server that
  // reports back as an authorization problem. `ssh-tunnel.ts` owns the rule so
  // both transports answer the same way about the same field.
  if (
    canReadIdentityFile === undefined
      ? namesUnreadableIdentityFile(target)
      : namesUnreadableIdentityFile(target, canReadIdentityFile)
  ) {
    return failed('invalid-target', SPECIFIC_MESSAGES.identity_file_unreadable);
  }

  // 1. Version. Also the cheapest proof that the login works and OpenClaw is
  //    there, so its failure classification stands in for the whole session.
  const versionRun = await runRemote(exec, target, ['openclaw', '--version']);
  if (!versionRun.ok) return failed(versionRun.failure);
  let version: string | null = null;
  if (versionRun.result.code === 0) {
    version = parseOpenClawVersion(versionRun.result.stdout);
  } else {
    const transport = classifyTransport(versionRun.result);
    if (transport) return failed(transport.failure, transport.message);
    if (indicatesMissingCommand(versionRun.result.stderr)) {
      return failed('openclaw-missing');
    }
    // The CLI ran and answered something other than a version. Not fatal: the
    // config file can still carry both the token and the port.
  }

  // 2. The source's own CLI resolves the token even when the config file only
  //    points at where it lives.
  const cliRun = await runRemote(exec, target, [
    'openclaw',
    'config',
    'get',
    'gateway.auth.token',
  ]);
  if (!cliRun.ok) return failed(cliRun.failure);
  let cliToken: string | null = null;
  if (cliRun.result.code === 0) {
    cliToken = parseCliToken(cliRun.result.stdout);
  } else {
    const transport = classifyTransport(cliRun.result);
    if (transport) return failed(transport.failure, transport.message);
  }

  // 3. The config file. Read even when the CLI already answered, because it is
  //    the only place the declared Gateway port appears.
  const configRun = await runRemote(exec, target, ['cat', REMOTE_CONFIG_PATH]);
  if (!configRun.ok) return failed(configRun.failure);
  let configText: string | null = null;
  let configFailure: TransportFault | null = null;
  if (configRun.result.code === 0) {
    configText = configRun.result.stdout;
  } else {
    configFailure = classifyTransport(configRun.result) ?? {
      failure: 'unreadable-config',
      message: FAILURE_MESSAGES['unreadable-config'],
    };
  }

  const gatewayPort =
    configText === null ? FALLBACK_GATEWAY_PORT : parseGatewayPort(configText);

  if (configText !== null) {
    // The config file wins when it declares a literal token.
    //
    // The CLI was tried first in the original draft, on the theory that the
    // source should resolve its own indirection. A live run disproved it: on
    // OpenClaw 2026.7.x `config get gateway.auth.token` answers with a short
    // masked value, not the credential, and pairing failed with "gateway token
    // mismatch" while a perfectly good token sat in the file. Secret-reading
    // CLIs mask by default, so the file is the trustworthy source and the CLI
    // is only worth trying when the file has nothing literal to give.
    const fileToken = parseConfigToken(configText);
    if (fileToken) {
      return {
        ok: true,
        facts: {
          version,
          gatewayPort,
          sharedToken: fileToken,
          tokenSource: 'config-file',
        },
      };
    }
    if (cliToken) {
      return {
        ok: true,
        facts: {
          version,
          gatewayPort,
          sharedToken: cliToken,
          tokenSource: 'cli',
        },
      };
    }
    // Reached the config and read it, and neither it nor the CLI yielded a
    // usable token. This is the indirection case. Distinct from an unreadable
    // config, because the operator's next step is different: supply a token
    // rather than fix a permission.
    return failed('token-unavailable');
  }

  if (cliToken) {
    return {
      ok: true,
      facts: {
        version,
        gatewayPort,
        sharedToken: cliToken,
        tokenSource: 'cli',
      },
    };
  }

  return configFailure
    ? failed(configFailure.failure, configFailure.message)
    : failed('unreadable-config');
}

/**
 * Read this machine's own OpenClaw configuration for the credential its Gateway
 * expects.
 *
 * The operator's own machine runs a Gateway too, and it is one more configured
 * source rather than a special case. What is genuinely different is the
 * resolution: there is no hop to authorize, no login to refuse, and no remote
 * shell to protect, so nothing is executed at all. The configuration is on this
 * disk and it is simply read.
 *
 * Two shapes are handled, both observed on real installations:
 *
 * - a literal token in the configuration, which is read directly;
 * - the indirection object, where the configuration names a secret OpenClaw
 *   keeps beside it. The named file is read under the state directory's own
 *   secrets folder, bounded, and never logged.
 *
 * Anything else fails closed as `token-unavailable`, which is the actionable
 * answer: the operator can supply the token. It never invents one, and it never
 * lets configuration text choose which file gets read.
 */
export async function bootstrapLocalGatewayCredential(
  source: LocalGatewaySource = defaultLocalGatewaySource()
): Promise<GatewayBootstrapResult> {
  let config: OCGatewayConfig | null;
  try {
    config = source.readConfig();
  } catch {
    // The reader already fails closed; this is the belt for an injected one.
    return failed('unreadable-config');
  }
  const gateway = asRecord(asRecord(config)?.gateway);
  if (!gateway) return failed('unreadable-config');

  const gatewayPort = gatewayPortIn(gateway);

  const literal = literalTokenIn(gateway);
  if (literal) {
    return {
      ok: true,
      facts: {
        // Reporting a version would mean running the local CLI, which is a
        // second mechanism for a fact this bootstrap does not need. The
        // Gateway reports its own version on `status` once the session is up.
        version: null,
        gatewayPort,
        sharedToken: literal,
        tokenSource: 'config-file',
      },
    };
  }

  const provider = secretProviderIn(gateway);
  if (provider !== null) {
    for (const name of secretFileCandidates(provider)) {
      let contents: string | null;
      try {
        contents = source.readSecret(name);
      } catch {
        contents = null;
      }
      const token = boundedToken(contents);
      if (token) {
        return {
          ok: true,
          facts: {
            version: null,
            gatewayPort,
            sharedToken: token,
            tokenSource: 'secret-file',
          },
        };
      }
    }
  }

  return failed('token-unavailable');
}

/**
 * The file names one provider can legitimately have.
 *
 * The configuration spells a provider in snake_case (`gateway_auth_token`)
 * while the observed store file is kebab-case (`gateway-auth-token`). Both
 * spellings of the SAME name are tried and nothing else is: this is two
 * candidate file names inside one fixed directory, not a search.
 */
function secretFileCandidates(provider: string): readonly string[] {
  const dashed = provider.replace(/_/g, '-');
  return dashed === provider ? [provider] : [provider, dashed];
}

/**
 * The real local installation: OpenClaw's own configuration reader, plus a
 * bounded read of one file in its secrets directory.
 */
export function defaultLocalGatewaySource(
  stateDir: string = join(homedir(), LOCAL_STATE_DIR_NAME)
): LocalGatewaySource {
  return {
    readConfig: () => readGatewayConfig(stateDir),
    readSecret: name => {
      // Re-checked at the boundary: the caller validates, and this seam is
      // exported, so a future caller cannot turn a name into a path.
      if (!SECRET_NAME_PATTERN.test(name)) return null;
      return readBoundedFile(join(stateDir, LOCAL_SECRETS_DIR_NAME, name));
    },
  };
}

/**
 * Bounded on both axes a file can surprise us with. `isFile` refuses a device
 * or a pipe, whose read would never end, and the size check refuses anything
 * larger than a credential could be before a byte is read.
 */
function readBoundedFile(path: string): string | null {
  try {
    const stats = statSync(path);
    if (!stats.isFile() || stats.size > MAX_TOKEN_LENGTH) return null;
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

export interface GatewayCredentialDependencies {
  /** Runs one bounded command on a remote source. The local path uses none. */
  exec: RemoteExec;
  /** This machine's own installation. Defaults to the real one. */
  local?: LocalGatewaySource;
  /** Whether a named private key file can be read here. Defaults to the real check. */
  canReadIdentityFile?: (path: string) => boolean;
}

/**
 * The one seam a caller uses: resolve the Gateway credential for a configured
 * source, whatever transport it was saved with.
 *
 * Dispatch is on the transport kind rather than on a flag, because the two
 * paths are not one path with a switch inside it. The SSH path runs bounded
 * commands on another machine and classifies transport failures; the local path
 * executes nothing and reads a file. A boolean parameter would have forced one
 * function to be both, and the shared half would have been the half that
 * matters least.
 */
export async function resolveGatewayCredential(
  transport: SourceTransport,
  deps: GatewayCredentialDependencies
): Promise<GatewayBootstrapResult> {
  if (!transport || typeof transport !== 'object') {
    return failed('invalid-target');
  }
  switch (transport.kind) {
    case 'ssh-alias':
      return await bootstrapGatewayCredentialOverSsh(
        { kind: 'ssh-alias', alias: transport.alias },
        deps.exec,
        deps.canReadIdentityFile
      );
    case 'ssh-manual':
      return await bootstrapGatewayCredentialOverSsh(
        {
          kind: 'ssh-manual',
          host: transport.host,
          user: transport.user,
          port: transport.port,
          identityFile: transport.identityFile,
        },
        deps.exec,
        deps.canReadIdentityFile
      );
    case 'local-loopback':
      return await bootstrapLocalGatewayCredential(deps.local);
    default:
      // A record that survived persistence with an unknown kind. Fail closed
      // rather than picking a transport for it.
      return failed('invalid-target');
  }
}

/**
 * Default `RemoteExec` built on `child_process.spawn`. Injected in tests, which
 * never spawn a real `ssh`: a test that shelled out would reach a real network.
 *
 * Bounded on both axes that a hostile or wedged far side controls: output is
 * capped, and the child is killed at a deadline instead of being waited on.
 */
export function createSshRemoteExec(
  options: { timeoutMs?: number } = {}
): RemoteExec {
  const requested = options.timeoutMs;
  const timeoutMs = Number.isFinite(requested)
    ? Math.min(
        Math.max(Number(requested), MIN_EXEC_TIMEOUT_MS),
        MAX_EXEC_TIMEOUT_MS
      )
    : DEFAULT_EXEC_TIMEOUT_MS;

  return (destination, argv) =>
    new Promise<RemoteExecResult>(resolve => {
      let args: readonly string[];
      try {
        args = buildRemoteExecArgs(destination, argv);
      } catch {
        resolve({ code: null, stdout: '', stderr: SSH_LAUNCH_FAILED });
        return;
      }

      let child: ChildProcess;
      try {
        child = nodeSpawn('ssh', args, {
          // An argument array with no shell. There is no command string
          // anywhere in this module, so there is nothing for a local shell to
          // reinterpret; `isSafeRemoteArgument` covers the remote shell.
          shell: false,
          // stdin is closed because BatchMode means nothing may prompt.
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch {
        resolve({ code: null, stdout: '', stderr: SSH_LAUNCH_FAILED });
        return;
      }

      let stdout = '';
      let stderr = '';
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const finish = (code: number | null, extraStderr = '') => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ code, stdout, stderr: `${stderr}${extraStderr}` });
      };

      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        if (stdout.length < OUTPUT_CAPTURE_MAX) {
          stdout = (stdout + String(chunk)).slice(0, OUTPUT_CAPTURE_MAX);
        }
      });
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string) => {
        // A rolling tail: the classifiable phrase is at the end of an ssh
        // failure, not the start.
        stderr = (stderr + String(chunk)).slice(-OUTPUT_CAPTURE_MAX);
      });

      child.on('error', () => finish(null, SSH_LAUNCH_FAILED));
      child.on('close', code => finish(typeof code === 'number' ? code : null));

      timer = setTimeout(() => {
        // Resolve on our own deadline rather than waiting for the kill: an
        // orphaned `ssh` would hold an authenticated connection to the
        // operator's server open with nothing watching it, so the kill is
        // started here and the caller is answered immediately.
        void stopChildProcess(child, {
          forceAfterMs: 2_000,
          failAfterMs: 8_000,
          failureMessage: 'The SSH bootstrap process did not exit',
        }).catch(() => undefined);
        finish(null);
      }, timeoutMs);
    });
}

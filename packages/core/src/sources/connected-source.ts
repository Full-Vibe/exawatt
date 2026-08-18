import {
  AGENT_SOURCE_PLACEMENTS,
  type AgentSourcePlacement,
} from '../agent-projection';
import {
  AGENT_SOURCE_ADAPTER_IDS,
  type AgentSourceAdapterId,
} from '../agent-sources';

/**
 * Configured Agent sources (ENG-010 C1).
 *
 * Two product rules shape this file:
 *
 * 1. Connection freshness is not work state. Everything here describes how
 *    current Exawatt's observation is, never what the remote Agent is doing.
 *    Unreachable means last-known and stale, never stopped.
 * 2. Connection material never crosses into renderer state. The persisted
 *    record lives in Electron main and may hold what a reconnect needs; the
 *    renderer projection carries no host, user, port, key path, or secret. An
 *    SSH alias name is the one exception: it is the operator's own label and
 *    the source picker has to show it.
 */

/** Runtime vocabularies are also the source of their compile-time unions. */
export const SOURCE_TRANSPORT_KINDS = [
  'ssh-alias',
  'ssh-manual',
  'local-loopback',
] as const;
export type SourceTransportKind = (typeof SOURCE_TRANSPORT_KINDS)[number];

export type SourceTransport =
  | { kind: 'ssh-alias'; alias: string; remotePort: number }
  | {
      kind: 'ssh-manual';
      host: string;
      user: string;
      port: number;
      identityFile: string | null;
      remotePort: number;
    }
  | { kind: 'local-loopback'; port: number };

export const SOURCE_CREDENTIAL_OWNERS = [
  'source-owned-ssh',
  'exawatt-keychain',
] as const;
export type SourceCredentialOwner = (typeof SOURCE_CREDENTIAL_OWNERS)[number];

/**
 * How much authority Exawatt actually holds on a source (ENG-033 H2).
 *
 * Two values, and deliberately no third. `read` is observation: it is the
 * floor, the default, and everything H1 ships. `write` is the ability to talk
 * to a coworker: send, abort, steer, cancel. Administration — cron mutation,
 * configuration, Agent create/delete — has no representable value here,
 * because a vocabulary that cannot express admin cannot be talked into
 * granting it.
 *
 * The name is `granted`, not `allowed` or `requested`, and that is the whole
 * point. It records what the Gateway answered with on a completed handshake,
 * never what Exawatt asked for. Raising it is a server-side pairing approval
 * the operator performs on the source; Exawatt cannot approve itself.
 */
export const SOURCE_AUTHORITIES = ['read', 'write'] as const;
export type SourceAuthority = (typeof SOURCE_AUTHORITIES)[number];

const AUTHORITY_SET: ReadonlySet<string> = new Set(SOURCE_AUTHORITIES);

/**
 * The one fail-closed reader for granted authority.
 *
 * Absent, wrong-typed, or unrecognised all resolve to `read`, and none of them
 * rejects the record. That asymmetry with the rest of this file's validation is
 * deliberate. Every other field has no safe answer when it is corrupt, so the
 * record is refused. This one has exactly one safe answer, and it is the answer
 * a source starts with: read-only. Rejecting the record instead would detach a
 * working source over a field whose worst case is that the operator has to ask
 * for write authority again.
 */
export function readGrantedAuthority(value: unknown): SourceAuthority {
  return typeof value === 'string' && AUTHORITY_SET.has(value)
    ? (value as SourceAuthority)
    : 'read';
}

/** Persisted in Electron main only. Never sent to the renderer. */
export interface ConnectedSourceRecord {
  id: string;
  adapterId: AgentSourceAdapterId;
  placement: AgentSourcePlacement;
  /** Operator's label for this server. */
  displayName: string;
  transport: SourceTransport;
  credentialOwner: SourceCredentialOwner;
  /** True once a scoped device token exists in the OS keychain for this source. */
  hasDeviceCredential: boolean;
  /**
   * Authority the source's Gateway granted this device, as observed on the
   * last completed handshake. Never what Exawatt asked for, and never a
   * standing permission Exawatt gave itself.
   *
   * Required, so that no record can quietly omit the authority it is being
   * operated under. Persisted JSON is a different matter: a record written
   * before authority existed simply has no such field, and
   * `parseConnectedSourceRecord` reads that absence as read-only through
   * `readGrantedAuthority`, which is the one place any absent or unrecognised
   * value is turned into a value.
   */
  grantedAuthority: SourceAuthority;
  createdAt: number;
}

/** Renderer-safe projection. */
export interface ConnectedSourceView {
  id: string;
  adapterId: AgentSourceAdapterId;
  placement: AgentSourcePlacement;
  displayName: string;
  transportKind: SourceTransportKind;
  /** Present only for 'ssh-alias'; the operator's own alias name. */
  alias: string | null;
  credentialOwner: SourceCredentialOwner;
  hasDeviceCredential: boolean;
}

/**
 * The renderer boundary. This is a whitelist construction on purpose: a fresh
 * object literal naming every field that may cross, never a spread with
 * deletions. A spread would leak any field a later record shape adds, and the
 * fields this record holds are exactly the ones that must not travel.
 */
export function toConnectedSourceView(
  record: ConnectedSourceRecord
): ConnectedSourceView {
  return {
    id: record.id,
    adapterId: record.adapterId,
    placement: record.placement,
    displayName: record.displayName,
    transportKind: record.transport.kind,
    // Only the alias name survives. Host, user, port, and key path stay in main.
    alias:
      record.transport.kind === 'ssh-alias' ? record.transport.alias : null,
    credentialOwner: record.credentialOwner,
    hasDeviceCredential: record.hasDeviceCredential,
    // `grantedAuthority` stays in main for now. It is not connection material
    // and it belongs in this projection the moment a surface shows it; the
    // packet that adds a composer adds the field with the surface, so the
    // renderer never carries an authority nothing reads.
  };
}

/*
 * Sets make untrusted boundary checks cheap; their values come only from the
 * exported tuples above, so runtime validation cannot drift from the unions.
 */
const ADAPTER_ID_SET: ReadonlySet<string> = new Set(AGENT_SOURCE_ADAPTER_IDS);
const PLACEMENT_SET: ReadonlySet<string> = new Set(AGENT_SOURCE_PLACEMENTS);
const CREDENTIAL_OWNER_SET: ReadonlySet<string> = new Set(
  SOURCE_CREDENTIAL_OWNERS
);
const TRANSPORT_KIND_SET: ReadonlySet<string> = new Set(SOURCE_TRANSPORT_KINDS);

const MAX_TEXT_LENGTH = 512;
const MIN_PORT = 1;
const MAX_PORT = 65_535;

/**
 * SSH alias grammar. The tunnel owner passes this value to ssh as an argument,
 * so a leading dash would be read as an OPTION rather than a destination: an
 * alias of `-oProxyCommand=...` would execute an operator-supplied command.
 * This is an injection guard, not cosmetics; whitespace and separators are
 * rejected for the same reason.
 */
const SSH_ALIAS_PATTERN = /^[A-Za-z0-9._-]{1,255}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validText(value: unknown, max = MAX_TEXT_LENGTH): value is string {
  return (
    typeof value === 'string' && value.trim().length > 0 && value.length <= max
  );
}

function validPort(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_PORT &&
    value <= MAX_PORT
  );
}

function validAlias(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    SSH_ALIAS_PATTERN.test(value) &&
    !value.startsWith('-')
  );
}

function parseTransport(
  value: unknown,
  issues: string[]
): SourceTransport | null {
  if (!isRecord(value)) {
    issues.push('transport: must be a record.');
    return null;
  }
  const kind = value.kind;
  if (typeof kind !== 'string' || !TRANSPORT_KIND_SET.has(kind)) {
    issues.push('transport.kind: unknown transport kind.');
    return null;
  }

  if (kind === 'ssh-alias') {
    let ok = true;
    if (!validAlias(value.alias)) {
      issues.push(
        'transport.alias: must match /^[A-Za-z0-9._-]{1,255}$/ and must not start with "-".'
      );
      ok = false;
    }
    if (!validPort(value.remotePort)) {
      issues.push(
        `transport.remotePort: must be an integer between ${MIN_PORT} and ${MAX_PORT}.`
      );
      ok = false;
    }
    if (!ok) return null;
    // Fresh literal: unknown fields on the input are dropped, never carried.
    return {
      kind: 'ssh-alias',
      alias: value.alias as string,
      remotePort: value.remotePort as number,
    };
  }

  if (kind === 'ssh-manual') {
    let ok = true;
    if (!validText(value.host)) {
      issues.push(
        'transport.host: must be a non-empty string of 512 chars or fewer.'
      );
      ok = false;
    }
    if (!validText(value.user)) {
      issues.push(
        'transport.user: must be a non-empty string of 512 chars or fewer.'
      );
      ok = false;
    }
    if (!validPort(value.port)) {
      issues.push(
        `transport.port: must be an integer between ${MIN_PORT} and ${MAX_PORT}.`
      );
      ok = false;
    }
    if (!validPort(value.remotePort)) {
      issues.push(
        `transport.remotePort: must be an integer between ${MIN_PORT} and ${MAX_PORT}.`
      );
      ok = false;
    }
    const identityFile = value.identityFile;
    if (identityFile !== null && !validText(identityFile)) {
      issues.push(
        'transport.identityFile: must be null or a non-empty string of 512 chars or fewer.'
      );
      ok = false;
    }
    if (!ok) return null;
    return {
      kind: 'ssh-manual',
      host: value.host as string,
      user: value.user as string,
      port: value.port as number,
      identityFile: identityFile === null ? null : (identityFile as string),
      remotePort: value.remotePort as number,
    };
  }

  if (!validPort(value.port)) {
    issues.push(
      `transport.port: must be an integer between ${MIN_PORT} and ${MAX_PORT}.`
    );
    return null;
  }
  return { kind: 'local-loopback', port: value.port };
}

/**
 * Fail-closed parse for persisted records. Every issue is collected rather than
 * thrown on the first fault so a corrupted registry entry can be reported in
 * full, and the returned record is rebuilt field by field so unknown fields in
 * the stored JSON are stripped instead of round-tripping into memory.
 */
export function parseConnectedSourceRecord(
  value: unknown
):
  | { ok: true; record: ConnectedSourceRecord }
  | { ok: false; issues: readonly string[] } {
  const issues: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, issues: ['record: must be a record.'] };
  }

  if (!validText(value.id)) {
    issues.push('id: must be a non-empty string of 512 chars or fewer.');
  }
  if (
    typeof value.adapterId !== 'string' ||
    !ADAPTER_ID_SET.has(value.adapterId)
  ) {
    issues.push('adapterId: unknown Agent source adapter.');
  }
  if (
    typeof value.placement !== 'string' ||
    !PLACEMENT_SET.has(value.placement)
  ) {
    issues.push('placement: unknown Agent source placement.');
  }
  if (!validText(value.displayName)) {
    issues.push(
      'displayName: must be a non-empty string of 512 chars or fewer.'
    );
  }
  if (
    typeof value.credentialOwner !== 'string' ||
    !CREDENTIAL_OWNER_SET.has(value.credentialOwner)
  ) {
    issues.push('credentialOwner: unknown credential owner.');
  }
  if (typeof value.hasDeviceCredential !== 'boolean') {
    issues.push('hasDeviceCredential: must be a boolean.');
  }
  if (
    typeof value.createdAt !== 'number' ||
    !Number.isInteger(value.createdAt) ||
    value.createdAt < 0
  ) {
    issues.push('createdAt: must be a non-negative integer epoch ms.');
  }

  const transport = parseTransport(value.transport, issues);

  if (issues.length > 0 || transport === null) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    record: {
      id: value.id as string,
      adapterId: value.adapterId as AgentSourceAdapterId,
      placement: value.placement as AgentSourcePlacement,
      displayName: value.displayName as string,
      transport,
      credentialOwner: value.credentialOwner as SourceCredentialOwner,
      hasDeviceCredential: value.hasDeviceCredential as boolean,
      // Normalised rather than validated-or-rejected, for the reason given on
      // `readGrantedAuthority`. A record written before H2 has no such field
      // and is read as read-only, which is exactly what it holds.
      grantedAuthority: readGrantedAuthority(value.grantedAuthority),
      createdAt: value.createdAt as number,
    },
  };
}

/* Connection freshness. Independent of work state, by contract. */

export const SOURCE_CONNECTION_STATES = [
  'live',
  'reconnecting',
  'stale',
  'unavailable',
] as const;
export type SourceConnectionState = (typeof SOURCE_CONNECTION_STATES)[number];

export const SOURCE_FAILURE_CLASSES = [
  'host-unreachable',
  'gateway-down',
  'auth-rejected',
  'approval-required',
  'incompatible',
  'unknown',
] as const;
export type SourceFailureClass = (typeof SOURCE_FAILURE_CLASSES)[number];

export interface ConnectionObservation {
  /** Transport currently carrying traffic. */
  transportUp: boolean;
  /** Exawatt is actively retrying right now. */
  retrying: boolean;
  /** Epoch ms of the last authoritative snapshot; null when never observed. */
  lastObservedAt: number | null;
  /** Terminal failure, when the last attempt ended in one. */
  failure: SourceFailureClass | null;
  now: number;
}

export interface ConnectionStatus {
  state: SourceConnectionState;
  /** Null when never observed. */
  observationAgeMs: number | null;
  /** True when Exawatt must not present its cached view as current. */
  stalePresentation: boolean;
  failure: SourceFailureClass | null;
}

/**
 * Documented, exported so UI copy and tests share one number. Beyond this an
 * observation stops counting as current even while the socket is up.
 */
export const CONNECTION_STALE_AFTER_MS = 60_000;

/**
 * Age of the last snapshot, never negative.
 *
 * Two unusable-input cases are deliberately kept apart. A timestamp AHEAD of
 * `now` is an ordinary clock adjustment on a connection that really did just
 * report, so it clamps to 0 and stays eligible for `live`. A non-finite or
 * negative number is not a timestamp at all; returning 0 for it would let
 * corrupted state present itself as maximally fresh, which is exactly the
 * claim the freshness contract exists to prevent. Those report `null`, the
 * same as never observed, so the caller downgrades instead of upgrading.
 */
function observationAge(
  lastObservedAt: number | null,
  now: number
): number | null {
  if (lastObservedAt === null) return null;
  if (
    !Number.isFinite(lastObservedAt) ||
    !Number.isFinite(now) ||
    lastObservedAt < 0 ||
    now < 0
  ) {
    return null;
  }
  return Math.max(0, now - lastObservedAt);
}

/**
 * Resolve how current Exawatt's cached view is. Precedence is deliberate:
 * an up transport outranks a retry, and a retry in flight outranks a terminal
 * failure, because a reconnect that is still running has not failed yet. No
 * branch may conclude anything about the remote Agent's work.
 */
export function resolveConnectionStatus(
  observation: ConnectionObservation
): ConnectionStatus {
  const ageMs = observationAge(observation.lastObservedAt, observation.now);

  if (observation.transportUp) {
    // A live socket that has not produced a snapshot is not proof of current
    // content, so freshness is decided by the snapshot, not by the socket.
    if (ageMs !== null && ageMs <= CONNECTION_STALE_AFTER_MS) {
      return {
        state: 'live',
        observationAgeMs: ageMs,
        stalePresentation: false,
        failure: null,
      };
    }
    return {
      state: 'stale',
      observationAgeMs: ageMs,
      stalePresentation: true,
      failure: null,
    };
  }

  if (observation.retrying) {
    return {
      state: 'reconnecting',
      observationAgeMs: ageMs,
      stalePresentation: true,
      // The failure that triggered the retry stays attached so diagnostics can
      // name it, while the state keeps saying "reconnecting", not "failed".
      failure: observation.failure,
    };
  }

  // Everything else is unavailable: a classified terminal failure, a source
  // never observed, or a down transport with no classification. The last case
  // fails closed rather than presenting a cached view as current.
  return {
    state: 'unavailable',
    observationAgeMs: ageMs,
    stalePresentation: true,
    failure: observation.failure,
  };
}

const FAILURE_DESCRIPTIONS: Readonly<Record<SourceFailureClass, string>> = {
  'host-unreachable': 'Server unreachable',
  'gateway-down': 'Gateway not responding',
  'auth-rejected': 'Sign-in rejected',
  'approval-required': 'Approval needed',
  incompatible: 'Version not supported',
  unknown: 'Unavailable',
};

function describeAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return 'Last seen less than a minute ago';
  if (minutes === 1) return 'Last seen 1 minute ago';
  if (minutes < 60) return `Last seen ${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return 'Last seen 1 hour ago';
  if (hours < 48) return `Last seen ${hours} hours ago`;
  return `Last seen ${Math.floor(hours / 24)} days ago`;
}

/**
 * Human-facing, non-alarming summary. Every string describes Exawatt's own
 * observation. None of them may claim the remote Agent stopped, paused, ended,
 * or finished, because Exawatt does not know that and losing the connection is
 * not evidence of it.
 */
export function describeConnectionStatus(status: ConnectionStatus): string {
  switch (status.state) {
    case 'live':
      return 'Live';
    case 'reconnecting':
      return 'Reconnecting';
    case 'stale':
      return status.observationAgeMs === null
        ? 'No snapshot yet'
        : describeAge(status.observationAgeMs);
    case 'unavailable':
      return status.failure === null
        ? 'Unavailable'
        : FAILURE_DESCRIPTIONS[status.failure];
  }
}

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  parseConnectedSourceRecord,
  toConnectedSourceView,
  type ConnectedSourceRecord,
  type ConnectedSourceView,
  type SourceTransport,
} from '@exawatt/core';

/**
 * Persisted registry of configured Agent Sources (ENG-010 C1).
 *
 * Two files, deliberately separate:
 *
 *   <userData>/connected-sources.json      records, no secrets
 *   <userData>/connected-source-secrets.json  OS-encrypted device tokens
 *
 * The split is not tidiness. The records file is the one a diagnostic export,
 * a support bundle, or a bug report may reasonably want to include; keeping
 * every byte of credential material out of it means that decision can never
 * leak one. Nothing in this module writes a secret to the records file, and
 * the secrets file is written only through the OS keychain's encryption.
 *
 * Credential custody follows the probe finding recorded in the project doc:
 * the Gateway's shared token is admin-capable and is never persisted. Exawatt
 * uses it once, in memory, to pair its own device identity at `operator.read`,
 * and persists only the resulting scoped, server-revocable device token. That
 * is what this store holds.
 */

const RECORDS_FILE = 'connected-sources.json';
const SECRETS_FILE = 'connected-source-secrets.json';
const RECORDS_SCHEMA_VERSION = 1;

/** One user's registry cannot plausibly need more than this. */
const MAX_SOURCES = 200;
/** A device token is a bounded credential, not a payload. */
const MAX_TOKEN_LENGTH = 16_384;

export interface ConnectedSourceStoreDependencies {
  /** Directory the two files live in. Injected so tests never touch userData. */
  userDataDir: string;
  /** OS-backed encryption. Absent means the platform refused to provide it. */
  encryption?: {
    isAvailable(): boolean;
    encryptString(plain: string): Buffer;
    decryptString(encrypted: Buffer): string;
  };
  createId?: () => string;
  now?: () => number;
}

export interface AddConnectedSourceInput {
  adapterId: ConnectedSourceRecord['adapterId'];
  placement: ConnectedSourceRecord['placement'];
  displayName: string;
  transport: SourceTransport;
  credentialOwner: ConnectedSourceRecord['credentialOwner'];
}

export type AddConnectedSourceResult =
  | { ok: true; record: ConnectedSourceRecord }
  | { ok: false; issues: readonly string[] };

export type DeviceCredentialWriteResult =
  | { ok: true }
  | { ok: false; reason: 'encryption-unavailable' | 'invalid-token' | 'io' };

interface SecretsFileShape {
  schemaVersion: number;
  /** configured source id -> base64 of the OS-encrypted token. */
  tokens: Record<string, string>;
}

function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  } catch {
    // A missing or corrupt file is an empty registry, never a crash on boot.
    return null;
  }
}

/**
 * Write through a temp file in the same directory, then rename. A partial
 * write of the records file would otherwise drop every configured source on
 * the next launch, and the operator would have no way to tell that from a
 * deliberate detach.
 */
function writeJsonFileAtomic(file: string, value: unknown): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(file)}.${randomUUID()}.tmp`);
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Best effort: a filesystem without POSIX modes still gets the rename.
  }
}

export class ConnectedSourceStore {
  private readonly recordsPath: string;
  private readonly secretsPath: string;
  private readonly deps: ConnectedSourceStoreDependencies;

  constructor(deps: ConnectedSourceStoreDependencies) {
    this.deps = deps;
    this.recordsPath = path.join(deps.userDataDir, RECORDS_FILE);
    this.secretsPath = path.join(deps.userDataDir, SECRETS_FILE);
  }

  /**
   * Every configured source, in creation order. Invalid rows are dropped
   * rather than throwing: one hand-edited record must not make the whole
   * registry unreadable.
   */
  list(): ConnectedSourceRecord[] {
    const parsed = readJsonFile(this.recordsPath);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return [];
    }
    const sources = (parsed as { sources?: unknown }).sources;
    if (!Array.isArray(sources)) return [];
    const records: ConnectedSourceRecord[] = [];
    const seen = new Set<string>();
    for (const candidate of sources.slice(0, MAX_SOURCES)) {
      const result = parseConnectedSourceRecord(candidate);
      if (!result.ok) continue;
      if (seen.has(result.record.id)) continue;
      seen.add(result.record.id);
      records.push(result.record);
    }
    return records;
  }

  /** Renderer-safe projection of the registry. */
  listViews(): ConnectedSourceView[] {
    return this.list().map(toConnectedSourceView);
  }

  get(id: string): ConnectedSourceRecord | null {
    return this.list().find(record => record.id === id) ?? null;
  }

  add(input: AddConnectedSourceInput): AddConnectedSourceResult {
    const existing = this.list();
    if (existing.length >= MAX_SOURCES) {
      return { ok: false, issues: ['source limit reached'] };
    }
    const candidate = {
      id: (this.deps.createId ?? randomUUID)(),
      adapterId: input.adapterId,
      placement: input.placement,
      displayName: input.displayName,
      transport: input.transport,
      credentialOwner: input.credentialOwner,
      hasDeviceCredential: false,
      createdAt: (this.deps.now ?? Date.now)(),
    };
    const parsed = parseConnectedSourceRecord(candidate);
    if (!parsed.ok) return { ok: false, issues: parsed.issues };
    this.persist([...existing, parsed.record]);
    return { ok: true, record: parsed.record };
  }

  rename(id: string, displayName: string): boolean {
    const records = this.list();
    const index = records.findIndex(record => record.id === id);
    if (index < 0) return false;
    const parsed = parseConnectedSourceRecord({
      ...records[index],
      displayName,
    });
    if (!parsed.ok) return false;
    records[index] = parsed.record;
    this.persist(records);
    return true;
  }

  /**
   * Detach. Removes Exawatt's record and its stored credential and nothing
   * else. The remote installation, its Agents, workspaces, history,
   * automations, and its own credentials are untouched, and the paired device
   * remains revocable on the source with the source's own tooling.
   */
  remove(id: string): boolean {
    const records = this.list();
    const next = records.filter(record => record.id !== id);
    if (next.length === records.length) return false;
    this.persist(next);
    this.clearDeviceToken(id);
    return true;
  }

  /**
   * Persist a scoped device token. Fails closed when the OS refuses
   * encryption: a token written in plaintext would be a worse outcome than an
   * operator who has to reconnect, so this never falls back.
   */
  writeDeviceToken(id: string, token: string): DeviceCredentialWriteResult {
    if (
      typeof token !== 'string' ||
      token.length === 0 ||
      token.length > MAX_TOKEN_LENGTH
    ) {
      return { ok: false, reason: 'invalid-token' };
    }
    const encryption = this.deps.encryption;
    if (!encryption?.isAvailable()) {
      return { ok: false, reason: 'encryption-unavailable' };
    }
    try {
      const encrypted = encryption.encryptString(token);
      const secrets = this.readSecrets();
      secrets.tokens[id] = encrypted.toString('base64');
      writeJsonFileAtomic(this.secretsPath, secrets);
      this.setCredentialFlag(id, true);
      return { ok: true };
    } catch {
      return { ok: false, reason: 'io' };
    }
  }

  /** Null whenever the token is absent, undecryptable, or encryption is off. */
  readDeviceToken(id: string): string | null {
    const encryption = this.deps.encryption;
    if (!encryption?.isAvailable()) return null;
    const stored = this.readSecrets().tokens[id];
    if (typeof stored !== 'string' || stored.length === 0) return null;
    try {
      const plain = encryption.decryptString(Buffer.from(stored, 'base64'));
      return typeof plain === 'string' && plain.length > 0 ? plain : null;
    } catch {
      // A token encrypted under a different OS user or keychain state is not
      // recoverable. Report absence so the caller re-pairs rather than
      // presenting a broken credential as present.
      return null;
    }
  }

  clearDeviceToken(id: string): void {
    const secrets = this.readSecrets();
    if (!(id in secrets.tokens)) {
      this.setCredentialFlag(id, false);
      return;
    }
    delete secrets.tokens[id];
    try {
      writeJsonFileAtomic(this.secretsPath, secrets);
    } catch {
      // Nothing recoverable here; the flag below still stops Exawatt from
      // claiming a credential it cannot read.
    }
    this.setCredentialFlag(id, false);
  }

  private setCredentialFlag(id: string, hasDeviceCredential: boolean): void {
    const records = this.list();
    const index = records.findIndex(record => record.id === id);
    if (index < 0) return;
    if (records[index].hasDeviceCredential === hasDeviceCredential) return;
    const parsed = parseConnectedSourceRecord({
      ...records[index],
      hasDeviceCredential,
    });
    if (!parsed.ok) return;
    records[index] = parsed.record;
    this.persist(records);
  }

  private readSecrets(): SecretsFileShape {
    const parsed = readJsonFile(this.secretsPath);
    const tokens =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as { tokens?: unknown }).tokens
        : null;
    const safe: Record<string, string> = {};
    if (tokens && typeof tokens === 'object' && !Array.isArray(tokens)) {
      for (const [key, value] of Object.entries(tokens)) {
        if (typeof value === 'string' && value.length <= MAX_TOKEN_LENGTH * 2) {
          safe[key] = value;
        }
      }
    }
    return { schemaVersion: RECORDS_SCHEMA_VERSION, tokens: safe };
  }

  private persist(records: readonly ConnectedSourceRecord[]): void {
    writeJsonFileAtomic(this.recordsPath, {
      schemaVersion: RECORDS_SCHEMA_VERSION,
      sources: records,
    });
  }
}

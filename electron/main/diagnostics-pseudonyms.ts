import { createHmac, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Exawatt's own ids, made unlinkable on the way into a bug report.
 *
 * A configured source's id is `source-` plus a SHA-256 of the server it
 * points at (`deriveConnectedSourceId`), and a connected coworker's is
 * `remote-` plus a SHA-256 of that id and its native name. Neither is keyed.
 * That is fine on this machine, beside a records file that already names the
 * server, and it is what keeps a server's coworkers the same people across a
 * detach and a reconnect. It is not fine in a report that leaves the machine:
 * anyone holding a guess at the alias (`prod`, `hetzner`, `user@host:22`)
 * hashes it and learns which server the report is about.
 *
 * So the report, the one artifact that definitely leaves, carries an HMAC of
 * each id under a key only this install holds. Pseudonyms stay stable across
 * this install's reports, so lines still correlate with each other; they no
 * longer correlate with a server. The ids themselves are unchanged, because
 * re-keying them would re-key every stored record, credential, projection
 * row, and open coworker tab for no protection the report does not already
 * get here, and this also covers an id that reached a log another way (a
 * route in a render error, a message).
 */

/** Ids this app derives from infrastructure. Random ids carry nothing. */
const DERIVED_ID = /\b(source|remote)-[0-9a-f]{24}\b/g;

const KEY_FILE = 'diagnostics-pseudonym.key';
const KEY_BYTES = 32;
const KEY_TEXT = /^[0-9a-f]{64}$/;

/**
 * This install's key, created on first use. Null when it can be neither read
 * nor made, which is NOT the same as a missing key: a missing key is made, and
 * an unreadable one withholds every id rather than pretending it was never
 * asked for.
 */
export function readOrCreatePseudonymKey(userDataDir: string): Buffer | null {
  const file = path.join(userDataDir, KEY_FILE);
  let text: string | null = null;
  try {
    text = fs.readFileSync(file, 'utf8').trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') return null;
  }
  if (text !== null && KEY_TEXT.test(text)) return Buffer.from(text, 'hex');
  // Absent, or unusable content that no reader could ever recover a key from.
  const key = randomBytes(KEY_BYTES);
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, key.toString('hex'), { mode: 0o600 });
    fs.renameSync(temporary, file);
    return key;
  } catch {
    return null;
  }
}

/** `source-…` → `source~<12 hex>` under `key`; `source~withheld` without one. */
function pseudonymizeDerivedIds(text: string, key: Buffer | null): string {
  return text.replace(DERIVED_ID, (id, prefix: string) => {
    if (key === null) return `${prefix}~withheld`;
    const digest = createHmac('sha256', key).update(id).digest('hex');
    return `${prefix}~${digest.slice(0, 12)}`;
  });
}

/** The same, over every string in a JSON-shaped value, keys included. */
export function pseudonymizeValue(value: unknown, key: Buffer | null): unknown {
  if (typeof value === 'string') return pseudonymizeDerivedIds(value, key);
  if (Array.isArray(value)) {
    return value.map(entry => pseudonymizeValue(entry, key));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([name, entry]) => [
        pseudonymizeDerivedIds(name, key),
        pseudonymizeValue(entry, key),
      ])
    );
  }
  return value;
}

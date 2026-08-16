/**
 * Public release/source composition contract (ENG-030 OS4/OS5).
 *
 * This implementation is covered by the repository's application license.
 * The interoperable JSON Schema in `contracts/release-provenance-v1.schema.json`
 * is Apache-2.0.
 */

export const RELEASE_PROVENANCE_SCHEMA_VERSION = 1 as const;

export const RELEASE_PROVENANCE_PROFILES = [
  'community',
  'official-desktop',
] as const;

export type ReleaseProvenanceProfile =
  (typeof RELEASE_PROVENANCE_PROFILES)[number];

export interface ReleaseProvenanceCompositionV1 {
  schemaVersion: typeof RELEASE_PROVENANCE_SCHEMA_VERSION;
  profile: ReleaseProvenanceProfile;
  /** Application version without the release tag's optional `v` prefix. */
  version: string;
  /** Exact commit in the public application repository. */
  publicSha: string;
  /** Exact private overlay commit, absent only for a community composition. */
  overlaySha: string | null;
  /** SHA-256 of the exact resolved distribution configuration bytes. */
  distributionSha256: string;
}

export interface ReleaseProvenanceV1 extends ReleaseProvenanceCompositionV1 {
  /** SHA-256 of `canonicalizeReleaseProvenanceCompositionV1(...)`. */
  compositionSha256: string;
}

const COMPOSITION_KEYS = [
  'schemaVersion',
  'profile',
  'version',
  'publicSha',
  'overlaySha',
  'distributionSha256',
] as const;

const PROVENANCE_KEYS = [...COMPOSITION_KEYS, 'compositionSha256'] as const;
const PROFILES = new Set<string>(RELEASE_PROVENANCE_PROFILES);
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

type JsonObject = Record<string, unknown>;

function asJsonObject(value: unknown, label: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object`);
  }
  return value as JsonObject;
}

function assertExactKeys(
  value: JsonObject,
  expected: readonly string[],
  label: string
): void {
  const expectedSet = new Set(expected);
  const unexpected = Object.keys(value).filter(key => !expectedSet.has(key));
  const missing = expected.filter(
    key => !Object.prototype.hasOwnProperty.call(value, key)
  );

  if (missing.length > 0) {
    throw new TypeError(`${label} is missing ${missing.join(', ')}`);
  }
  if (unexpected.length > 0) {
    throw new TypeError(
      `${label} has unknown fields: ${unexpected.join(', ')}`
    );
  }
}

function parseProfile(value: unknown): ReleaseProvenanceProfile {
  if (typeof value !== 'string' || !PROFILES.has(value)) {
    throw new TypeError(
      `profile must be one of ${RELEASE_PROVENANCE_PROFILES.join(', ')}`
    );
  }
  return value as ReleaseProvenanceProfile;
}

function parseMatchingString(
  value: unknown,
  field: string,
  pattern: RegExp,
  description: string
): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new TypeError(`${field} must be ${description}`);
  }
  return value;
}

function parseCompositionFields(
  value: JsonObject
): ReleaseProvenanceCompositionV1 {
  if (value.schemaVersion !== RELEASE_PROVENANCE_SCHEMA_VERSION) {
    throw new TypeError(
      `schemaVersion must be ${RELEASE_PROVENANCE_SCHEMA_VERSION}`
    );
  }

  const profile = parseProfile(value.profile);
  const version = parseMatchingString(
    value.version,
    'version',
    SEMVER_PATTERN,
    'a SemVer version without a v prefix'
  );
  const publicSha = parseMatchingString(
    value.publicSha,
    'publicSha',
    GIT_SHA_PATTERN,
    'a 40-character lowercase Git SHA'
  );
  const distributionSha256 = parseMatchingString(
    value.distributionSha256,
    'distributionSha256',
    SHA256_PATTERN,
    'a 64-character lowercase SHA-256 digest'
  );

  let overlaySha: string | null;
  if (profile === 'community') {
    if (value.overlaySha !== null) {
      throw new TypeError('overlaySha must be null for the community profile');
    }
    overlaySha = null;
  } else {
    overlaySha = parseMatchingString(
      value.overlaySha,
      'overlaySha',
      GIT_SHA_PATTERN,
      'a 40-character lowercase Git SHA for the official-desktop profile'
    );
  }

  return {
    schemaVersion: RELEASE_PROVENANCE_SCHEMA_VERSION,
    profile,
    version,
    publicSha,
    overlaySha,
    distributionSha256,
  };
}

/** Strictly parse the hash input. Unknown fields are rejected. */
export function parseReleaseProvenanceCompositionV1(
  input: unknown
): ReleaseProvenanceCompositionV1 {
  const value = asJsonObject(input, 'ReleaseProvenanceCompositionV1');
  assertExactKeys(value, COMPOSITION_KEYS, 'ReleaseProvenanceCompositionV1');
  return parseCompositionFields(value);
}

/**
 * Strictly parse the record's shape. Use `verifyReleaseProvenanceV1` when the
 * composition digest must also be proven.
 */
export function parseReleaseProvenanceV1(input: unknown): ReleaseProvenanceV1 {
  const value = asJsonObject(input, 'ReleaseProvenanceV1');
  assertExactKeys(value, PROVENANCE_KEYS, 'ReleaseProvenanceV1');
  const composition = parseCompositionFields(value);
  const compositionSha256 = parseMatchingString(
    value.compositionSha256,
    'compositionSha256',
    SHA256_PATTERN,
    'a 64-character lowercase SHA-256 digest'
  );

  return { ...composition, compositionSha256 };
}

/**
 * Return the v1 composition's canonical UTF-8 JSON payload.
 *
 * Keys are emitted in Unicode lexicographic order, matching RFC 8785 for this
 * deliberately narrow value domain. There is no whitespace, byte-order mark,
 * domain prefix, or trailing newline. The digest itself is excluded.
 */
export function canonicalizeReleaseProvenanceCompositionV1(
  input: unknown
): string {
  const value = parseReleaseProvenanceCompositionV1(input);
  return JSON.stringify({
    distributionSha256: value.distributionSha256,
    overlaySha: value.overlaySha,
    profile: value.profile,
    publicSha: value.publicSha,
    schemaVersion: value.schemaVersion,
    version: value.version,
  });
}

function getSubtleCrypto(): Pick<SubtleCrypto, 'digest'> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('Web Crypto SHA-256 support is required');
  }
  return subtle;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), byte =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

/** Hash the canonical composition bytes without reading files or environment. */
export async function hashReleaseProvenanceCompositionV1(
  input: unknown,
  subtle: Pick<SubtleCrypto, 'digest'> = getSubtleCrypto()
): Promise<string> {
  const canonical = canonicalizeReleaseProvenanceCompositionV1(input);
  const digest = await subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical)
  );
  return bytesToHex(digest);
}

/** Build a complete record from its strictly parsed composition inputs. */
export async function createReleaseProvenanceV1(
  input: unknown
): Promise<ReleaseProvenanceV1> {
  const composition = parseReleaseProvenanceCompositionV1(input);
  return {
    ...composition,
    compositionSha256: await hashReleaseProvenanceCompositionV1(composition),
  };
}

/** Parse a record and reject it if any composition field was changed. */
export async function verifyReleaseProvenanceV1(
  input: unknown
): Promise<ReleaseProvenanceV1> {
  const provenance = parseReleaseProvenanceV1(input);
  const { compositionSha256, ...composition } = provenance;
  const expected = await hashReleaseProvenanceCompositionV1(composition);
  if (compositionSha256 !== expected) {
    throw new TypeError(
      `compositionSha256 mismatch: expected ${expected}, received ${compositionSha256}`
    );
  }
  return provenance;
}

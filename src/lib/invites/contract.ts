import { createHash, randomBytes } from 'node:crypto';

/**
 * Invite-code format and policy for the unlisted desktop download
 * (decision 0021).
 *
 * This module is deliberately dependency-free apart from `node:crypto` so the
 * operator CLI (`scripts/issue-invite.mjs`) can import it directly through
 * Node's type stripping and share exactly one definition of the code format
 * with the server. Do not add path-aliased imports here.
 *
 * The gate this backs controls *discovery and attribution*, not access: the
 * signed build itself lives in a public Supabase Storage bucket because
 * `electron-updater` reads it anonymously (decision 0009). Keep the honesty of
 * that boundary intact when changing this file.
 */

/** Crockford base32: no I, L, O, or U, so codes survive being read aloud. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ALPHABET_PATTERN = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]+$/;
const PREFIX = 'EXA';
const GROUP = 5;

/** 20 symbols over a 32-symbol alphabet — 100 bits of entropy. */
export const INVITE_CODE_SYMBOLS = 20;

export interface InviteRecord {
  id: string;
  codeHint: string;
  inviteeName: string;
  inviteeEmail: string | null;
  note: string | null;
  maxRedemptions: number;
  redeemedCount: number;
  /** ISO-8601, or null for an invite that never expires. */
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export type InviteRejectionReason =
  | 'unknown'
  | 'revoked'
  | 'expired'
  | 'exhausted';

export type InviteVerdict =
  | { status: 'valid'; invite: InviteRecord; remainingRedemptions: number }
  | { status: 'rejected'; reason: InviteRejectionReason };

export interface InviteEvaluationContext {
  now: Date;
  /**
   * True when the visitor already holds a recorded redemption of this exact
   * invite. A returning invitee re-downloading the build must not be turned
   * away by a use limit they already consumed; revocation and expiry still
   * apply to them.
   */
  holdsRedemption?: boolean;
}

/**
 * Fold a human-typed or link-carried code into its canonical 20-symbol body.
 * Returns null when the input cannot be a code at all — callers must treat
 * that identically to an unknown code so the page never becomes an oracle.
 */
export function normalizeInviteCode(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 128) return null;
  const compact = raw.toUpperCase().replace(/[^0-9A-Z]/g, '');
  // Only strip the display prefix when doing so leaves an exact-length body;
  // a code whose own body happens to start with EXA must survive a paste
  // that omitted the prefix.
  const body =
    compact.length === PREFIX.length + INVITE_CODE_SYMBOLS &&
    compact.startsWith(PREFIX)
      ? compact.slice(PREFIX.length)
      : compact;
  // Crockford's read-aloud confusions, resolved toward the real alphabet.
  const mapped = body.replace(/[ILO]/g, character =>
    character === 'O' ? '0' : '1'
  );
  if (mapped.length !== INVITE_CODE_SYMBOLS) return null;
  if (!ALPHABET_PATTERN.test(mapped)) return null;
  return mapped;
}

/** Grouped presentation of a canonical body: `EXA-XXXXX-XXXXX-XXXXX-XXXXX`. */
export function formatInviteCode(normalized: string): string {
  const groups: string[] = [];
  for (let index = 0; index < normalized.length; index += GROUP) {
    groups.push(normalized.slice(index, index + GROUP));
  }
  return [PREFIX, ...groups].join('-');
}

/**
 * Lookup key stored in Postgres. Unpeppered SHA-256 is sufficient here: the
 * pre-image is 100 uniformly random bits, so there is nothing to precompute
 * and no low-entropy guess to grind. Storing the digest instead of the code
 * means a database dump yields no working invite links.
 */
export function hashInviteCode(normalized: string): string {
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/** Short, non-secret prefix kept so the operator can recognize a row. */
export function inviteCodeHint(normalized: string): string {
  return `${PREFIX}-${normalized.slice(0, GROUP)}`;
}

export interface GeneratedInviteCode {
  /** What the operator sends. Never stored. */
  display: string;
  normalized: string;
  codeHash: string;
  codeHint: string;
}

export function generateInviteCode(
  randomSource: (size: number) => Uint8Array = randomBytes
): GeneratedInviteCode {
  const bytes = randomSource(INVITE_CODE_SYMBOLS);
  let normalized = '';
  for (let index = 0; index < INVITE_CODE_SYMBOLS; index += 1) {
    // 256 is a whole multiple of 32, so masking is exactly uniform.
    normalized += ALPHABET[bytes[index] & 31];
  }
  return {
    display: formatInviteCode(normalized),
    normalized,
    codeHash: hashInviteCode(normalized),
    codeHint: inviteCodeHint(normalized),
  };
}

/**
 * The single definition of whether an invite may be used right now. Rejection
 * precedence is deliberate: a revoked invite reports revoked even after it
 * would also have expired, because revocation is the operator's decision and
 * is what they need to see in the operator view.
 */
export function evaluateInvite(
  invite: InviteRecord | null,
  context: InviteEvaluationContext
): InviteVerdict {
  if (!invite) return { status: 'rejected', reason: 'unknown' };
  if (invite.revokedAt) return { status: 'rejected', reason: 'revoked' };
  if (invite.expiresAt) {
    const expiry = Date.parse(invite.expiresAt);
    if (!Number.isFinite(expiry)) {
      return { status: 'rejected', reason: 'expired' };
    }
    if (expiry <= context.now.getTime()) {
      return { status: 'rejected', reason: 'expired' };
    }
  }
  const remaining = invite.maxRedemptions - invite.redeemedCount;
  if (remaining <= 0 && !context.holdsRedemption) {
    return { status: 'rejected', reason: 'exhausted' };
  }
  return {
    status: 'valid',
    invite,
    remainingRedemptions: Math.max(remaining, 0),
  };
}

/** Row shape as stored, kept next to the record mapping it produces. */
export interface InviteRow {
  id: string;
  code_hint: string;
  invitee_name: string;
  invitee_email: string | null;
  note: string | null;
  max_redemptions: number;
  redeemed_count: number;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export function inviteRecordFromRow(row: InviteRow): InviteRecord {
  return {
    id: row.id,
    codeHint: row.code_hint,
    inviteeName: row.invitee_name,
    inviteeEmail: row.invitee_email,
    note: row.note,
    maxRedemptions: row.max_redemptions,
    redeemedCount: row.redeemed_count,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

/** Operator-facing status for a row in the invite list. */
export function inviteStatusLabel(
  invite: InviteRecord,
  now: Date = new Date()
): 'active' | 'revoked' | 'expired' | 'used up' {
  const verdict = evaluateInvite(invite, { now });
  if (verdict.status === 'valid') return 'active';
  if (verdict.reason === 'revoked') return 'revoked';
  if (verdict.reason === 'expired') return 'expired';
  return 'used up';
}

import { describe, expect, it } from 'vitest';
import {
  evaluateInvite,
  formatInviteCode,
  generateInviteCode,
  hashInviteCode,
  inviteCodeHint,
  inviteStatusLabel,
  normalizeInviteCode,
  type InviteRecord,
} from './contract';

const NOW = new Date('2026-07-24T12:00:00.000Z');

function invite(overrides: Partial<InviteRecord> = {}): InviteRecord {
  return {
    id: 'invite-1',
    codeHint: 'EXA-7K2M9',
    inviteeName: 'Ada Lovelace',
    inviteeEmail: 'ada@example.com',
    note: null,
    maxRedemptions: 1,
    redeemedCount: 0,
    expiresAt: null,
    revokedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('invite code format', () => {
  it('generates a grouped 20-symbol code whose digest matches its body', () => {
    const generated = generateInviteCode(size => new Uint8Array(size).fill(0));
    expect(generated.normalized).toBe('00000000000000000000');
    expect(generated.display).toBe('EXA-00000-00000-00000-00000');
    expect(generated.codeHint).toBe('EXA-00000');
    expect(generated.codeHash).toBe(hashInviteCode(generated.normalized));
    expect(generated.codeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('draws uniformly from the 32-symbol alphabet', () => {
    // Byte n maps to alphabet[n & 31]; 255 must land on the last symbol.
    const generated = generateInviteCode(size => new Uint8Array(size).fill(255));
    expect(generated.normalized).toBe('ZZZZZZZZZZZZZZZZZZZZ');
  });

  it('normalizes casing, separators, and read-aloud confusions', () => {
    const canonical = 'ABCDE12345FGHJK67890';
    expect(normalizeInviteCode('exa-abcde-12345-fghjk-67890')).toBe(canonical);
    expect(normalizeInviteCode('  ABCDE 12345 FGHJK 67890  ')).toBe(canonical);
    // I and L read as 1, O reads as 0.
    expect(normalizeInviteCode('EXA-ABCDE-I2345-FGHJK-67890')).toBe(canonical);
    expect(normalizeInviteCode('EXA-ABCDE-L2345-FGHJK-67890')).toBe(canonical);
    expect(normalizeInviteCode('EXA-ABCDE-12345-FGHJK-6789O')).toBe(canonical);
  });

  it('keeps a body that itself starts with the display prefix', () => {
    // Stripping "EXA" unconditionally would corrupt this paste.
    const body = 'EXA0123456789ABCDEFG';
    expect(normalizeInviteCode(body)).toBe(body);
    expect(normalizeInviteCode(formatInviteCode(body))).toBe(body);
  });

  it('rejects anything that cannot be a code', () => {
    expect(normalizeInviteCode(null)).toBeNull();
    expect(normalizeInviteCode(42)).toBeNull();
    expect(normalizeInviteCode('')).toBeNull();
    expect(normalizeInviteCode('EXA-ABCDE-12345-FGHJK-6789')).toBeNull();
    expect(normalizeInviteCode('EXA-ABCDE-12345-FGHJK-678901')).toBeNull();
    // U is outside the alphabet and is never mapped to something valid.
    expect(normalizeInviteCode('ABCDE12345FGHJK6789U')).toBeNull();
    expect(normalizeInviteCode('A'.repeat(200))).toBeNull();
  });

  it('derives a hint that reveals only the leading group', () => {
    expect(inviteCodeHint('ABCDE12345FGHJK67890')).toBe('EXA-ABCDE');
  });
});

describe('invite policy', () => {
  it('accepts an unexpired, unrevoked invite with a slot left', () => {
    const verdict = evaluateInvite(invite({ maxRedemptions: 3 }), { now: NOW });
    expect(verdict).toMatchObject({ status: 'valid', remainingRedemptions: 3 });
  });

  it('rejects an unknown invite', () => {
    expect(evaluateInvite(null, { now: NOW })).toEqual({
      status: 'rejected',
      reason: 'unknown',
    });
  });

  it('rejects a revoked invite even when it would otherwise be usable', () => {
    const verdict = evaluateInvite(
      invite({ revokedAt: '2026-07-20T00:00:00.000Z' }),
      { now: NOW }
    );
    expect(verdict).toEqual({ status: 'rejected', reason: 'revoked' });
  });

  it('reports revoked ahead of expired, because revoking was a decision', () => {
    const verdict = evaluateInvite(
      invite({
        revokedAt: '2026-07-20T00:00:00.000Z',
        expiresAt: '2026-07-01T00:00:00.000Z',
      }),
      { now: NOW }
    );
    expect(verdict).toEqual({ status: 'rejected', reason: 'revoked' });
  });

  it('rejects an invite at or past its expiry', () => {
    expect(
      evaluateInvite(invite({ expiresAt: NOW.toISOString() }), { now: NOW })
    ).toEqual({ status: 'rejected', reason: 'expired' });
    expect(
      evaluateInvite(invite({ expiresAt: '2026-07-24T11:59:59.000Z' }), {
        now: NOW,
      })
    ).toEqual({ status: 'rejected', reason: 'expired' });
    expect(
      evaluateInvite(invite({ expiresAt: '2026-07-24T12:00:01.000Z' }), {
        now: NOW,
      })
    ).toMatchObject({ status: 'valid' });
  });

  it('treats an unparseable expiry as expired rather than as no expiry', () => {
    expect(
      evaluateInvite(invite({ expiresAt: 'whenever' }), { now: NOW })
    ).toEqual({ status: 'rejected', reason: 'expired' });
  });

  it('rejects an invite whose uses are spent', () => {
    expect(
      evaluateInvite(invite({ maxRedemptions: 2, redeemedCount: 2 }), {
        now: NOW,
      })
    ).toEqual({ status: 'rejected', reason: 'exhausted' });
  });

  it('lets a holder of an existing redemption past a spent use limit', () => {
    expect(
      evaluateInvite(invite({ maxRedemptions: 1, redeemedCount: 1 }), {
        now: NOW,
        holdsRedemption: true,
      })
    ).toMatchObject({ status: 'valid', remainingRedemptions: 0 });
  });

  it('does not let a holder past revocation or expiry', () => {
    expect(
      evaluateInvite(invite({ revokedAt: NOW.toISOString() }), {
        now: NOW,
        holdsRedemption: true,
      })
    ).toEqual({ status: 'rejected', reason: 'revoked' });
    expect(
      evaluateInvite(invite({ expiresAt: '2026-01-01T00:00:00.000Z' }), {
        now: NOW,
        holdsRedemption: true,
      })
    ).toEqual({ status: 'rejected', reason: 'expired' });
  });

  it('labels rows for the operator view', () => {
    expect(inviteStatusLabel(invite(), NOW)).toBe('active');
    expect(inviteStatusLabel(invite({ revokedAt: '2026-07-01' }), NOW)).toBe(
      'revoked'
    );
    expect(
      inviteStatusLabel(invite({ expiresAt: '2026-07-01T00:00:00Z' }), NOW)
    ).toBe('expired');
    expect(inviteStatusLabel(invite({ redeemedCount: 1 }), NOW)).toBe('used up');
  });
});

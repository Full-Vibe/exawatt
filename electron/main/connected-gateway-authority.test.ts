import { describe, expect, it } from 'vitest';
import {
  H1_READ_METHODS,
  H1_READ_SCOPES,
  H2_WRITE_METHODS,
  H2_WRITE_SCOPES,
  SCOPES_FOR_AUTHORITY,
  authorityForGrantedScopes,
  isH1ReadMethod,
  isH2WriteMethod,
  narrowerAuthority,
} from './connected-gateway-authority';

/**
 * The security vocabulary of a connected source (ENG-010 H1, ENG-033 H2).
 *
 * These cases moved here with the vocabularies they guard. They never needed a
 * session: what they assert is that the words themselves are the right words,
 * which is the assertion that has to survive somebody adding a method to a
 * list in a hurry.
 */

describe('the authority vocabularies', () => {
  it('allows exactly the Gateway operator.write methods and no pause verb', () => {
    expect([...H2_WRITE_METHODS]).toEqual([
      'chat.send',
      'chat.abort',
      'sessions.steer',
      'tasks.cancel',
    ]);
    expect(H2_WRITE_METHODS.join(' ')).not.toMatch(/pause|resume|stop/iu);
    expect([...H2_WRITE_SCOPES]).toEqual(['operator.read', 'operator.write']);
  });

  it('never puts an admin method on either surface', () => {
    const admin = [
      'cron.add',
      'cron.remove',
      'cron.update',
      'config.set',
      'config.get',
      'agents.create',
      'agents.delete',
    ];
    for (const method of admin) {
      expect(H1_READ_METHODS).not.toContain(method);
      expect(H2_WRITE_METHODS).not.toContain(method);
    }
    expect(JSON.stringify(SCOPES_FOR_AUTHORITY)).not.toContain(
      'operator.admin'
    );
  });

  it('maps each authority to the scopes it presents', () => {
    expect(SCOPES_FOR_AUTHORITY.read).toEqual([...H1_READ_SCOPES]);
    expect(SCOPES_FOR_AUTHORITY.write).toEqual([...H2_WRITE_SCOPES]);
  });

  it('reads write out of granted scopes only when the write scope is there', () => {
    expect(authorityForGrantedScopes(['operator.read'])).toBe('read');
    expect(authorityForGrantedScopes(['operator.read', 'operator.write'])).toBe(
      'write'
    );
    expect(authorityForGrantedScopes([])).toBe('read');
    expect(authorityForGrantedScopes(['operator.admin'])).toBe('read');
    expect(authorityForGrantedScopes(['operator.writer'])).toBe('read');
  });

  it('keeps the two tiers disjoint, so neither guard can reach the other', () => {
    for (const method of H1_READ_METHODS) {
      expect(isH1ReadMethod(method)).toBe(true);
      expect(isH2WriteMethod(method)).toBe(false);
    }
    for (const method of H2_WRITE_METHODS) {
      expect(isH2WriteMethod(method)).toBe(true);
      expect(isH1ReadMethod(method)).toBe(false);
    }
  });

  it('refuses a method nobody put on a list', () => {
    for (const method of ['', 'chat.SEND', 'gateway.stop', 'agents.delete']) {
      expect(isH1ReadMethod(method)).toBe(false);
      expect(isH2WriteMethod(method)).toBe(false);
    }
  });

  it('only calls an intersection write when both halves are write', () => {
    // Asked and granted, intersected. Everything except write-and-write is
    // observation, so no combination of a hopeful ask and a quiet Gateway can
    // add up to authority.
    expect(narrowerAuthority('write', 'write')).toBe('write');
    expect(narrowerAuthority('write', 'read')).toBe('read');
    expect(narrowerAuthority('read', 'write')).toBe('read');
    expect(narrowerAuthority('read', 'read')).toBe('read');
  });
});

import { describe, expect, it } from 'vitest';
import {
  PERMISSIONS,
  PERMISSION_STATE_LABELS,
  ensureOutcome,
  isPermissionId,
  permissionAction,
  permissionDeclaration,
  stateFromRead,
  type PermissionState,
} from '../permissions';

const STATES = Object.keys(PERMISSION_STATE_LABELS) as PermissionState[];

describe('the permission registry', () => {
  it('declares each grant once, and every declaration can be looked up', () => {
    const ids = PERMISSIONS.map(permission => permission.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(isPermissionId(id)).toBe(true);
      expect(permissionDeclaration(id).id).toBe(id);
    }
  });

  it('refuses an id nothing declared', () => {
    expect(isPermissionId('camera')).toBe(false);
    expect(isPermissionId(undefined)).toBe(false);
    expect(() => permissionDeclaration('camera' as never)).toThrow();
  });

  it('names who enforces every grant and, for an OS grant, where to change it', () => {
    for (const permission of PERMISSIONS) {
      expect(permission.enforcedBy).not.toBe('');
      if (permission.kind === 'os') {
        expect(permission.settingsPath).not.toBe('');
        expect(permission.settingsLink).toMatch(/^x-apple\.systempreferences:/);
      }
    }
  });
});

describe('a status that cannot be read', () => {
  it('is unknown, never denied', () => {
    expect(stateFromRead({ ok: false })).toBe('unknown');
    expect(stateFromRead({ ok: false })).not.toBe('denied');
  });

  it('carries a read state through unchanged', () => {
    for (const state of STATES) {
      expect(stateFromRead({ ok: true, state })).toBe(state);
    }
  });

  it('is asked about like a grant nobody answered, and never sent to System Settings', () => {
    expect(ensureOutcome('unknown', false)).toBe('primer');
    expect(ensureOutcome('unknown', true)).toBe('request');
    expect(permissionAction('unknown')).toBe('allow');
    expect(PERMISSION_STATE_LABELS.unknown).not.toBe(
      PERMISSION_STATE_LABELS.denied
    );
  });
});

describe('ensure', () => {
  it.each([
    ['granted', false, 'ready'],
    ['granted', true, 'ready'],
    ['needs-relaunch', false, 'relaunch'],
    ['denied', false, 'settings'],
    ['denied', true, 'settings'],
    ['restricted', false, 'settings'],
    ['not-determined', false, 'primer'],
    ['not-determined', true, 'request'],
  ] as const)('%s, primed %s: %s', (state, primed, outcome) => {
    expect(ensureOutcome(state, primed)).toBe(outcome);
  });

  it('raises a system prompt only for a user the primer was shown to', () => {
    for (const state of STATES) {
      expect(ensureOutcome(state, false)).not.toBe('request');
    }
  });

  it('never raises a prompt for a grant macOS already answered', () => {
    for (const state of ['granted', 'denied', 'restricted'] as const) {
      expect(ensureOutcome(state, true)).not.toBe('request');
    }
  });
});

describe('what Settings offers', () => {
  it('offers Allow only where asking can still change the answer', () => {
    for (const state of STATES) {
      const action = permissionAction(state);
      const asks = ensureOutcome(state, true) === 'request';
      expect(action === 'allow').toBe(asks);
    }
  });

  it('offers System Settings for a denial and nothing for a grant', () => {
    expect(permissionAction('denied')).toBe('open-settings');
    expect(permissionAction('granted')).toBeNull();
  });

  it('labels every state', () => {
    for (const state of STATES) {
      expect(PERMISSION_STATE_LABELS[state]).not.toBe('');
    }
  });
});

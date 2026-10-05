import { describe, expect, it } from 'vitest';
import {
  SAFETY_CONTROLS,
  SAFETY_POLICY_PREVIEWS,
  isSafetyControlId,
  type SafetyPolicyPreviewId,
} from './safety-controls';

describe('safety declarations (ENG-044)', () => {
  it('a policy preview is never a control enforcement can read or store', () => {
    // `isSafetyControlId` is the one door to the settings store and the IPC
    // write; a preview id that passed it would be stored and never enforced.
    const previewIds: SafetyPolicyPreviewId[] = SAFETY_POLICY_PREVIEWS.map(
      preview => preview.id
    );
    for (const id of previewIds) {
      expect(isSafetyControlId(id)).toBe(false);
    }
    for (const preview of SAFETY_POLICY_PREVIEWS) {
      expect(preview.enforcement).toBe('preview');
      expect(preview).not.toHaveProperty('enforcedBy');
      expect(preview).not.toHaveProperty('takesEffect');
    }
  });

  it('every enforced control names its enforcer and passes the id check', () => {
    for (const control of SAFETY_CONTROLS) {
      expect(control.enforcement).toBe('enforced');
      expect(isSafetyControlId(control.id)).toBe(true);
      expect(control.enforcedBy).not.toBe('');
      expect(control.takesEffect).not.toBe('');
    }
  });

  it('declares each id once across controls and previews', () => {
    const ids = [...SAFETY_CONTROLS, ...SAFETY_POLICY_PREVIEWS].map(
      declaration => declaration.id
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});

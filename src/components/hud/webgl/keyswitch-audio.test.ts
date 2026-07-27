import { describe, expect, it } from 'vitest';
import {
  KEYSWITCH_SOUND_PROFILES,
  KEYSWITCH_VARIANT_SOUND_PROFILES,
} from './keyswitch-audio';

describe('keyswitch sound profiles', () => {
  it('assigns one distinct sound to every gallery variant', () => {
    const assignments = Object.values(KEYSWITCH_VARIANT_SOUND_PROFILES);

    expect(assignments).toHaveLength(7);
    expect(new Set(assignments).size).toBe(assignments.length);
    expect(assignments.every(id => id in KEYSWITCH_SOUND_PROFILES)).toBe(true);
  });

  it('keeps every synthesized material signature quiet, finite, and distinct', () => {
    const profiles = Object.values(KEYSWITCH_SOUND_PROFILES);
    const signatures = profiles.map(profile =>
      [
        profile.bodyFrequency,
        profile.tickFrequency,
        profile.noiseFrequency,
        profile.durationSeconds,
      ].join(':')
    );

    expect(new Set(profiles.map(profile => profile.label)).size).toBe(
      profiles.length
    );
    expect(new Set(signatures).size).toBe(profiles.length);

    for (const profile of profiles) {
      expect(profile.bodyFrequency).toBeGreaterThan(0);
      expect(profile.tickFrequency).toBeGreaterThan(profile.bodyFrequency);
      expect(profile.noiseFrequency).toBeGreaterThan(profile.bodyFrequency);
      expect(profile.durationSeconds).toBeGreaterThan(0);
      expect(profile.durationSeconds).toBeLessThan(0.15);
      expect(
        profile.bodyGain + profile.tickGain + profile.noiseGain
      ).toBeLessThan(0.1);
    }
  });
});

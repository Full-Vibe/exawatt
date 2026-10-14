import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MOTION,
  motionParam,
  parseMotion,
  toggleGlow,
} from './crust-motion';

describe('working motion', () => {
  it('reads a missing motion as the default', () => {
    expect(parseMotion(null)).toEqual(DEFAULT_MOTION);
  });

  it('combines light motions and keeps one lift', () => {
    const motion = parseMotion('sheen.breathe.wave');
    expect(motion).toEqual({
      sheen: true,
      breathe: true,
      wander: false,
      pulse: false,
      spin: false,
      lift: 'wave',
    });
    expect(parseMotion(motionParam(motion))).toEqual(motion);
  });

  it('reads the single motions of an older link', () => {
    expect(parseMotion('bob')).toEqual({
      sheen: false,
      breathe: false,
      wander: false,
      pulse: false,
      spin: false,
      lift: 'bob',
    });
    expect(parseMotion('pulse').pulse).toBe(true);
  });

  it('writes no motion as still and reads it back as nothing', () => {
    const none = {
      sheen: false,
      breathe: false,
      wander: false,
      pulse: false,
      spin: false,
      lift: 'still' as const,
    };
    expect(motionParam(none)).toBe('still');
    expect(parseMotion('still')).toEqual(none);
  });

  it('reads the lantern and the turning mark alongside the rest', () => {
    const motion = parseMotion('sheen.wander.spin.bob');
    expect(motion.wander).toBe(true);
    expect(motion.spin).toBe(true);
    expect(motion.lift).toBe('bob');
    expect(parseMotion(motionParam(motion))).toEqual(motion);
  });

  it('toggles one light motion and leaves the rest', () => {
    const next = toggleGlow(DEFAULT_MOTION, 'breathe');
    expect(next.breathe).toBe(true);
    expect(next.sheen).toBe(true);
    expect(toggleGlow(next, 'sheen').sheen).toBe(false);
  });
});

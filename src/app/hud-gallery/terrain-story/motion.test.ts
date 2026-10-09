import { describe, expect, it, vi } from 'vitest';
import {
  copyOpacity,
  createMotionPort,
  sampleStoryPose,
  storyFleetCount,
  type StoryPose,
} from './motion';

const pose = (progress: number) => {
  const out: StoryPose = { yaw: 0, pitch: 0, zoom: 0, x: 0, y: 0 };
  sampleStoryPose(progress, out);
  return out;
};
describe('continuous terrain story', () => {
  it('grows a bounded, reversible fleet as the story advances', () => {
    const counts = Array.from({ length: 501 }, (_, i) =>
      storyFleetCount(i / 100)
    );
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
      expect(counts[i]).toBeLessThanOrEqual(100);
      expect(counts[i]).toBe(storyFleetCount(i / 100));
    }
    expect(counts.at(-1)).toBeGreaterThan(counts[0]);
  });
  it('does not cut the camera at either copy changes or chapter endpoints', () => {
    for (let boundary = 0.5; boundary <= 5; boundary += 0.5) {
      const before = pose(boundary - 0.00001),
        after = pose(boundary + 0.00001);
      for (const key of Object.keys(before) as (keyof StoryPose)[])
        expect(Math.abs(after[key] - before[key])).toBeLessThan(0.001);
    }
  });
  it('is reversible and keeps finite positive zoom outside the scroll range', () => {
    const forwards = Array.from({ length: 51 }, (_, i) => pose(i / 10));
    for (let i = 50; i >= 0; i--) expect(pose(i / 10)).toEqual(forwards[i]);
    for (const p of [-100, 100])
      for (const value of Object.values(pose(p)))
        expect(Number.isFinite(value)).toBe(true);
    expect(pose(-100).zoom).toBeGreaterThan(0);
  });
  it('hides both copy panels while their semantic identity changes', () => {
    for (let i = 0; i < 5; i++) {
      expect(copyOpacity(i + 0.5, i)).toBeLessThan(0.2);
      expect(copyOpacity(i + 0.5, i + 1)).toBeLessThan(0.2);
    }
  });
  it('shares one orbit between dragging, buttons and scroll without resetting it', () => {
    const port = createMotionPort(),
      listener = vi.fn();
    const remove = port.subscribe(listener);
    port.orbit(0.2, 0.1);
    port.orbit(0.3, 0);
    port.change({ progress: 2 });
    expect(port.read().yaw).toBeCloseTo(0.5);
    expect(port.read().pitch).toBeCloseTo(0.1);
    expect(listener).toHaveBeenCalledTimes(3);
    remove();
    port.orbit(0, 100);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(port.read().pitch).toBeLessThan(1);
  });
});

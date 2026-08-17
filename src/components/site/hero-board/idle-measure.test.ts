import { describe, expect, it } from 'vitest';
import {
  CHANGED_CHANNEL_THRESHOLD,
  compareFrames,
  gradeIdleDelta,
} from './idle-measure';
import { IDLE_BUDGET } from './idle-options';

function frame(pixels: number[][]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b], index) => {
    data[index * 4] = r!;
    data[index * 4 + 1] = g!;
    data[index * 4 + 2] = b!;
    data[index * 4 + 3] = 255;
  });
  return data;
}

describe('idle measurement', () => {
  it('reports a still board as zero motion', () => {
    const still = frame([
      [10, 12, 16],
      [10, 12, 16],
    ]);
    const delta = compareFrames(still, still);
    expect(delta.meanChannelDelta).toBe(0);
    expect(delta.changedPixelShare).toBe(0);
    expect(gradeIdleDelta(delta, IDLE_BUDGET).ok).toBe(true);
  });

  it('ignores sub-threshold dither but counts a real move', () => {
    const before = frame([
      [10, 10, 10],
      [10, 10, 10],
      [10, 10, 10],
      [10, 10, 10],
    ]);
    const after = frame([
      // one channel below the threshold: not a changed pixel
      [11, 10, 10],
      [10, 10, 10],
      [10, 10, 10],
      // a real move
      [10, 10, 90],
    ]);
    const delta = compareFrames(after, before);
    expect(CHANGED_CHANNEL_THRESHOLD).toBe(2);
    expect(delta.changedPixelShare).toBe(0.25);
    expect(delta.maxChannelDelta).toBe(80);
  });

  it('grades the screensaver band apart from over budget', () => {
    const overBudget = gradeIdleDelta(
      {
        meanChannelDelta: 1.9,
        changedPixelShare: 0.07,
        maxChannelDelta: 40,
        pixels: 1000,
      },
      IDLE_BUDGET
    );
    expect(overBudget.meanOk).toBe(true);
    expect(overBudget.shareOk).toBe(false);
    expect(overBudget.screensaver).toBe(false);

    const screensaver = gradeIdleDelta(
      {
        meanChannelDelta: 3,
        changedPixelShare: 0.2,
        maxChannelDelta: 200,
        pixels: 1000,
      },
      IDLE_BUDGET
    );
    expect(screensaver.screensaver).toBe(true);
    expect(screensaver.ok).toBe(false);
  });
});

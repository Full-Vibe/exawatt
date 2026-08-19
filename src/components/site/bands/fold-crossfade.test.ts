import { describe, expect, it } from 'vitest';
import {
  FOLD_BOARD_INTERACTIVE_AT,
  FOLD_CROSSFADE_SCREENS,
  crossfadeClearsFirstSnapPoint,
  foldBoardInteractive,
  foldBoardOpacity,
  foldCrossfadeProgress,
  foldImageOpacity,
} from './fold-crossfade';
import { HOMEPAGE_BANDS } from './manifest';

const STICKY = 810;

describe('the fold dissolve', () => {
  it('is a pure function of position, so scrolling back up reverses it', () => {
    const down = [0, 100, 300, 600].map(y =>
      foldCrossfadeProgress(y, STICKY)
    );
    const up = [600, 300, 100, 0].map(y => foldCrossfadeProgress(y, STICKY));
    expect(up).toEqual([...down].reverse());
  });

  it('opens on the image and ends on the board', () => {
    expect(foldImageOpacity(0)).toBe(1);
    expect(foldBoardOpacity(0)).toBe(0);
    expect(foldImageOpacity(1)).toBe(0);
    expect(foldBoardOpacity(1)).toBe(1);
  });

  it('holds the image at the very top so a nudge does not flicker the hero', () => {
    expect(foldImageOpacity(foldCrossfadeProgress(40, STICKY))).toBe(1);
  });

  it('never dips through a flat frame: the two layers overlap throughout', () => {
    for (let i = 0; i <= 100; i += 1) {
      const t = i / 100;
      expect(foldImageOpacity(t) + foldBoardOpacity(t)).toBeGreaterThan(0.85);
    }
  });

  it('brings the board to full strength before the image finishes leaving', () => {
    const full = Array.from({ length: 101 }, (_, i) => i / 100).find(
      t => foldBoardOpacity(t) >= 0.999
    );
    expect(full).toBeDefined();
    expect(foldImageOpacity(full as number)).toBeGreaterThan(0);
  });

  it('opens the board to a pointer only once the image is effectively gone', () => {
    expect(foldBoardInteractive(FOLD_BOARD_INTERACTIVE_AT - 0.01)).toBe(false);
    expect(foldBoardInteractive(FOLD_BOARD_INTERACTIVE_AT)).toBe(true);
    expect(foldImageOpacity(FOLD_BOARD_INTERACTIVE_AT)).toBeLessThan(0.05);
  });

  it('is measured against the pinned box, so every viewport sees the same dissolve', () => {
    const short = foldCrossfadeProgress(0.5 * FOLD_CROSSFADE_SCREENS * 600, 600);
    const tall = foldCrossfadeProgress(0.5 * FOLD_CROSSFADE_SCREENS * 1200, 1200);
    expect(short).toBeCloseTo(tall, 10);
  });

  it('finishes before the first snap point, so no settle strands a half-dissolved hero', () => {
    const fold = HOMEPAGE_BANDS.find(band => band.headingRole === 'headline');
    const run = HOMEPAGE_BANDS.filter(
      band => band.status === 'proposed' || band.status === 'shipped'
    );
    const next = run[run.findIndex(band => band.headingRole === 'headline') + 1];
    expect(fold).toBeDefined();
    expect(next).toBeDefined();
    for (const [viewport, sticky] of [
      [810, 810],
      [720, 720],
      [844, 800],
      [1200, 1140],
    ] as const) {
      expect(
        crossfadeClearsFirstSnapPoint(
          fold?.screens ?? 1,
          next?.screens ?? 1,
          viewport,
          sticky
        )
      ).toBe(true);
    }
  });
});

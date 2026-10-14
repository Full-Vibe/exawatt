import { describe, expect, it } from 'vitest';
import {
  fingerVelocity,
  nearestStop,
  pageStops,
  releaseGlide,
  releaseStop,
} from './touch-pager';

const FRAMES = [0, 700, 1600, 2500, 3200];

describe('the stops a finger pages between', () => {
  it('are the scenes alone when the page ends with the story', () => {
    expect(pageStops(FRAMES, 3200, 800)).toEqual(FRAMES);
  });

  it('end at the bottom of the page when a footer fits on a screen', () => {
    expect(pageStops(FRAMES, 3700, 800)).toEqual([...FRAMES, 3700]);
  });

  it('never skip more than a screen of a footer taller than one', () => {
    const stops = pageStops(FRAMES, 3200 + 1500, 800);
    expect(stops.at(-1)).toBe(4700);
    for (let i = FRAMES.length; i < stops.length; i += 1)
      expect(stops[i] - stops[i - 1]).toBeLessThanOrEqual(800);
  });

  it('never ask for a scroll past the end of the page', () => {
    expect(pageStops([0, 500, 900], 800, 800)).toEqual([0, 500, 800]);
  });
});

describe('where the page goes when the finger lifts', () => {
  it('goes on to the next scene on a flick from a scene', () => {
    expect(releaseStop(FRAMES, 700, 0.5, 700)).toBe(2);
    expect(releaseStop(FRAMES, 700, -0.5, 700)).toBe(0);
  });

  it('stays inside the page at either end', () => {
    expect(releaseStop(FRAMES, 0, -2, 0)).toBe(0);
    expect(releaseStop(FRAMES, 3200, 2, 3200)).toBe(4);
  });

  it('follows a flick between two scenes, so a flick back cancels a drag', () => {
    expect(releaseStop(FRAMES, 900, 0.5, 700)).toBe(2);
    expect(releaseStop(FRAMES, 900, -0.5, 700)).toBe(1);
  });

  it('flicks from the speed it names, and not below it', () => {
    // a short drag forward, released slowly, returns; the same drag
    // released at the flick speed goes on
    expect(releaseStop(FRAMES, 750, 0.29, 700)).toBe(1);
    expect(releaseStop(FRAMES, 750, 0.3, 700)).toBe(2);
  });

  it('commits a slow drag once it has gone a little of the way', () => {
    // 900 px between scenes 1 and 2: the commit is at 22%
    expect(releaseStop(FRAMES, 700 + 900 * 0.2, 0, 700)).toBe(1);
    expect(releaseStop(FRAMES, 700 + 900 * 0.24, 0, 700)).toBe(2);
    expect(releaseStop(FRAMES, 1600 - 900 * 0.2, 0, 1600)).toBe(2);
    expect(releaseStop(FRAMES, 1600 - 900 * 0.24, 0, 1600)).toBe(1);
  });

  it('reads a slow drag by the way the finger went', () => {
    // three quarters of the way from 1 to 2, released slowly: dragged
    // forward from 1 it committed; dragged back from 2 it did too
    expect(releaseStop(FRAMES, 700 + 900 * 0.75, 0, 700)).toBe(2);
    expect(releaseStop(FRAMES, 700 + 900 * 0.75, 0, 1600)).toBe(1);
  });

  it('never turns a caught glide round unless the finger did', () => {
    // a glide from 1 to 2 caught at 60% and nudged on: it goes on to 2
    expect(releaseStop(FRAMES, 700 + 900 * 0.65, 0, 700 + 900 * 0.6)).toBe(2);
    // pulled back instead, it goes back to 1
    expect(releaseStop(FRAMES, 700 + 900 * 0.5, 0, 700 + 900 * 0.6)).toBe(1);
  });

  it('rests where it is when the finger lifts on a stop', () => {
    expect(releaseStop(FRAMES, 1600, 0, 700)).toBe(2);
    expect(releaseStop(FRAMES, 1600.5, 0.1, 1600)).toBe(2);
  });

  it('goes from the last scene to the end of the page and back', () => {
    const stops = [...FRAMES, 3700];
    expect(releaseStop(stops, 3260, 0.6, 3200)).toBe(5);
    expect(releaseStop(stops, 3640, -0.6, 3700)).toBe(4);
  });

  it('finds the stop nearest a position', () => {
    expect(nearestStop(FRAMES, 1100)).toBe(1);
    expect(nearestStop(FRAMES, 1200)).toBe(2);
    expect(nearestStop(FRAMES, -40)).toBe(0);
  });
});

describe("the finger's speed at release", () => {
  it('is measured over the last tenth of a second', () => {
    const samples = [
      { t: 0, y: 0 },
      { t: 100, y: -10 },
      { t: 150, y: -60 },
      { t: 200, y: -110 },
    ];
    // from t=100 to t=200: 100 px in 100 ms, up the screen
    expect(fingerVelocity(samples, 205)).toBeCloseTo(-1, 6);
  });

  it('is nothing when the finger rested before it lifted', () => {
    const samples = [
      { t: 0, y: 0 },
      { t: 16, y: -40 },
    ];
    expect(fingerVelocity(samples, 16 + 69)).not.toBe(0);
    expect(fingerVelocity(samples, 16 + 71)).toBe(0);
  });

  it('is nothing for a single sample', () => {
    expect(fingerVelocity([{ t: 0, y: 3 }], 1)).toBe(0);
  });
});

describe('the glide to a stop', () => {
  const sample = (ease: (tau: number) => number) =>
    Array.from({ length: 201 }, (_, i) => ease(i / 200));

  it('starts where the finger let go and arrives exactly', () => {
    const { ease } = releaseGlide(600, 1, 800);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
  });

  it('never overshoots its stop and never turns back', () => {
    for (const velocity of [0, 0.2, 0.8, 2, 6, -1]) {
      const values = sample(releaseGlide(600, velocity, 800).ease);
      for (let i = 1; i < values.length; i += 1) {
        expect(values[i]).toBeGreaterThanOrEqual(values[i - 1] - 1e-12);
        expect(values[i]).toBeLessThanOrEqual(1 + 1e-12);
      }
    }
  });

  it("starts at the finger's own speed", () => {
    const velocity = 0.9;
    const { duration, ease } = releaseGlide(600, velocity, 800);
    const h = 1e-4;
    const start = ((ease(h) - ease(0)) / h) * (600 / duration);
    expect(start).toBeCloseTo(velocity, 3);
  });

  it('starts from rest when the finger was going the other way', () => {
    const { ease } = releaseGlide(600, -0.8, 800);
    const h = 1e-4;
    expect((ease(h) - ease(0)) / h).toBeCloseTo(0, 3);
  });

  it('is quicker for a short return and for a fast finger', () => {
    const short = releaseGlide(80, 0, 800).duration;
    const whole = releaseGlide(700, 0, 800).duration;
    const fast = releaseGlide(700, 3, 800).duration;
    expect(short).toBeLessThan(whole);
    expect(fast).toBeLessThan(whole);
    expect(whole).toBeLessThanOrEqual(720);
    expect(short).toBeGreaterThanOrEqual(240);
  });
});

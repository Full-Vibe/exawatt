import { describe, expect, it } from 'vitest';
import { WheelPager, type PagerVerdict } from './page-gesture';

/** The animation the page runs for a move, in milliseconds. */
const MOVE_MS = 880;

interface Ev {
  t: number;
  dy: number;
}

/** A small seeded generator, so a failing trace can be replayed. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface FlickOptions {
  start: number;
  peak: number;
  /** Events per second. */
  hz?: number;
  rampMs?: number;
  holdMs?: number;
  /** How long the momentum takes to fall to nothing. */
  tailMs?: number;
  /** Multiplicative noise on every event, 0 to 1. */
  noise?: number;
  /** Bumps added to the tail, as a fraction of the tail value there. */
  bumps?: number;
  seed?: number;
  direction?: 1 | -1;
  /** Cut the stream here, as when a finger lands and stops the momentum. */
  cutAt?: number;
}

/** A trackpad flick: a ramp, a peak, then momentum that decays but is not
 *  clean, in whole pixels like the browser sends. */
function flick(o: FlickOptions): Ev[] {
  const random = rng(o.seed ?? 1);
  const hz = o.hz ?? 60;
  const step = 1000 / hz;
  const rampMs = o.rampMs ?? 120;
  const holdMs = o.holdMs ?? 60;
  const tailMs = o.tailMs ?? 1400;
  const noise = o.noise ?? 0.15;
  const direction = o.direction ?? 1;
  const tau = tailMs / Math.log(Math.max(o.peak, 2));
  const bumpAt: number[] = [];
  for (let i = 0; i < (o.bumps ?? 0); i += 1)
    bumpAt.push(rampMs + holdMs + random() * tailMs * 0.9);
  const out: Ev[] = [];
  for (let t = 0; t <= rampMs + holdMs + tailMs; t += step) {
    if (o.cutAt !== undefined && t > o.cutAt) break;
    let v: number;
    if (t < rampMs) {
      const x = t / rampMs;
      v = 1 + (o.peak - 1) * x * x * (3 - 2 * x);
    } else if (t < rampMs + holdMs) v = o.peak;
    else v = o.peak * Math.exp(-(t - rampMs - holdMs) / tau);
    for (const b of bumpAt) {
      const d = t - b;
      if (d >= 0 && d < 90) v *= 1 + 0.9 * Math.sin((Math.PI * d) / 90);
    }
    v *= 1 + noise * (random() - 0.5) * 2;
    const dy = Math.round(v) * direction;
    if (dy !== 0) out.push({ t: o.start + t, dy });
  }
  return out;
}

interface Run {
  moves: { t: number; dir: 'next' | 'prev' }[];
  passes: number[];
  verdicts: PagerVerdict[];
}

/** Feed a trace to a pager, landing each move after the page's animation. */
function run(
  events: Ev[],
  canMove: (dir: 1 | -1, t: number) => boolean = () => true,
  pager = new WheelPager()
): Run {
  const result: Run = { moves: [], passes: [], verdicts: [] };
  let landsAt = Number.POSITIVE_INFINITY;
  for (const e of events) {
    if (e.t >= landsAt) {
      pager.moveEnded();
      landsAt = Number.POSITIVE_INFINITY;
    }
    const verdict = pager.wheel(e.dy, e.t, dir => canMove(dir, e.t));
    result.verdicts.push(verdict);
    if (verdict === 'next' || verdict === 'prev') {
      result.moves.push({ t: e.t, dir: verdict });
      landsAt = e.t + MOVE_MS;
    }
    if (verdict === 'pass') result.passes.push(e.t);
  }
  return result;
}

describe('one scene per gesture', () => {
  it('moves once for a flick, whatever its tail does', () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 400; seed += 1) {
      const random = rng(seed * 7919);
      const events = flick({
        start: 0,
        peak: 20 + random() * 180,
        hz: random() < 0.5 ? 60 : 120,
        rampMs: 60 + random() * 160,
        holdMs: random() * 120,
        tailMs: 600 + random() * 1800,
        noise: 0.5 * random(),
        bumps: Math.floor(random() * 4),
        seed,
      });
      const result = run(events);
      if (result.moves.length !== 1)
        failures.push(`seed ${seed}: ${result.moves.length} moves`);
    }
    expect(failures).toEqual([]);
  });

  it('survives the exact failure: a bump in the tail after the move lands', () => {
    // a clean flick, then a bump of the size of a small flick 1.3 s later,
    // while the tail is still running
    const events = flick({ start: 0, peak: 80, tailMs: 2000, noise: 0.05 });
    const bumped = events.map(e =>
      e.t > 1250 && e.t < 1350 ? { ...e, dy: e.dy * 6 } : e
    );
    expect(run(bumped).moves).toHaveLength(1);
  });

  it('survives a frame hitch inside the tail', () => {
    const events = flick({ start: 0, peak: 90, tailMs: 2200, noise: 0.1 });
    // the page stalls for 170 ms at 1.1 s: the events inside it arrive late,
    // together, as one coalesced delta
    const stalled: Ev[] = [];
    let held = 0;
    for (const e of events) {
      if (e.t > 1100 && e.t < 1270) held += e.dy;
      else {
        if (held) {
          stalled.push({ t: 1270, dy: held });
          held = 0;
        }
        stalled.push(e);
      }
    }
    expect(run(stalled).moves).toHaveLength(1);
  });

  it('moves again for a second flick after the first one has finished', () => {
    const first = flick({ start: 0, peak: 90, tailMs: 1400, seed: 3 });
    const end = first[first.length - 1].t;
    const second = flick({ start: end + 400, peak: 90, seed: 4 });
    const result = run([...first, ...second]);
    expect(result.moves).toHaveLength(2);
    expect(result.moves[1].t).toBeGreaterThan(end);
  });

  it('moves again when a finger lands and stops the momentum', () => {
    // the tail is cut while it is still strong, and a new flick starts from
    // nothing a few frames later, with no silence between
    const first = flick({
      start: 0,
      peak: 90,
      tailMs: 2000,
      cutAt: 1250,
      seed: 5,
    });
    const cutEnd = first[first.length - 1].t;
    const second = flick({ start: cutEnd + 17, peak: 90, seed: 6 });
    const result = run([...first, ...second]);
    expect(result.moves).toHaveLength(2);
  });

  it('goes the way the gesture goes', () => {
    const down = run(flick({ start: 0, peak: 80 }));
    const up = run(flick({ start: 0, peak: 80, direction: -1 }));
    expect(down.moves.map(m => m.dir)).toEqual(['next']);
    expect(up.moves.map(m => m.dir)).toEqual(['prev']);
  });

  it('swallows the whole tail: nothing scrolls under a move', () => {
    const result = run(flick({ start: 0, peak: 120, tailMs: 1800 }));
    expect(result.passes).toEqual([]);
    expect(result.verdicts.filter(v => v === 'pass')).toHaveLength(0);
  });

  it('does not let a tail carry past the last scene into the footer', () => {
    // moving to the last scene: there is nowhere further to go, but the tail
    // after the move must still be swallowed, not passed to the page
    let atLast = false;
    const canMove = (dir: 1 | -1) => (dir > 0 ? !atLast : true);
    const events = flick({ start: 0, peak: 100, tailMs: 1800 });
    const pager = new WheelPager();
    let landsAt = Number.POSITIVE_INFINITY;
    const passes: number[] = [];
    for (const e of events) {
      if (e.t >= landsAt) {
        pager.moveEnded();
        landsAt = Number.POSITIVE_INFINITY;
        atLast = true;
      }
      const verdict = pager.wheel(e.dy, e.t, canMove);
      if (verdict === 'next') landsAt = e.t + MOVE_MS;
      if (verdict === 'pass') passes.push(e.t);
    }
    expect(passes).toEqual([]);
  });

  it('passes events through where there is no scene that way', () => {
    const canMove = (dir: 1 | -1) => dir < 0; // at the last scene: only back
    const result = run(flick({ start: 0, peak: 80 }), canMove);
    expect(result.moves).toHaveLength(0);
    expect(result.passes.length).toBeGreaterThan(0);
    // every push passes; only the last pixels of the ramp and tail, which
    // are not a push, are held
    const events = flick({ start: 0, peak: 80 });
    events.forEach((e, i) => {
      if (Math.abs(e.dy) > 3) expect(result.verdicts[i]).toBe('pass');
    });
  });

  it('turns a slow trackpad scroll into one move', () => {
    const events: Ev[] = [];
    for (let t = 0; t < 1500; t += 16) events.push({ t, dy: 5 });
    const result = run(events);
    expect(result.moves).toHaveLength(1);
  });

  it('turns a slow mouse wheel into a move', () => {
    // a few pixels a notch, ten notches a second
    const events: Ev[] = [];
    for (let t = 0; t < 1500; t += 100) events.push({ t, dy: 8 });
    expect(run(events).moves.length).toBeGreaterThanOrEqual(1);
  });

  it('does nothing for a nudge', () => {
    // thirty-odd pixels in all: the size of a stray touch, not a scroll
    const events: Ev[] = [];
    for (let t = 0; t < 130; t += 16) events.push({ t, dy: 4 });
    expect(run(events).moves).toHaveLength(0);
  });

  it('moves one scene for a gentle drag from rest, a few pixels an event', () => {
    const events: Ev[] = [];
    for (let t = 0; t < 1500; t += 16.7) events.push({ t, dy: 2 });
    expect(run(events).moves).toHaveLength(1);
  });

  it('lets a gentle drag leave the story at its last scene', () => {
    const events: Ev[] = [];
    for (let t = 0; t < 1500; t += 16.7) events.push({ t, dy: 2 });
    const result = run(events, dir => dir < 0);
    expect(result.moves).toHaveLength(0);
    expect(result.verdicts.every(v => v === 'pass')).toBe(true);
  });

  it('starts nothing from the last pixels of a tail after a move, however long they run', () => {
    // a strong flick fires, then four seconds of a trickle that never stops
    const events: Ev[] = flick({ start: 0, peak: 60, tailMs: 500, noise: 0 });
    const end = events[events.length - 1].t;
    for (let t = end + 16.7; t < end + 4000; t += 16.7)
      events.push({ t, dy: 2 });
    expect(run(events).moves).toHaveLength(1);
  });

  it('does not take a late bump in a hovering tail for a new flick', () => {
    // a flick, a tail that hovers at three to five pixels, then a bump to
    // seventeen over a tenth of a second: the shape of a tail's last wobble
    const events = flick({ start: 0, peak: 80, tailMs: 1000, noise: 0.1 });
    let t = events[events.length - 1].t;
    const random = rng(11);
    for (let i = 0; i < 40; i += 1) {
      t += 16.7;
      events.push({ t, dy: 3 + Math.round(random() * 2) });
    }
    for (const dy of [8, 13, 17, 15, 11, 7]) {
      t += 16.7;
      events.push({ t, dy });
    }
    for (let i = 0; i < 30; i += 1) {
      t += 16.7;
      events.push({ t, dy: 3 });
    }
    expect(run(events).moves).toHaveLength(1);
  });

  it('survives a main-thread stall of two hundred milliseconds inside a tail', () => {
    const events = flick({ start: 0, peak: 90, tailMs: 2200, noise: 0.1 });
    // the page stalls from 1.0 s to 1.2 s: what was due arrives late, together
    const stalled: Ev[] = [];
    let held = 0;
    for (const e of events) {
      if (e.t > 1000 && e.t < 1200) held += e.dy;
      else {
        if (held) {
          stalled.push({ t: 1200, dy: held });
          held = 0;
        }
        stalled.push(e);
      }
    }
    expect(run(stalled).moves).toHaveLength(1);
  });

  it('keeps hold of a move: no valley, strong or weak, starts another while one is under way', () => {
    // fire, then a valley and a strong flick inside the move's own animation
    const events: Ev[] = [
      { t: 0, dy: 90 },
      { t: 17, dy: 90 },
    ];
    for (let i = 0; i < 6; i += 1) events.push({ t: 120 + i * 17, dy: 1 });
    for (const [k, dy] of [60, 120, 140, 120, 90, 60].entries())
      events.push({ t: 300 + k * 17, dy });
    expect(run(events).moves).toHaveLength(1);
  });

  it('asks for a real flick after a valley, not two moderate events', () => {
    // a stream that fires, goes on strongly through the move, then dips to
    // nothing (a valley) and gives two pushes of thirty pixels: sixty pixels
    // of intent is not a flick. A hundred and fifty is.
    const events: Ev[] = [];
    for (let t = 0; t < 1000; t += 16.7) events.push({ t, dy: 40 });
    for (let i = 0; i < 3; i += 1) events.push({ t: 1000 + i * 16.7, dy: 1 });
    events.push({ t: 1067, dy: 30 }, { t: 1084, dy: 30 });
    expect(run(events).moves).toHaveLength(1);
    for (const t of [1101, 1118, 1135]) events.push({ t, dy: 30 }); // thirty more, three times: a real flick
    expect(run(events).moves).toHaveLength(2);
  });

  it('does not add nudges up for ever: the intent leaks away', () => {
    // three small pushes, each too small alone, a little apart
    const events: Ev[] = [0, 170, 340].map(t => ({ t, dy: 15 }));
    expect(run(events).moves).toHaveLength(0);
  });

  it('never stays locked, and never re-arms itself: one move for a stream that does not stop', () => {
    const events: Ev[] = [];
    for (let t = 0; t < 6000; t += 16.7) events.push({ t, dy: 60 });
    expect(run(events).moves).toHaveLength(1);
  });

  it('takes a slow drag as a new gesture after a short pause', () => {
    // a flick whose stream is still strong when it stops dead (a finger lands
    // after the move has landed), a quarter second of nothing, then a slow
    // drag: a new gesture from rest, so it moves. A pager that wanted a longer
    // pause would hold it back.
    const first = flick({
      start: 0,
      peak: 90,
      tailMs: 2400,
      cutAt: 1000,
      seed: 8,
    });
    const drag: Ev[] = [];
    const resume = first[first.length - 1].t + 250;
    for (let t = resume; t < resume + 1200; t += 16.7) drag.push({ t, dy: 5 });
    expect(run([...first, ...drag]).moves).toHaveLength(2);
  });

  it('takes a mouse notch as one scene, and a spun wheel as one', () => {
    const notch = run([{ t: 0, dy: 100 }]);
    expect(notch.moves).toHaveLength(1);
    const spun: Ev[] = [];
    for (let t = 0; t < 1200; t += 40) spun.push({ t, dy: 100 });
    expect(run(spun).moves).toHaveLength(1);
  });

  it('moves a mouse wheel one scene per notch when the notches are separate', () => {
    const events: Ev[] = [0, 1400, 2800].map(t => ({ t, dy: 100 }));
    expect(run(events).moves).toHaveLength(3);
  });

  it('never stays locked: a stream that never ends still gets another move', () => {
    const events: Ev[] = [];
    for (let t = 0; t < 8000; t += 16) events.push({ t, dy: 60 });
    // armed only after silence or a valley, so a stream with neither moves
    // once; what must hold is that it does not lock the page forever when
    // the stream finally pauses
    events.push({ t: 8000 + 500, dy: 90 });
    const result = run(events);
    expect(result.moves.length).toBeGreaterThanOrEqual(2);
    expect(result.moves[result.moves.length - 1].t).toBeGreaterThan(8000);
  });

  it('does not take the tail of a gesture that began outside the story as a push', () => {
    // a flick up from the footer carries into the last scene: held, then the
    // next real flick moves
    const carried = flick({ start: 0, peak: 90, direction: -1, tailMs: 1600 });
    const pager = new WheelPager();
    const result: PagerVerdict[] = [];
    carried.forEach((e, i) => {
      if (i === 8) pager.hold(e.t);
      if (i >= 8) result.push(pager.wheel(e.dy, e.t, () => true));
    });
    expect(result.every(v => v === 'swallow')).toBe(true);
    const end = carried[carried.length - 1].t;
    const next = flick({ start: end + 400, peak: 90, direction: -1, seed: 9 });
    expect(run(next, () => true, pager).moves).toHaveLength(1);
  });

  it('forgets everything on reset', () => {
    const pager = new WheelPager();
    expect(pager.wheel(100, 0, () => true)).toBe('next');
    pager.reset();
    expect(pager.wheel(100, 10, () => true)).toBe('next');
  });
});

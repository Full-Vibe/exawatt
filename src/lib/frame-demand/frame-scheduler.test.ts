import { describe, expect, it } from 'vitest';
import {
  AMBIENT_FRAME_DELTA_CAP_S,
  ECONOMY_FRAME_MS,
  createFrameScheduler,
  resolveFramePolicy,
  type FramePolicy,
} from './frame-scheduler';

const SEEN: FramePolicy = { render: true, ambient: 'display' };
const ECONOMY: FramePolicy = { render: true, ambient: 'economy' };
const UNSEEN: FramePolicy = { render: false, ambient: 'parked' };
const REFRESH_MS = 1000 / 60;

/**
 * One canvas under R3F v9's demand loop, as `@react-three/fiber` implements
 * it: `invalidate()` outside a frame asks for one frame, inside a frame it
 * asks for the next one, and under `frameloop="never"` it does nothing. The
 * scheduler's binding calls `frame()` from a `useFrame` on every painted
 * frame; `layers` stand in for the other `useFrame` subscribers.
 */
function canvas(initial: FramePolicy) {
  let clock = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  let nextTimer = 1;
  const scheduler = createFrameScheduler(initial, {
    now: () => clock,
    setTimer: (run, delay) => {
      const handle = nextTimer++;
      timers.set(handle, { at: clock + delay, run });
      return handle as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: handle => {
      timers.delete(handle as unknown as number);
    },
  });
  let pending = 0;
  let inFrame = false;
  let painted = 0;
  const layers: Array<(now: number) => void> = [];
  const root = {
    frameloop: initial.render ? 'demand' : 'never',
  };
  scheduler.attach(() => {
    if (root.frameloop === 'never') return;
    pending = inFrame ? 2 : 1;
  });
  /** Advance one display refresh: due timers fire, then a frame if owed. */
  const refresh = () => {
    clock += REFRESH_MS;
    for (const [handle, timer] of [...timers]) {
      if (timer.at > clock) continue;
      timers.delete(handle);
      timer.run();
    }
    if (pending === 0 || root.frameloop === 'never') return false;
    inFrame = true;
    for (const layer of layers) layer(clock);
    scheduler.frame(clock);
    inFrame = false;
    painted += 1;
    pending = Math.max(0, pending - 1);
    return true;
  };
  /** Frames painted over `count` refreshes. */
  const run = (count: number) => {
    const before = painted;
    for (let index = 0; index < count; index += 1) refresh();
    return painted - before;
  };
  /** What the binding does with a new policy: frameloop, then scheduler. */
  const setPolicy = (policy: FramePolicy) => {
    root.frameloop = policy.render ? 'demand' : 'never';
    scheduler.setPolicy(policy);
  };
  return {
    scheduler,
    layers,
    run,
    setPolicy,
    now: () => clock,
  };
}

describe('frame policy', () => {
  const host = {
    seen: true,
    ambientSeen: true,
    reduced: false,
    lowPower: false,
    onBattery: false,
  };

  it('paints ambient motion at the display refresh when nothing constrains it', () => {
    expect(resolveFramePolicy(host)).toEqual({
      render: true,
      ambient: 'display',
    });
  });

  it('slows ambient motion on battery and weak hardware, never parks it for power', () => {
    expect(resolveFramePolicy({ ...host, onBattery: true }).ambient).toBe(
      'economy'
    );
    expect(resolveFramePolicy({ ...host, lowPower: true }).ambient).toBe(
      'economy'
    );
  });

  it('parks ambient motion for reduced motion, a frozen owner or an unknown lock', () => {
    expect(resolveFramePolicy({ ...host, reduced: true })).toEqual({
      render: true,
      ambient: 'parked',
    });
    expect(resolveFramePolicy({ ...host, frozen: true }).ambient).toBe(
      'parked'
    );
    // Unknown is not unlocked: demand renders stay, ambient motion does not.
    expect(resolveFramePolicy({ ...host, ambientSeen: false })).toEqual({
      render: true,
      ambient: 'parked',
    });
  });

  it('renders nothing for a board nobody can see', () => {
    expect(resolveFramePolicy({ ...host, seen: false })).toEqual({
      render: false,
      ambient: 'parked',
    });
  });

  it('lets a rotor consume an economy frame whole', () => {
    // A clamp below one economy frame would turn a rotor slower on battery.
    expect(AMBIENT_FRAME_DELTA_CAP_S).toBeGreaterThan(
      (ECONOMY_FRAME_MS + REFRESH_MS) / 1000
    );
  });
});

describe('frame scheduler', () => {
  it('paints every refresh while a transition claim is live', () => {
    const board = canvas(SEEN);
    const camera = board.scheduler.demand('transition', 'camera');
    camera.set(true);
    expect(board.run(30)).toBe(30);
  });

  it('parks once the last claim settles, after at most one trailing frame', () => {
    const board = canvas(SEEN);
    const camera = board.scheduler.demand('transition', 'camera');
    let remaining = 10;
    board.layers.push(() => {
      remaining -= 1;
      camera.set(remaining > 0);
    });
    camera.set(true);
    expect(board.run(12)).toBeLessThanOrEqual(11);
    expect(board.scheduler.snapshot().parked).toBe(true);
    expect(board.run(120)).toBe(0);
  });

  it('keeps a held claim alive through frames in which nothing else asks', () => {
    // BUG-300: rotors asked for their next frame from inside a painted frame,
    // so one frame without them (a drill re-mounting the marks) ended the
    // loop for good. A registered claim does not depend on who painted last.
    const board = canvas(SEEN);
    const rotors = board.scheduler.demand('ambient', 'rotors');
    rotors.set(true);
    expect(board.run(60)).toBe(60);
  });

  it('paints a deadline transition through its end, then parks', () => {
    const board = canvas(SEEN);
    const endsAt = board.now() + 460;
    board.scheduler.until(endsAt);
    let last = 0;
    board.layers.push(now => {
      last = now;
    });
    board.run(60);
    // The first frame at or after the deadline paints the settled pose.
    expect(last).toBeGreaterThanOrEqual(endsAt);
    expect(last).toBeLessThan(endsAt + 2 * REFRESH_MS);
    expect(board.run(60)).toBe(0);
  });

  it('paints ambient claims on the economy timer, not every refresh', () => {
    const board = canvas(ECONOMY);
    board.scheduler.demand('ambient', 'rotors').set(true);
    const painted = board.run(120);
    expect(painted).toBeGreaterThan(10);
    expect(painted).toBeLessThan(120 / 2);
  });

  it('paints transitions every refresh even under the economy cadence', () => {
    const board = canvas(ECONOMY);
    board.scheduler.demand('ambient', 'rotors').set(true);
    board.scheduler.demand('transition', 'camera').set(true);
    expect(board.run(30)).toBe(30);
  });

  it('renders zero frames for a hidden or locked host, whatever is claimed', () => {
    const board = canvas(UNSEEN);
    board.scheduler.demand('transition', 'camera').set(true);
    board.scheduler.demand('ambient', 'rotors').set(true);
    board.scheduler.until(board.now() + 460);
    board.scheduler.request();
    expect(board.run(120)).toBe(0);
  });

  it('stops painting the moment the host locks', () => {
    const board = canvas(SEEN);
    board.scheduler.demand('ambient', 'rotors').set(true);
    expect(board.run(10)).toBe(10);
    board.setPolicy(UNSEEN);
    expect(board.run(120)).toBe(0);
  });

  it('re-arms on unlock and resumes what was claimed while locked', () => {
    const board = canvas(UNSEEN);
    const camera = board.scheduler.demand('transition', 'camera');
    camera.set(true);
    expect(board.run(30)).toBe(0);
    board.setPolicy(SEEN);
    expect(board.run(30)).toBe(30);
  });

  it('paints a change asked for while locked once the board can be seen', () => {
    const board = canvas(UNSEEN);
    board.scheduler.request();
    expect(board.run(10)).toBe(0);
    board.setPolicy(SEEN);
    expect(board.run(10)).toBe(1);
  });

  it('re-arms with one frame on every cadence change', () => {
    // Plugging in must not wait for an unrelated paint, and parking must
    // paint the rotors at rest rather than leave them mid-turn.
    const board = canvas(ECONOMY);
    expect(board.run(10)).toBe(0);
    board.setPolicy(SEEN);
    expect(board.run(10)).toBe(1);
    board.setPolicy({ render: true, ambient: 'parked' });
    expect(board.run(10)).toBe(1);
  });

  it('resumes ambient motion at the new cadence after on-ac', () => {
    const board = canvas(ECONOMY);
    board.scheduler.demand('ambient', 'rotors').set(true);
    board.run(60);
    board.setPolicy(SEEN);
    expect(board.run(60)).toBe(60);
  });

  it('parks ambient claims under reduced motion but still paints transitions', () => {
    const board = canvas({ render: true, ambient: 'parked' });
    board.scheduler.demand('ambient', 'rotors').set(true);
    expect(board.run(30)).toBe(0);
    board.scheduler.until(board.now() + 100);
    expect(board.run(30)).toBeGreaterThan(5);
    expect(board.run(30)).toBe(0);
  });

  it('paints one frame per one-off request and no more', () => {
    const board = canvas(SEEN);
    board.scheduler.request();
    board.scheduler.request();
    expect(board.run(30)).toBe(1);
  });

  it('reports live claims and their facts for evals', () => {
    const board = canvas(SEEN);
    board.scheduler
      .demand('ambient', 'rotors', () => ({ working: 3, rotors: 3 }))
      .set(true);
    expect(board.scheduler.snapshot()).toMatchObject({
      ambient: [{ label: 'rotors', working: 3, rotors: 3 }],
      transitions: [],
      parked: false,
    });
  });

  it('drops a pending economy frame when disposed, and stays usable', () => {
    // React's development double mount disposes and then keeps the same
    // scheduler; a dispose that killed it froze every board in development.
    const board = canvas(ECONOMY);
    const rotors = board.scheduler.demand('ambient', 'rotors');
    rotors.set(true);
    board.run(1);
    board.scheduler.dispose();
    expect(board.run(1)).toBe(0);
    rotors.set(false);
    rotors.set(true);
    expect(board.run(60)).toBeGreaterThan(10);
  });
});

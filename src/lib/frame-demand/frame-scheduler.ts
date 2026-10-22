/**
 * One owner decides when a demand canvas renders (ENG-004, ENG-031).
 *
 * A demand canvas paints only when something asks it to. Before this module
 * every layer of the Fleet boards and the hero board asked for itself, by
 * calling `invalidate()` from inside its own painted frame while it thought it
 * was still moving, and render policy (hidden, locked, battery, reduced
 * motion) was mixed into those calls. A chain of self-requests ends silently
 * the first time a frame paints with no requester in it, and nothing
 * restarts it: Working rotors froze on a board that was visible, on AC and
 * unlocked (BUG-300), and a frozen hero painted after its first frame
 * (BUG-280).
 *
 * The scheduler separates the two questions:
 *
 * - **Policy** says whether the canvas may paint at all (`render`: someone
 *   can see it) and how often ambient motion may paint (`ambient`). Power is
 *   a cadence, never a state (BUG-263): battery and weak hardware slow
 *   ambient motion to `economy`; only reduced motion, a frozen owner or a
 *   board nobody can see parks it.
 * - **Demand** is registered state, not a side effect of a painted frame: a
 *   layer holds a `transition` claim while it moves (every refresh) and an
 *   `ambient` claim while it has continuous motion to show (at the cadence);
 *   a known end is a deadline (`until`); a one-off change is `request`.
 *
 * The scheduler is the only caller of the canvas's `invalidate()`. It asks
 * for the next frame from inside each painted frame while any claim is live,
 * parks the moment none is, and re-arms with one frame on every policy
 * change, so a claim made while the canvas could not paint resumes as soon
 * as it can. A canvas that may not paint at all also leaves `frameloop` at
 * `'never'` (the binding's job), so nothing else can paint it either.
 */

export type AmbientCadence = 'display' | 'economy' | 'parked';

export interface FramePolicy {
  /** Someone can see the canvas: the page is visible, the host is not known
   * to be locked or asleep, the canvas is on screen. False paints nothing. */
  render: boolean;
  /** How often ambient demand may paint. */
  ambient: AmbientCadence;
}

/** Economy frames arrive this far apart (plus one display refresh while R3F
 * schedules the paint). A 2.4 s rotor turns about 7 degrees per frame: still
 * motion, at a fifth of a 120 Hz display's work. */
export const ECONOMY_FRAME_MS = 40;

/** Per-frame delta a continuous rotor may consume. Admits an economy frame
 * whole (so the rotor's speed does not depend on the power source) and still
 * caps the jump after a stall at 15 degrees of a 2.4 s turn. */
export const AMBIENT_FRAME_DELTA_CAP_S = 0.1;

export function resolveFramePolicy({
  seen,
  ambientSeen,
  reduced,
  frozen = false,
  lowPower,
  onBattery,
}: {
  /** The canvas can be seen: visible page, host not known locked or asleep,
   * on screen. */
  seen: boolean;
  /** Continuous motion may be shown: seen, and on a desktop host the lock and
   * sleep state are KNOWN to be unlocked and awake (unknown is not unlocked). */
  ambientSeen: boolean;
  /** `prefers-reduced-motion: reduce`. */
  reduced: boolean;
  /** The owner holds the canvas still (a study or poster capture). */
  frozen?: boolean;
  /** Weak hardware (the shared `lowPowerLikely` heuristic). */
  lowPower: boolean;
  /** The host runs on battery. */
  onBattery: boolean;
}): FramePolicy {
  const ambient: AmbientCadence =
    !seen || !ambientSeen || reduced || frozen
      ? 'parked'
      : lowPower || onBattery
        ? 'economy'
        : 'display';
  return { render: seen, ambient };
}

export type FrameDemandKind = 'transition' | 'ambient';

/** Facts a claim reports to evals, read when a snapshot is taken. */
export type FrameDemandDetail = () => Record<string, number | string | boolean>;

/** A registered claim on frames. Level-triggered: it stays live until the
 * layer that holds it says it has settled. */
export interface FrameDemand {
  readonly active: boolean;
  set(active: boolean): void;
  /** Releases the claim for good (unmount). */
  dispose(): void;
}

export interface FrameDemandSnapshot {
  policy: FramePolicy;
  /** Live claims by label, with the facts each reports. */
  transitions: Array<{ label: string } & Record<string, unknown>>;
  ambient: Array<{ label: string } & Record<string, unknown>>;
  /** Milliseconds until the latest transition deadline, 0 when none. */
  deadlineMs: number;
  /** Nothing is live, no economy frame is pending: the canvas is parked. */
  parked: boolean;
  /** Frames this scheduler saw painted, and paints it asked for. */
  frames: number;
  requests: number;
}

export interface FrameScheduler {
  readonly policy: FramePolicy;
  setPolicy(next: FramePolicy): void;
  /** The binding hands over the canvas's paint (`invalidate`). Returns detach. */
  attach(paint: () => void): () => void;
  /** One frame for a change that alters the picture once. */
  request(): void;
  /** Paint every refresh until `endsAtMs` (the `performance.now()` clock):
   * a transition with a known end. The frame after the deadline still paints,
   * so every layer samples its settled pose. */
  until(endsAtMs: number): void;
  demand(
    kind: FrameDemandKind,
    label: string,
    detail?: FrameDemandDetail
  ): FrameDemand;
  /** The binding calls this once per painted frame. */
  frame(nowMs: number): void;
  /** Policy changes, for React readers of the cadence. */
  subscribe(listener: () => void): () => void;
  snapshot(): FrameDemandSnapshot;
  /** Drops a pending economy frame (the canvas is unmounting). Holds no
   * other state: React's development double mount runs this and then keeps
   * the same scheduler, so it must stay usable. */
  dispose(): void;
}

interface Claim {
  kind: FrameDemandKind;
  label: string;
  detail?: FrameDemandDetail;
}

type Want = 'refresh' | 'economy' | 'none';

export function createFrameScheduler(
  initialPolicy: FramePolicy,
  {
    now = () => performance.now(),
    setTimer = (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimer = handle => clearTimeout(handle),
  }: {
    now?: () => number;
    setTimer?: (
      callback: () => void,
      delayMs: number
    ) => ReturnType<typeof setTimeout>;
    clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
  } = {}
): FrameScheduler {
  let policy = initialPolicy;
  let paint: (() => void) | null = null;
  /** A one-off frame was asked for while it could not paint. */
  let owed = false;
  let deadline = Number.NEGATIVE_INFINITY;
  let economy: ReturnType<typeof setTimeout> | null = null;
  let frames = 0;
  let requests = 0;
  const transitions = new Set<Claim>();
  const ambient = new Set<Claim>();
  const listeners = new Set<() => void>();

  const want = (at: number): Want => {
    if (!policy.render) return 'none';
    if (transitions.size > 0 || deadline > at) return 'refresh';
    if (ambient.size === 0 || policy.ambient === 'parked') return 'none';
    return policy.ambient === 'display' ? 'refresh' : 'economy';
  };
  const cancelEconomy = () => {
    if (economy === null) return;
    clearTimer(economy);
    economy = null;
  };
  const paintNow = () => {
    if (!paint || !policy.render) {
      owed = true;
      return;
    }
    requests += 1;
    paint();
  };
  // Inside a frame R3F turns the paint into the next frame; outside one it
  // starts the loop. Either way one call is one more frame.
  const schedule = () => {
    const next = want(now());
    if (next === 'refresh') {
      cancelEconomy();
      paintNow();
    } else if (next === 'economy') {
      if (economy !== null) return;
      economy = setTimer(() => {
        economy = null;
        if (want(now()) !== 'none') paintNow();
      }, ECONOMY_FRAME_MS);
    } else {
      cancelEconomy();
    }
  };
  const claims = (set: Set<Claim>) =>
    [...set].map(claim => ({ label: claim.label, ...claim.detail?.() }));

  return {
    get policy() {
      return policy;
    },
    setPolicy(next) {
      if (next.render === policy.render && next.ambient === policy.ambient)
        return;
      policy = next;
      for (const listener of listeners) listener();
      if (!policy.render) {
        cancelEconomy();
        return;
      }
      // Re-arm: one frame for the new policy (a rotor parked at rest, a
      // board unlocked with a stale picture), then whatever is still live.
      owed = false;
      paintNow();
      schedule();
    },
    attach(next) {
      paint = next;
      if (owed && policy.render) {
        owed = false;
        paintNow();
      }
      schedule();
      return () => {
        if (paint === next) paint = null;
      };
    },
    request() {
      paintNow();
    },
    until(endsAtMs) {
      if (endsAtMs <= deadline) return;
      deadline = endsAtMs;
      schedule();
    },
    demand(kind, label, detail) {
      const claim: Claim = { kind, label, detail };
      const set = kind === 'transition' ? transitions : ambient;
      let active = false;
      return {
        get active() {
          return active;
        },
        set(next) {
          if (next === active) return;
          active = next;
          if (next) {
            set.add(claim);
            schedule();
          } else {
            set.delete(claim);
          }
        },
        dispose() {
          active = false;
          set.delete(claim);
        },
      };
    },
    frame(nowMs) {
      frames += 1;
      owed = false;
      if (deadline <= nowMs) deadline = Number.NEGATIVE_INFINITY;
      schedule();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot() {
      const at = now();
      return {
        policy,
        transitions: claims(transitions),
        ambient: claims(ambient),
        deadlineMs: Math.max(0, deadline - at),
        parked: want(at) === 'none' && economy === null,
        frames,
        requests,
      };
    },
    dispose() {
      cancelEconomy();
    },
  };
}

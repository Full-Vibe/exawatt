/**
 * One scene per gesture (ENG-031 W15g, W15h). The study's Page mode takes
 * the wheel inside the story and turns a gesture into exactly one move.
 *
 * The hard part is a trackpad. A two-finger flick is a ramp, a peak, and
 * then the system's momentum: a tail of wheel events that keeps arriving for
 * a second or more after the fingers lift, decaying, but never cleanly: it
 * has plateaus and bumps. A detector that asks "is this event bigger than
 * the last?" reads a bump in that tail as a new flick, and the page moves a
 * second scene a split second after the first, with nobody touching it
 * (the operator, twice: "without me doing anything, a split second later,
 * went on to the next scene after that").
 *
 * So a gesture is decided by what the stream has done, not by one event:
 *
 * - Intent is the sum of recent movement (it leaks away over half a second),
 *   and only movement above a noise limit counts: the last pixels of a tail are
 *   not a push.
 * - A move starts only when the pager is armed, and it disarms the moment it
 *   fires. It arms in two strengths. Silence (the stream stopped for long
 *   enough that no frame hitch could fake it) arms it fully. A valley (the
 *   stream fell to nothing for an event, which is what a finger landing to
 *   flick again does to momentum) arms it only for a real flick: the push
 *   must be strong and fast, which no residue of a tail is.
 * - After a move fires, everything is swallowed (the page never scrolls
 *   under it, and the tail never scrolls past the last scene into the
 *   footer) until the move has landed and the stream has ended, or a hard
 *   cap so it can never stay locked.
 *
 * Pure: no DOM, no clock. The caller says when an event happened and when a
 * move landed, so the whole thing is tested against synthetic traces.
 */

export type PagerVerdict = 'pass' | 'swallow' | 'next' | 'prev';

interface PagerConfig {
  /** Intent, in pixels, at which a fully armed pager starts a move. */
  triggerPx: number;
  /** How fast intent leaks away, as a time constant in milliseconds. */
  leakMs: number;
  /** Movement at or below this is not a push. */
  noisePx: number;
  /** A gap this long between events is the stream stopping. */
  silenceMs: number;
  /** After a valley, the move needs this many times the intent... */
  valleyIntent: number;
  /** ...and one event at least this strong. */
  valleyPushPx: number;
  /** The longest the pager stays locked after a move starts. */
  maxLockMs: number;
}

/**
 * `silenceMs` is long enough that a slow frame on the page (a shader
 * compiling, a collection) cannot make a live tail look like a stream that
 * stopped (a stall longer than this inside a live tail still reads as a
 * pause, and a coalesced burst after it as a new push: a known limit).
 * `leakMs` is long enough that a slow mouse wheel on a Mac, which sends a few
 * pixels per notch, or a gentle drag of one to three pixels an event, still
 * adds up to a push; tails cannot use that, because only a fully armed pager
 * listens to events that small. `triggerPx` is the size of a small deliberate
 * scroll, so a nudge does nothing. After a valley the pager asks for a real
 * flick (`valleyIntent`, `valleyPushPx`), which no bump in the last pixels of
 * a tail reaches.
 */
const DEFAULTS: PagerConfig = {
  triggerPx: 40,
  leakMs: 700,
  noisePx: 3,
  silenceMs: 230,
  valleyIntent: 2.5,
  valleyPushPx: 24,
  maxLockMs: 2200,
};

/** How far the pager is armed: not at all, for a flick, or fully. */
const NOT_ARMED = 0;
const ARMED_BY_VALLEY = 1;
const ARMED_BY_SILENCE = 2;
type Armed = 0 | 1 | 2;

export class WheelPager {
  private readonly cfg: PagerConfig;
  private acc = 0;
  private last = Number.NEGATIVE_INFINITY;
  private locked = false;
  private armed: Armed = ARMED_BY_SILENCE;
  private moving = false;
  private lockedAt = 0;

  constructor(config: Partial<PagerConfig> = {}) {
    this.cfg = { ...DEFAULTS, ...config };
  }

  /** The move the last 'next' or 'prev' started has landed. */
  moveEnded() {
    this.moving = false;
  }

  /** Whether a gesture is being held or has a move in its tail: every event
   *  of its stream, whatever its direction, is the pager's until it ends. */
  get engaged(): boolean {
    return this.locked;
  }

  /**
   * A gesture that began outside the story has carried into it (a flick up
   * from the footer reaching the last scene). It is not a push at this
   * scene: hold everything until its stream ends, as after a move.
   */
  hold(now: number) {
    // the stream is live right now, whatever the pager last saw of it
    this.last = now;
    this.acc = 0;
    this.locked = true;
    this.moving = false;
    this.lockedAt = now;
    this.armed = NOT_ARMED;
  }

  /** Forget everything: the mode changed, or the page was left. */
  reset() {
    this.acc = 0;
    this.last = Number.NEGATIVE_INFINITY;
    this.locked = false;
    this.armed = ARMED_BY_SILENCE;
    this.moving = false;
  }

  private release(armed: Armed) {
    this.locked = false;
    this.armed = armed;
    this.acc = 0;
  }

  /**
   * One wheel event, `dy` pixels (down is positive) at time `now`
   * milliseconds. `canMove(dir)` says whether there is a scene that way.
   * `pass` means the page may scroll natively, `swallow` that the event is
   * ours and nothing happens, `next` and `prev` that a move starts.
   */
  wheel(
    dy: number,
    now: number,
    canMove: (dir: 1 | -1) => boolean
  ): PagerVerdict {
    const cfg = this.cfg;
    const abs = Math.abs(dy);
    const dt = now - this.last;
    this.last = now;
    const silent = dt >= cfg.silenceMs;

    if (this.locked) {
      // while a move is under way nothing counts, not even a valley
      if (this.moving) return 'swallow';
      if (silent) this.release(ARMED_BY_SILENCE);
      else if (abs <= cfg.noisePx) this.release(ARMED_BY_VALLEY);
      else if (now - this.lockedAt >= cfg.maxLockMs) this.release(NOT_ARMED);
      if (this.locked) return 'swallow';
    } else if (silent) {
      this.armed = ARMED_BY_SILENCE;
      this.acc = 0;
    }

    const leak = Math.exp(-Math.min(dt, 1e4) / cfg.leakMs);
    if (this.armed === NOT_ARMED) return 'swallow';
    // After a valley the last pixels of a tail are not a push, and are not the
    // page's either: they stop here, so a tail never scrolls a scene out of
    // place. From rest they are a gentle drag, which counts like any other
    // movement: it adds up to one scene, and at the end of the story it
    // passes to the page.
    if (abs <= cfg.noisePx && this.armed !== ARMED_BY_SILENCE) {
      this.acc *= leak;
      return 'swallow';
    }
    const dir: 1 | -1 = dy > 0 ? 1 : -1;
    // Nowhere to go that way: the page carries on natively, but only for a
    // push. What is left of a tail after a valley is not one, and must not
    // scroll the last scene's stage out from under the reader.
    if (!canMove(dir)) {
      this.acc = 0;
      return this.armed === ARMED_BY_SILENCE || abs >= cfg.valleyPushPx
        ? 'pass'
        : 'swallow';
    }
    this.acc = this.acc * leak + dy;
    const need =
      this.armed === ARMED_BY_SILENCE
        ? cfg.triggerPx
        : cfg.triggerPx * cfg.valleyIntent;
    if (Math.abs(this.acc) < need) return 'swallow';
    if (this.armed === ARMED_BY_VALLEY && abs < cfg.valleyPushPx)
      return 'swallow';
    const through: 1 | -1 = this.acc > 0 ? 1 : -1;
    if (!canMove(through)) {
      this.acc = 0;
      return 'swallow';
    }
    this.acc = 0;
    this.armed = NOT_ARMED;
    this.locked = true;
    this.moving = true;
    this.lockedAt = now;
    return through > 0 ? 'next' : 'prev';
  }
}

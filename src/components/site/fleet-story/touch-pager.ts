/**
 * A finger on the story, in Page mode (ENG-031 W15o).
 *
 * Until W15o a touch screen got the browser's own snap, one CSS snap point
 * per scene that it might not skip. On an iPhone that is three defects the
 * operator met in one evening (2026-10-14): an overscroll at the first scene
 * bounced back and then went on to the second ("after the rubber banding
 * settles, it scrolls down to the second scene"), a flick from the last
 * scene into the footer snapped and then jerked back up before it settled,
 * and the scene steps, which read the scroll, jumped back and forth through
 * a flick. The system's momentum, its bounce at either end of the page, its
 * toolbars resizing the viewport at the bottom and its choice of snap point
 * after a bounce are all the browser's, and none of them can be steered from
 * the page.
 *
 * So the story takes the finger. The page follows it one to one while it is
 * down, and when it lifts, the page glides to a stop: the scene the drag set
 * out for, or back to the one it left. The stops are the scenes and, past
 * the last one, the end of the page (with a stop a screen apart in between,
 * should the footer ever be taller than a screen). A glide starts at the
 * speed the finger let go at, so nothing stalls at the moment of release.
 *
 * Pure: no DOM, no clock.
 */

/** Pixels within which the page is on a stop. */
const ON_STOP_PX = 1;

/** The scroll positions the page may rest at: each scene, then the page
 *  below the story, reached a screen at a time at most and ending at the
 *  bottom of the page. */
export function pageStops(
  frameTops: number[],
  maxScroll: number,
  viewport: number
): number[] {
  const stops = frameTops.map(top => Math.min(top, maxScroll));
  const lastTop = stops[stops.length - 1] ?? 0;
  const below = maxScroll - lastTop;
  if (below <= ON_STOP_PX) return stops;
  const step = Math.max(1, viewport * 0.85);
  const count = Math.ceil(below / step);
  for (let i = 1; i <= count; i += 1)
    stops.push(i === count ? maxScroll : lastTop + (below * i) / count);
  return stops;
}

/** The stop nearest a scroll position. */
export function nearestStop(stops: number[], position: number): number {
  let best = 0;
  for (let i = 1; i < stops.length; i += 1)
    if (Math.abs(stops[i] - position) < Math.abs(stops[best] - position))
      best = i;
  return best;
}

interface ReleaseConfig {
  /** Finger speed, px/ms, at which a release goes on in its direction. */
  flick: number;
  /** Share of the way to the next stop at which a slow release commits. */
  commit: number;
}

const RELEASE: ReleaseConfig = { flick: 0.3, commit: 0.22 };

/**
 * Where the page goes when the finger lifts: a stop index. `velocity` is
 * the page's own, px/ms, positive toward the end of the page; `start` is the
 * scroll position the drag set out from.
 *
 * A flick goes on to the next stop in its direction (from a stop, the next
 * one over; between two, the one it was heading for), so a flick back after
 * a drag forward cancels it. A slow release commits once the drag has gone a
 * little of the way (`commit`) in the direction it was going; otherwise the
 * page returns. A drag that caught a glide in flight is read the same way,
 * by the way the finger went, so a finger that stops a glide and lifts
 * again never sends the page somewhere it was not going.
 */
export function releaseStop(
  stops: number[],
  position: number,
  velocity: number,
  start: number,
  config: ReleaseConfig = RELEASE
): number {
  const last = stops.length - 1;
  let lo = 0;
  for (let i = 0; i <= last; i += 1)
    if (stops[i] <= position + ON_STOP_PX) lo = i;
  let hi = last;
  for (let i = last; i >= 0; i -= 1)
    if (stops[i] >= position - ON_STOP_PX) hi = i;
  if (hi < lo) hi = lo;
  if (Math.abs(velocity) >= config.flick) {
    const dir = velocity > 0 ? 1 : -1;
    if (lo === hi) return Math.max(0, Math.min(last, lo + dir));
    return dir > 0 ? hi : lo;
  }
  if (lo === hi) return lo;
  const share = (position - stops[lo]) / (stops[hi] - stops[lo]);
  if (position > start) return share > config.commit ? hi : lo;
  if (position < start) return 1 - share > config.commit ? lo : hi;
  return share < 0.5 ? lo : hi;
}

/** A sample of the finger: when, and where on the screen. */
interface FingerSample {
  t: number;
  y: number;
}

/** How far back the release speed is measured, and how long a finger may
 *  rest before lifting and still count as moving. */
const VELOCITY_WINDOW_MS = 100;
const STILL_MS = 70;

/** The finger's speed down the screen at release, px/ms. */
export function fingerVelocity(samples: FingerSample[], now: number): number {
  const lastSample = samples[samples.length - 1];
  if (!lastSample || now - lastSample.t > STILL_MS) return 0;
  let first = lastSample;
  for (let i = samples.length - 2; i >= 0; i -= 1) {
    if (lastSample.t - samples[i].t > VELOCITY_WINDOW_MS) break;
    first = samples[i];
  }
  const dt = lastSample.t - first.t;
  return dt > 0 ? (lastSample.y - first.y) / dt : 0;
}

/** The glide's length: a short return is quick, a whole scene takes a
 *  little longer, and a fast finger makes it shorter still. */
const GLIDE_BASE_MS = 260;
const GLIDE_PER_SCREEN_MS = 460;
const GLIDE_MIN_MS = 240;
const GLIDE_MAX_MS = 720;
/** The steepest start a glide may take, as a multiple of its average speed:
 *  a cubic that starts steeper than three overshoots its stop. */
const MAX_SLOPE = 2.6;

interface Glide {
  duration: number;
  /** Share of the distance covered at a share of the duration. */
  ease: (tau: number) => number;
}

/**
 * The glide from release to a stop `distance` px away (signed), starting at
 * the page's own `velocity` (px/ms) where it points the same way, and
 * arriving at rest. A cubic whose start slope matches the release, so the
 * hand-off from finger to glide has no seam, and that never overshoots.
 */
export function releaseGlide(
  distance: number,
  velocity: number,
  viewport: number
): Glide {
  const span = Math.abs(distance);
  const speed = Math.max(0, velocity * Math.sign(distance));
  let duration = Math.min(
    GLIDE_MAX_MS,
    Math.max(
      GLIDE_MIN_MS,
      GLIDE_BASE_MS + (GLIDE_PER_SCREEN_MS * span) / Math.max(1, viewport)
    )
  );
  if (speed > 0)
    duration = Math.max(
      GLIDE_MIN_MS,
      Math.min(duration, (MAX_SLOPE * span) / speed)
    );
  const slope = span > 0 ? Math.min(MAX_SLOPE, (speed * duration) / span) : 0;
  return {
    duration,
    ease: tau => {
      const t = Math.max(0, Math.min(1, tau));
      return (t * t * t - 2 * t * t + t) * slope + (3 * t * t - 2 * t * t * t);
    },
  };
}

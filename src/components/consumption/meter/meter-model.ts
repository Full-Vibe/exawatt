/**
 * Ambient consumption meter — view model (ENG-008 meter options).
 *
 * The chrome meter answers exactly one glance: "how much of the tightest
 * plan window is gone, and is the burn ahead of or behind even pace?"
 * Even pace is the Claude Code `/usage` pacing idea: a window consumed
 * perfectly evenly sits at usedPercent === elapsedPercent, so the delta
 * between the two IS the pacing verdict.
 *
 * Idiom (operator-settled, 2026-08-03): monochrome-until-it-matters. The
 * meter renders in chrome neutrals while the window is inside pace, and the
 * consumption channel's violet→magenta only appears once a window runs hot —
 * the battery-gauge escalation, by state change and never by motion. The
 * FLUX channel-ownership rule holds: nothing here is ever green, amber, or
 * fault-red.
 *
 * The OPPORTUNITY voice (ENG-008 E9, operator-picked 2026-08-11 from the
 * `/hud-gallery#pace-opportunity` design pass): the inverse goal — "free
 * allocation resets soon, use it or lose it" — speaks through the SAME pace
 * vocabulary below. When `opportunityOf` fires, `paceSentence`/`paceLabel`
 * re-frame the deficit as free-to-spend, and one coach line may appear at the
 * closing tier through `opportunityCoach`. Channel discipline is absolute:
 * opportunity never borrows the alarm channel (no FLUX warm/hot, no color
 * change, no motion), and a hot or spent window ALWAYS outranks it — the
 * operator must never learn to ignore either voice because of the other.
 *
 * Pure presentation data and pure functions: no React or DOM state. Theme
 * values stay as unresolved CSS-variable strings until the browser paints.
 */
import {
  CONSUMPTION_CHROME as CHROME,
  FLUX_CSS as FLUX,
  consumptionAlpha,
  duration,
  pressureColorCss as pressureColor,
} from '../flux';
import {
  projectWindow,
  windowFreshness,
  type CapacityWindowView,
  type ConsumptionSourceView,
} from '../model';

export type MeterState = 'healthy' | 'warm' | 'hot' | 'exhausted';
export type MeterPace = 'ahead' | 'even' | 'behind';

/**
 * Pace deltas inside ±this many percentage points read as "even".
 *
 * THE one band. The chrome meter, the `/usage` page, and any other pace
 * consumer derive their verdict through `classifyPace` below — a second band
 * anywhere makes the title bar and the page disagree about the same window.
 */
export const PACE_EVEN_BAND = 5;

/** The one pace verdict: usedPercent − evenPacePercent vs the even band. */
export function classifyPace(deltaPoints: number): MeterPace {
  if (deltaPoints > PACE_EVEN_BAND) return 'ahead';
  if (deltaPoints < -PACE_EVEN_BAND) return 'behind';
  return 'even';
}

export interface MeterReading {
  source: ConsumptionSourceView;
  window: CapacityWindowView;
  usedPercent: number;
  /** Where an evenly-consumed window would sit right now, 0..100. */
  evenPacePercent: number;
  /** usedPercent − evenPacePercent. Positive = burning ahead of pace. */
  paceDeltaPoints: number;
  pace: MeterPace;
  msToReset: number;
  projectedPercent: number;
  exhaustsBeforeReset: boolean;
  msToExhaust: number;
  state: MeterState;
}

export interface MeterSnapshot {
  /** null when no source reports a live plan window — rendered as unknown,
   *  never as 0%. */
  reading: MeterReading | null;
  sources: ConsumptionSourceView[];
  nowMs: number;
}

function elapsedPercent(w: CapacityWindowView, nowMs: number): number {
  const windowMs = w.windowMinutes * 60_000;
  const elapsed = windowMs - Math.max(0, w.resetsAtMs - nowMs);
  return Math.max(0, Math.min(100, (elapsed / windowMs) * 100));
}

function stateFor(
  usedPercent: number,
  exhaustsBeforeReset: boolean
): MeterState {
  if (usedPercent >= 99.5) return 'exhausted';
  if (usedPercent >= 85 || exhaustsBeforeReset) return 'hot';
  if (usedPercent >= 62) return 'warm';
  return 'healthy';
}

/**
 * One window, one reading — the shared pace/projection derivation every
 * consumption surface renders (the meter's snapshot and `/usage`'s pace
 * cards both come through here).
 */
export function readWindowPace(
  source: ConsumptionSourceView,
  window: CapacityWindowView,
  nowMs: number
): MeterReading {
  const p = projectWindow(window, nowMs);
  const evenPace = elapsedPercent(window, nowMs);
  const delta = window.usedPercent - evenPace;
  return {
    source,
    window,
    usedPercent: window.usedPercent,
    evenPacePercent: evenPace,
    paceDeltaPoints: delta,
    pace: classifyPace(delta),
    msToReset: p.msToReset,
    projectedPercent: p.projectedPercent,
    exhaustsBeforeReset: p.exhaustsBeforeReset,
    msToExhaust: p.msToExhaust,
    state: stateFor(window.usedPercent, p.exhaustsBeforeReset),
  };
}

/**
 * The headline: the tightest LIVE window across every reporting source.
 * Stale and expired windows are excluded the same way the capacity surfaces
 * exclude them — a meter projecting from a dead reading is quietly lying.
 */
export function readMeter(
  sources: ConsumptionSourceView[],
  nowMs: number
): MeterSnapshot {
  let best: MeterReading | null = null;
  for (const source of sources) {
    for (const window of source.windows) {
      if (windowFreshness(window, nowMs) !== 'live') continue;
      const reading = readWindowPace(source, window, nowMs);
      if (!best || reading.usedPercent > best.usedPercent) best = reading;
    }
  }
  return { reading: best, sources, nowMs };
}

/** Every live window, one reading each — the popover's windows list. */
export function readAllWindows(
  source: ConsumptionSourceView,
  nowMs: number
): MeterReading[] {
  return source.windows
    .filter(w => windowFreshness(w, nowMs) === 'live')
    .map(w => readWindowPace(source, w, nowMs));
}

/* ------------------------------------------------------------------ */
/* opportunity — use it or lose it (E9)                                */
/* ------------------------------------------------------------------ */

/**
 * The two honest numbers, for a window behind pace:
 *
 *   floor  = evenPace% − used% — the share that expires unused EVEN IF burn
 *            returns to even pace this instant. Pure geometry over two
 *            reported facts (used%, elapsed%); no burn-rate noise. The
 *            trigger gates on this. A floor of N pts requires N% of the
 *            window to have elapsed, so a large floor can only exist late
 *            in a window — reset proximity is partially structural.
 *   course = 100 − projected% — the share that expires at the CURRENT burn.
 *            This is the number the copy shows; it moves with the burn
 *            estimate, so it never gates.
 *
 * Thresholds: 15 pts is 3× the shared even band (±5) — below it, "behind"
 * is a pace verdict, not an opportunity. Under 30 minutes of runway nothing
 * meaningful can still be launched. Hot and spent windows never speak here:
 * the alarm states own their channel outright.
 *
 * The standing false positive, named rather than hidden: deliberate idle.
 * Overnight every live window drifts behind even pace, so the trigger holds
 * for hours and no threshold can distinguish "sleeping" from "leaving money
 * on the table". That is why this voice must be quiet enough to be furniture
 * when ignored — and why it may never share the alarm channel.
 */
export const OPPORTUNITY_MIN_FLOOR_PTS = 15;
export const OPPORTUNITY_MIN_RUNWAY_MS = 30 * 60_000;
export const OPPORTUNITY_CLOSING_FLOOR_PTS = 30;
export const OPPORTUNITY_CLOSING_RESET_FRACTION = 0.25;

export interface OpportunityRead {
  /** 100 − used%: free headroom right now. */
  freePts: number;
  /** evenPace% − used%: expires unused even at even pace from now. */
  floorPts: number;
  /** 100 − projected%: expires unused at the current burn. */
  coursePts: number;
  /** 'open' speaks quietly; 'closing' leads with the countdown. */
  tier: 'open' | 'closing';
}

/**
 * The trigger. Null means the window has no opportunity voice — either it is
 * inside pace, the deficit is under the floor, the reset is too close to act
 * on, or an alarm state owns the window outright.
 */
export function opportunityOf(r: MeterReading): OpportunityRead | null {
  if (r.state === 'hot' || r.state === 'exhausted') return null;
  // floor ≥ 15 implies the shared verdict already reads 'behind' (band ±5);
  // the explicit check keeps the predicate readable as one sentence.
  if (r.pace !== 'behind') return null;
  const floorPts = Math.round(r.evenPacePercent - r.usedPercent);
  if (floorPts < OPPORTUNITY_MIN_FLOOR_PTS) return null;
  if (r.msToReset < OPPORTUNITY_MIN_RUNWAY_MS) return null;
  const windowMs = r.window.windowMinutes * 60_000;
  const closing =
    floorPts >= OPPORTUNITY_CLOSING_FLOOR_PTS ||
    r.msToReset <= windowMs * OPPORTUNITY_CLOSING_RESET_FRACTION;
  return {
    freePts: Math.round(100 - r.usedPercent),
    floorPts,
    coursePts: Math.round(Math.max(0, 100 - r.projectedPercent)),
    tier: closing ? 'closing' : 'open',
  };
}

/** The floor claim, stated once as a tooltip so copy stays short. */
export function floorTitle(o: OpportunityRead): string {
  return `Even at even pace from now, at least ${o.floorPts}% of this window expires unused.`;
}

/** The coach line. Spoken only at the closing tier, and only when no alarm
 *  outranks it — `opportunityCoach` below is the one arbiter. */
export function coachLine(r: MeterReading, o: OpportunityRead): string {
  return `${r.window.label} resets in ${duration(r.msToReset)} with ${o.freePts}% free — front-load the heavy runs.`;
}

/** Best closing opportunity across a set of readings (most free wins). */
export function closingOpportunity(
  readings: readonly MeterReading[]
): { reading: MeterReading; o: OpportunityRead } | null {
  let best: { reading: MeterReading; o: OpportunityRead } | null = null;
  for (const reading of readings) {
    const o = opportunityOf(reading);
    if (!o || o.tier !== 'closing') continue;
    if (!best || o.freePts > best.o.freePts) best = { reading, o };
  }
  return best;
}

/**
 * The coach-slot arbiter, shared by the meter popover and `/usage` so the
 * two placements can never disagree about who owns the slot: any hot or
 * spent window silences the coach outright (HOT ALWAYS OUTRANKS — a window
 * cannot warn and beckon at once), otherwise the best closing opportunity
 * speaks one line in the quiet register.
 */
export function opportunityCoach(
  readings: readonly MeterReading[]
): string | null {
  if (readings.some(r => r.state === 'hot' || r.state === 'exhausted')) {
    return null;
  }
  const best = closingOpportunity(readings);
  return best ? coachLine(best.reading, best.o) : null;
}

/** A cycle that already closed with headroom unspent — the expired state.
 *  Rendered as one ledger caption on `/usage` only; the popover and the
 *  geometry stay silent (the chip family has no memory, the bar is fresh). */
export interface ClosedCycle {
  label: string;
  /** Share of the closed window that was still free at its last observation
   *  near the reset — observed, never extrapolated. */
  unusedPercent: number;
  /** How long ago the cycle closed. */
  agoMs: number;
}

export function ledgerLine(c: ClosedCycle): string {
  return `${c.label} reset ${duration(c.agoMs)} ago · closed with ${c.unusedPercent}% unused`;
}

/* ------------------------------------------------------------------ */
/* tone — monochrome until it matters                                  */
/* ------------------------------------------------------------------ */

export interface MeterTone {
  /** The fill / needle / arc color. */
  fill: string;
  /** The numeral beside or inside the form. */
  text: string;
  /** The empty remainder of the track. */
  track: string;
  /** Whether the consumption channel is switched on (hot / exhausted). */
  colored: boolean;
}

/** Theme-resolved chrome neutrals; Consumption color still appears only hot. */
const MONO = {
  fillCalm: CHROME.textDim,
  fillWarm: CHROME.text,
  textCalm: CHROME.textDim,
  textWarm: CHROME.text,
  track: consumptionAlpha(CHROME.text, 0.13),
  tick: consumptionAlpha(CHROME.text, 0.6),
} as const;

export const METER_MONO = MONO;

export function meterTone(reading: MeterReading | null): MeterTone {
  if (!reading) {
    return {
      fill: FLUX.unknown,
      text: FLUX.unknown,
      track: MONO.track,
      colored: false,
    };
  }
  switch (reading.state) {
    case 'healthy':
      return {
        fill: MONO.fillCalm,
        text: MONO.textCalm,
        track: MONO.track,
        colored: false,
      };
    case 'warm':
      return {
        fill: MONO.fillWarm,
        text: MONO.textWarm,
        track: MONO.track,
        colored: false,
      };
    case 'hot': {
      const c = pressureColor(Math.max(86, reading.usedPercent));
      return { fill: c, text: c, track: MONO.track, colored: true };
    }
    case 'exhausted':
      return {
        fill: FLUX.hot,
        text: FLUX.hot,
        track: MONO.track,
        colored: true,
      };
  }
}

/* ------------------------------------------------------------------ */
/* words                                                               */
/* ------------------------------------------------------------------ */

/**
 * The pace caption. AMENDED by E9 (the metric swap, Direction C): when the
 * opportunity trigger fires, the deficit sentence becomes the free-to-spend
 * framing — the line the operator already reads changes what it says, in
 * both placements at once, because this is the one place it is written.
 */
export function paceSentence(r: MeterReading): string {
  const o = opportunityOf(r);
  if (o) {
    return o.tier === 'closing'
      ? `${o.freePts}% free · expires in ${duration(r.msToReset)}`
      : `${o.coursePts}% will expire unused at this pace`;
  }
  const pts = Math.abs(Math.round(r.paceDeltaPoints));
  if (r.pace === 'even') return 'on even pace for this window';
  return r.pace === 'ahead'
    ? `ahead of even pace by ${pts} pts`
    : `behind even pace by ${pts} pts`;
}

/**
 * The pace verdict as a short card label, with its display color. Same
 * vocabulary as `paceSentence` — "even pace", pts, and the one exhaustion
 * verb "spent" — so the title bar and the page can never phrase the same
 * window differently. AMENDED by E9 with the same metric swap: a firing
 * opportunity reads free-to-spend, in the calm color (never the alarm's).
 */
export function paceLabel(r: MeterReading): { text: string; color: string } {
  if (r.exhaustsBeforeReset && r.state !== 'exhausted') {
    return {
      text: `spent in ${duration(r.msToExhaust)} — before reset`,
      color: FLUX.hot,
    };
  }
  if (r.state === 'exhausted') {
    return { text: 'spent — holds until reset', color: FLUX.hot };
  }
  const o = opportunityOf(r);
  if (o) return { text: `${o.freePts}% free to spend`, color: FLUX.calm };
  const pts = Math.abs(Math.round(r.paceDeltaPoints));
  if (r.pace === 'even') return { text: 'on even pace', color: FLUX.calm };
  if (r.pace === 'ahead') {
    return {
      text: `${pts} pts ahead of even pace`,
      color: pressureColor(r.usedPercent),
    };
  }
  return { text: `${pts} pts behind even pace`, color: FLUX.calm };
}

/**
 * The one-line coach. Speaks only when the state earns it — a meter that
 * advises at 34% is a meter the operator learns to ignore.
 */
export function remediationHint(r: MeterReading): string | null {
  if (r.state === 'exhausted') {
    return 'Window spent. Route new runs to an unmetered source or hold until the reset.';
  }
  if (r.state !== 'hot') return null;
  if (r.exhaustsBeforeReset) {
    return 'At this pace the window is spent before it resets — hold large launches or shift them past the reset.';
  }
  return 'Running hot but inside pace to reset — keep launches small until the window turns over.';
}

/**
 * Consumption meter model: the ONE pace derivation (ENG-008).
 *
 * Every surface that shows a plan window (the chrome meter, its popover, the
 * `/usage` account cards) reads it through `readWindowPace` here, so the
 * title bar and the page can never disagree about the same window. Even pace
 * is the Claude Code `/usage` idea: a window consumed perfectly evenly sits
 * at usedPercent === elapsedPercent.
 *
 * Idiom (operator-settled, 2026-08-03): monochrome-until-it-matters. Meters
 * render in chrome neutrals while inside pace; the consumption channel's
 * violet to magenta appears only once a window runs hot, by state change and
 * never by motion. Nothing here is ever green, amber, or fault red.
 *
 * The headline window is the one that BITES FIRST (`bitesFirst`; ENG-008
 * E15, resolving the E12 finding): a spent window, then the soonest projected
 * exhaustion before its reset, then the fullest. `usageOverview` applies it
 * across accounts, once, for the page, the popover, and the glyph. Sorting by percent alone headlined a
 * 90% weekly that resets tonight over a 60% one that runs out tomorrow.
 *
 * Pure presentation data and pure functions: no React or DOM state. Theme
 * values stay as unresolved CSS-variable strings until the browser paints.
 */
import {
  CONSUMPTION_CHROME as CHROME,
  FLUX_CSS as FLUX,
  consumptionAlpha,
  pressureColorCss as pressureColor,
} from '../flux';
import {
  projectWindow,
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
 * Orders two readings by which bites first: a spent window, then the soonest
 * projected exhaustion before its reset, then the fullest. Negative when `a`
 * bites first.
 */
export function bitesFirst(a: MeterReading, b: MeterReading): number {
  const spentA = a.state === 'exhausted';
  const spentB = b.state === 'exhausted';
  if (spentA !== spentB) return spentA ? -1 : 1;
  if (spentA && spentB) return b.msToReset - a.msToReset;
  const runsOutA = a.exhaustsBeforeReset ? a.msToExhaust : Infinity;
  const runsOutB = b.exhaustsBeforeReset ? b.msToExhaust : Infinity;
  if (runsOutA !== runsOutB) return runsOutA - runsOutB;
  return b.usedPercent - a.usedPercent;
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

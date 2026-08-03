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

export function paceSentence(r: MeterReading): string {
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
 * window differently.
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

/**
 * Plan-window forecast (ENG-008 E15/E17): the ONE derivation of where a plan
 * window stands and where it is heading.
 *
 * It lives in core, not the renderer, because two processes need the same
 * answer: the Usage page and chrome meter render it, and Electron main's
 * usage alerts decide from it while the window is in the background. A
 * second copy anywhere is how a notification and the page come to disagree
 * about the same window.
 *
 * Pure: no clock, no IO. Wall-clock phrasing takes an optional IANA zone so
 * tests, the scenario workbench and main all phrase deterministically.
 */
import type { PlanAccountSourceId, PlanWindow } from './types';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * The developer-tunable thresholds behind every forecast. Changing one here
 * changes the page, the meter and the alerts together.
 */
export const PLAN_FORECAST_POLICY = {
  /** No forecast until this share of a window has elapsed: a pace read from
   *  the first minutes of a week is noise. */
  minElapsedFraction: 0.03,
  /** "About N% left at reset" is worth stating only above this many points. */
  unusedWorthSayingPts: 15,
} as const;

export type PlanForecastPolicy = typeof PLAN_FORECAST_POLICY;

/** Where a window is heading at its observed pace, or null when too young. */
export type PlanOutlook =
  | { kind: 'spent' }
  | { kind: 'runs-out'; atMs: number }
  | { kind: 'left-at-reset'; percent: number }
  | { kind: 'lasts' };

export interface PlanWindowPosition {
  usedPercent: number;
  windowMinutes: number;
  resetsAtMs: number;
  /** Observed burn, percent per hour. */
  ratePerHour: number;
}

export interface PlanWindowForecast {
  msToReset: number;
  /** Where an evenly consumed window would sit now, 0..100. */
  evenPacePercent: number;
  /** Where the window lands at its reset if the pace holds. */
  projectedPercent: number;
  msToExhaust: number;
  exhaustsBeforeReset: boolean;
  outlook: PlanOutlook | null;
}

/**
 * The forecast, projected from NOW. The vendor's figure stands as of its
 * observation and is not aged forward: a Codex window is written only while
 * Codex runs, so a reading hours old usually means hours of no burn, and
 * projecting the old pace across them announces run-outs that never happen.
 */
export function forecastPlanWindow(
  position: PlanWindowPosition,
  nowMs: number,
  policy: PlanForecastPolicy = PLAN_FORECAST_POLICY
): PlanWindowForecast {
  const { usedPercent, windowMinutes, resetsAtMs, ratePerHour } = position;
  const windowMs = windowMinutes * MIN;
  const msToReset = Math.max(0, resetsAtMs - nowMs);
  const elapsedMs = Math.max(0, windowMs - msToReset);
  const evenPacePercent =
    windowMs > 0 ? Math.max(0, Math.min(100, (elapsedMs / windowMs) * 100)) : 0;
  const projectedPercent = usedPercent + ratePerHour * (msToReset / HOUR);
  const msToExhaust =
    usedPercent >= 100
      ? 0
      : ratePerHour > 0
        ? ((100 - usedPercent) / ratePerHour) * HOUR
        : Infinity;
  const exhaustsBeforeReset = projectedPercent > 100;

  let outlook: PlanOutlook | null;
  if (usedPercent >= 100) outlook = { kind: 'spent' };
  else if (elapsedMs < windowMs * policy.minElapsedFraction) outlook = null;
  else if (exhaustsBeforeReset) outlook = { kind: 'runs-out', atMs: nowMs + msToExhaust };
  else if (100 - projectedPercent >= policy.unusedWorthSayingPts) {
    outlook = { kind: 'left-at-reset', percent: Math.round(100 - projectedPercent) };
  } else outlook = { kind: 'lasts' };

  return {
    msToReset,
    evenPacePercent,
    projectedPercent,
    msToExhaust,
    exhaustsBeforeReset,
    outlook,
  };
}

/**
 * Observed AVERAGE burn since the window opened, %/hour: the honest fallback
 * when a window has a single observation and no trend can be derived. Never
 * a fabricated zero for an unknown pace.
 */
export function observedAverageRate(window: PlanWindow): number {
  if (window.windowMinutes <= 0 || !window.resetsAt) return 0;
  const windowMs = window.windowMinutes * MIN;
  const resetsAtMs = Date.parse(window.resetsAt);
  const observedAtMs = Date.parse(window.observedAt);
  if (Number.isNaN(resetsAtMs) || Number.isNaN(observedAtMs)) return 0;
  const elapsedMs = Math.min(
    windowMs,
    Math.max(0, windowMs - (resetsAtMs - observedAtMs))
  );
  return window.usedPercent / Math.max(0.5, elapsedMs / HOUR);
}

/* ------------------------------------------------------------------ */
/* names                                                               */
/* ------------------------------------------------------------------ */

/**
 * The vendor ACCOUNT a harness draws on, named the way the operator names it.
 * A plan window meters the whole account (claude.ai chat included), so
 * account surfaces say "Claude", never the tool sharing its sign-in. Keyed by
 * every account a plan read can describe, ledgered or not (ENG-038 slice 4).
 */
export const CONSUMPTION_ACCOUNT_NAME: Record<PlanAccountSourceId, string> = {
  'claude-code': 'Claude',
  codex: 'Codex',
  grok: 'Grok',
  antigravity: 'Google',
};

/**
 * The one display name for a plan window, in the vendors' own vocabulary
 * (claude.ai: "Current session", "This week", "Fable this week"). `scope` is
 * the model a narrower limit applies to (`PlanWindow.limitName`).
 */
export function planMeterLabel(windowMinutes: number, scope: string | null): string {
  let period: string;
  if (windowMinutes > 0 && windowMinutes % 10_080 === 0) {
    const weeks = windowMinutes / 10_080;
    period = weeks === 1 ? 'this week' : `these ${weeks} weeks`;
  } else if (windowMinutes >= 40_320 && windowMinutes <= 44_640) {
    period = 'this month';
  } else if (windowMinutes > 0 && windowMinutes % 1440 === 0) {
    const days = windowMinutes / 1440;
    period = days === 1 ? 'today' : `these ${days} days`;
  } else if (windowMinutes === 300) {
    period = 'session';
  } else {
    const hours = Math.max(1, Math.round(windowMinutes / 60));
    period = `${hours}-hour limit`;
  }
  if (scope) return `${scope} ${period}`;
  if (period === 'session') return 'Current session';
  return period.charAt(0).toUpperCase() + period.slice(1);
}

/* ------------------------------------------------------------------ */
/* wall-clock phrasing, in the operator's zone                          */
/* ------------------------------------------------------------------ */

export interface PlanPhraseOptions {
  /** IANA zone for wall-clock phrases; the host zone when omitted. */
  timeZone?: string;
}

function calendar(ms: number, timeZone: string | undefined) {
  const out: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(ms)) {
    out[part.type] = part.value;
  }
  return {
    day: Date.UTC(Number(out.year), Number(out.month) - 1, Number(out.day)) / DAY,
    hour: Number(out.hour),
  };
}

function format(ms: number, timeZone: string | undefined, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-US', { timeZone, ...options }).format(ms);
}

/**
 * A vendor's exact reset instant: "7:10 PM" today, "Mon 2:00 AM" this week,
 * "Oct 12, 2:00 AM" beyond it. A reset time is a fact, so it keeps minutes.
 */
export function planResetPhrase(
  atMs: number,
  nowMs: number,
  options: PlanPhraseOptions = {}
): string {
  const tz = options.timeZone;
  const days = calendar(atMs, tz).day - calendar(nowMs, tz).day;
  const time = format(atMs, tz, { hour: 'numeric', minute: '2-digit' });
  if (days <= 0) return time;
  if (days < 7) return `${format(atMs, tz, { weekday: 'short' })} ${time}`;
  return `${format(atMs, tz, { month: 'short', day: 'numeric' })}, ${time}`;
}

/**
 * A forecast instant, with the precision a forecast deserves: "in 40 min",
 * "tonight around 11 PM", "tomorrow around 8 AM", "Thursday around 11 PM".
 * `approximate: false` drops the "around" for instants that are facts.
 */
export function planWhenPhrase(
  atMs: number,
  nowMs: number,
  options: PlanPhraseOptions = {},
  approximate = true,
  short = false
): string {
  const tz = options.timeZone;
  const ms = atMs - nowMs;
  if (approximate && ms < 90 * MIN) {
    return `in ${Math.max(1, Math.round(ms / MIN))} min`;
  }
  const at = approximate ? Math.round(atMs / HOUR) * HOUR : atMs;
  const days = calendar(at, tz).day - calendar(nowMs, tz).day;
  const hour = calendar(at, tz).hour;
  const time = approximate
    ? format(at, tz, { hour: 'numeric' })
    : format(at, tz, { hour: 'numeric', minute: '2-digit' });
  const around = approximate ? 'around ' : 'at ';
  if (days <= 0) return hour >= 18 ? `tonight ${around}${time}` : `today ${around}${time}`;
  if (days === 1) return `tomorrow ${around}${time}`;
  if (days < 7) {
    return `${format(at, tz, { weekday: short ? 'short' : 'long' })} ${around}${time}`;
  }
  return `${format(at, tz, { month: 'short', day: 'numeric' })} ${around}${time}`;
}

/** A span as a person says it: "40 min", "5 hours", "1 day", "4½ days". */
export function planGapPhrase(ms: number): string {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MIN))} min`;
  if (ms < 36 * HOUR) {
    const hours = Math.round(ms / HOUR);
    return hours === 1 ? '1 hour' : `${hours} hours`;
  }
  const halves = Math.round(ms / (DAY / 2));
  const whole = Math.floor(halves / 2);
  const half = halves % 2 === 1 ? '½' : '';
  return whole === 1 && !half ? '1 day' : `${whole}${half} days`;
}

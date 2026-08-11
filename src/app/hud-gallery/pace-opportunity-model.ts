/**
 * Pace opportunity — trigger predicate + review fixtures (ENG-008 E9 design
 * options). Study-local on purpose: production (`meter-model`) adopts the
 * predicate only after the operator picks a direction.
 *
 * THE PROBLEM. The settled escalation idiom (monochrome-until-hot,
 * silent-below-hot) was designed against the running-out goal. Its inverse —
 * "free allocation resets soon, use it or lose it" (operator, 2026-08-03:
 * "if I have some free allocation that will reset soon, I want to see
 * that... I want to use the maximum I can under the limits") — currently
 * renders as the CALMEST state on screen. Opportunity needs a voice, and it
 * must not borrow the alarm channel or the operator learns to ignore both.
 *
 * THE TWO HONEST NUMBERS. For a window behind pace:
 *
 *   floor  = evenPace% − used%   — the share that expires unused EVEN IF burn
 *            returns to even pace this instant. Pure geometry over two
 *            reported facts (used%, elapsed%); no burn-rate noise. The
 *            trigger gates on this.
 *   course = 100 − projected%    — the share that expires at the CURRENT
 *            burn. This is the number the copy shows ("N% unused at this
 *            pace"); it moves with the burn estimate, so it never gates.
 *
 * The floor has a useful built-in property: a deficit of N pts requires at
 * least N% of the window to have elapsed, so a large floor can only exist
 * late in a window — reset proximity is partially structural.
 *
 * THRESHOLDS, with rationale from the corpus shapes:
 *
 *   floor ≥ 15 pts     3× the shared even band (±5). On a 5-hour window
 *                      that is ~45 minutes of full-rate work; on a weekly,
 *                      ~one day of allocation. Below it, "behind" is a pace
 *                      verdict, not an opportunity.
 *   reset ≥ 30m away   under half an hour nothing meaningful can still be
 *                      launched against the headroom; suppress the
 *                      last-minutes flicker.
 *   never hot/spent    the alarm states own their channel outright; a window
 *                      cannot warn and beckon at once.
 *
 *   closing tier       floor ≥ 30 pts, or reset within a quarter of the
 *                      window — the countdown becomes the leading fact. The
 *                      operator's verbatim case (weekly at 28% used, resets
 *                      9h → floor 67) sits deep in this tier. The real
 *                      recovered weekly at 75% used never triggers at all.
 *
 * THE STANDING FALSE POSITIVE, named rather than hidden: deliberate idle.
 * Overnight and on weekends every live window drifts behind even pace, so
 * the trigger holds for hours at a time and no threshold can distinguish
 * "sleeping" from "leaving money on the table". That is precisely why the
 * opportunity voice must be quiet enough to be furniture when ignored —
 * and why it may never share the alarm channel.
 */
import type {
  CapacityWindowView,
  ConsumptionSourceView,
} from '@/components/consumption/model';
import type { MeterReading } from '@/components/consumption/meter/meter-model';

/* ------------------------------------------------------------------ */
/* trigger predicate                                                   */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* review fixtures                                                     */
/* ------------------------------------------------------------------ */

export const STUDY_NOW_MS = Date.parse('2026-08-02T15:20:00.000Z');

const MIN = 60_000;
const HOUR = 60 * MIN;

function codexWindow(
  limitId: string,
  label: string,
  usedPercent: number,
  windowMinutes: number,
  msToReset: number,
  burnPercentPerHour: number
): CapacityWindowView {
  return {
    limitId,
    label,
    usedPercent,
    windowMinutes,
    resetsAtMs: STUDY_NOW_MS + msToReset,
    burnPercentPerHour,
    observedAtMs: STUDY_NOW_MS - 90_000,
  };
}

function codex(windows: CapacityWindowView[]): ConsumptionSourceView {
  return {
    key: 'codex',
    harness: 'codex',
    label: 'Codex',
    planType: 'pro',
    credits: null,
    windows,
    observedTokens5h: 3_480_000,
    observedSessions: 4,
    observedDelegatedShare: null,
    burn: [0.31, 0.44, 0.38, 0.52, 0.61, 0.55, 0.72, 0.66],
  };
}

function claudeSilent(): ConsumptionSourceView {
  return {
    key: 'claude-code',
    harness: 'claude-code',
    label: 'Claude Code',
    planType: null,
    credits: null,
    windows: [],
    observedTokens5h: 9_120_000,
    observedSessions: 6,
    observedDelegatedShare: 0.38,
    burn: [0.48, 0.62, 0.71, 0.58, 0.83, 0.69, 0.44, 0.76],
    unreportedReason:
      'No plan, quota, or rate-limit record exists anywhere in Claude Code’s local files.',
  };
}

/** A cycle that already closed with headroom unspent — the expired state. */
export interface ClosedCycle {
  label: string;
  unusedPercent: number;
  agoMs: number;
}

export interface OpportunityFixtureState {
  id: string;
  label: string;
  caption: string;
  nowMs: number;
  sources: ConsumptionSourceView[];
  lastCycle?: ClosedCycle;
}

export const OPPORTUNITY_STATES: OpportunityFixtureState[] = [
  {
    id: 'comfortable',
    label: 'Comfortable pace',
    caption:
      'Both windows on even pace. No direction speaks — the meter stays furniture.',
    nowMs: STUDY_NOW_MS,
    sources: [
      codex([
        codexWindow('codex-primary', '5-hour window', 41, 300, 175 * MIN, 8.0),
        codexWindow(
          'codex-weekly',
          'Weekly window',
          46,
          10_080,
          88 * HOUR,
          0.45
        ),
      ]),
      claudeSilent(),
    ],
  },
  {
    id: 'mildly-behind',
    label: 'Mildly behind',
    caption:
      '5-hour window 12 pts behind — under the 15-pt floor, so it keeps the plain pace verdict. Weekly 17 pts behind: the quiet tier appears.',
    nowMs: STUDY_NOW_MS,
    sources: [
      codex([
        codexWindow('codex-primary', '5-hour window', 30, 300, 174 * MIN, 6.0),
        codexWindow(
          'codex-weekly',
          'Weekly window',
          38,
          10_080,
          76 * HOUR,
          0.5
        ),
      ]),
      claudeSilent(),
    ],
  },
  {
    id: 'strongly-behind',
    label: 'Strongly behind · near reset',
    caption:
      'The operator’s verbatim shape: weekly at 28% with 9h to reset — 72% free, and at least 67 pts expire unused even at even pace from now. The closing tier.',
    nowMs: STUDY_NOW_MS,
    sources: [
      codex([
        codexWindow('codex-primary', '5-hour window', 47, 300, 153 * MIN, 9.0),
        codexWindow('codex-weekly', 'Weekly window', 28, 10_080, 9 * HOUR, 0.6),
      ]),
      claudeSilent(),
    ],
  },
  {
    id: 'expired',
    label: 'Opportunity expired',
    caption:
      'The weekly window reset 25m ago with 67% unused. Chip and geometry fall silent; only the metric swap keeps a one-line ledger.',
    nowMs: STUDY_NOW_MS,
    sources: [
      codex([
        codexWindow('codex-primary', '5-hour window', 52, 300, 140 * MIN, 8.0),
        codexWindow(
          'codex-weekly',
          'Weekly window',
          1,
          10_080,
          10_055 * MIN,
          0.4
        ),
      ]),
      claudeSilent(),
    ],
    lastCycle: { label: 'Weekly window', unusedPercent: 67, agoMs: 25 * MIN },
  },
  {
    id: 'dual-signal',
    label: 'Dual signal · hot + expiring',
    caption:
      '5-hour window hot and on course to be spent before its reset; the weekly expiring at the same time. The alarm keeps the color and the coach slot; opportunity stays grey and subordinate.',
    nowMs: STUDY_NOW_MS,
    sources: [
      codex([
        codexWindow('codex-primary', '5-hour window', 88, 300, 70 * MIN, 11.0),
        codexWindow(
          'codex-weekly',
          'Weekly window',
          34,
          10_080,
          11 * HOUR,
          1.2
        ),
      ]),
      claudeSilent(),
    ],
  },
];

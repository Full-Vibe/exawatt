/**
 * Pace opportunity — review fixtures (ENG-008 E9).
 *
 * SUBJECT PARTLY SHIPPED (operator pick, 2026-08-11): Direction C (metric
 * swap + coach) landed everywhere, plus Direction B's expiry geometry on the
 * `/usage` pace bars only — B stays off the popover, where the study proved
 * the region too small to read. The trigger predicate, thresholds, and the
 * whole opportunity vocabulary now live in production `meter-model`
 * (`opportunityOf` and friends); this file keeps only the five review
 * fixtures the study switches between, so the specimens render the REAL
 * production predicate and can never drift from it.
 *
 * The fixture shapes still carry the design rationale: the operator's
 * verbatim case (weekly at 28% used, resets 9h → floor 67) sits deep in the
 * closing tier; a 12-pt deficit stays a plain pace verdict; the dual-signal
 * state proves the alarm always outranks the opportunity voice. The named
 * standing false positive — deliberate idle — is documented on the predicate
 * itself in `meter-model`.
 */
import type {
  CapacityWindowView,
  ConsumptionSourceView,
} from '@/components/consumption/model';
import type { ClosedCycle } from '@/components/consumption/meter/meter-model';

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

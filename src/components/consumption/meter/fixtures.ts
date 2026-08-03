/**
 * Ambient meter gallery fixtures (ENG-008 meter options).
 *
 * Four authored states exercise the full escalation ladder at a pinned
 * instant, and the fifth is the REAL demo corpus — the same
 * `demoConsumption()` sources the chrome placement renders — so the gallery
 * always shows what the title bar actually says today.
 *
 * Fixture shape mirrors the corpus truthfully: Codex reports a 5-hour and a
 * weekly window; Claude Code reports nothing anywhere on disk and is
 * therefore unmetered, never zero.
 */

import type { CapacityWindowView, ConsumptionSourceView } from '../model';
import { demoConsumption, DEMO_NOW_MS } from '../demo-source';

export const FIXTURE_NOW_MS = Date.parse('2026-08-02T15:20:00.000Z');

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
    resetsAtMs: FIXTURE_NOW_MS + msToReset,
    burnPercentPerHour,
    observedAtMs: FIXTURE_NOW_MS - 90_000,
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

export interface MeterFixtureState {
  id: string;
  label: string;
  caption: string;
  nowMs: number;
  sources: ConsumptionSourceView[];
}

export const METER_STATES: MeterFixtureState[] = [
  {
    id: 'healthy',
    label: 'Healthy',
    caption:
      '5-hour window at 34%, on even pace. Monochrome and quiet — the meter is furniture.',
    nowMs: FIXTURE_NOW_MS,
    sources: [
      codex([
        codexWindow('codex-primary', '5-hour window', 34, 300, 3 * HOUR + 10 * MIN, 5.2),
        codexWindow('codex-weekly', 'Weekly window', 28, 10_080, 122 * HOUR, 0.35),
      ]),
      claudeSilent(),
    ],
  },
  {
    id: 'warm',
    label: 'Warm · 71%',
    caption:
      '5-hour window at 71%, still on even pace. Brighter monochrome; the consumption channel stays off.',
    nowMs: FIXTURE_NOW_MS,
    sources: [
      codex([
        codexWindow('codex-primary', '5-hour window', 71, 300, 1 * HOUR + 40 * MIN, 8.0),
        codexWindow('codex-weekly', 'Weekly window', 58, 10_080, 68 * HOUR, 0.4),
      ]),
      claudeSilent(),
    ],
  },
  {
    id: 'hot',
    label: 'Hot · 86% ahead',
    caption:
      '5-hour window at 86% and ahead of even pace — the first state that earns color, and the coach line appears in the popover.',
    nowMs: FIXTURE_NOW_MS,
    sources: [
      codex([
        codexWindow('codex-primary', '5-hour window', 86, 300, 1 * HOUR + 5 * MIN, 11.0),
        codexWindow('codex-weekly', 'Weekly window', 76, 10_080, 60 * HOUR, 0.4),
      ]),
      claudeSilent(),
    ],
  },
  {
    id: 'exhausted',
    label: 'Exhausted',
    caption:
      '5-hour window spent. The numeral forms swap to the reset countdown — the only number that still matters.',
    nowMs: FIXTURE_NOW_MS,
    sources: [
      codex([
        codexWindow('codex-primary', '5-hour window', 100, 300, 48 * MIN, 0.4),
        codexWindow('codex-weekly', 'Weekly window', 88, 10_080, 54 * HOUR, 0.2),
      ]),
      claudeSilent(),
    ],
  },
  {
    id: 'demo-corpus',
    label: 'Demo corpus',
    caption:
      'The real demo plan windows the chrome placement renders — Codex 5-hour at 68%, weekly at 84% (the headline: its pace exhausts it before reset).',
    nowMs: DEMO_NOW_MS,
    sources: demoConsumption().sources,
  },
];

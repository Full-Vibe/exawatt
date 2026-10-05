/**
 * Usage alerts (ENG-008 E17): which plan windows deserve a notification now.
 *
 * Pure decision over the live snapshot's own vocabulary (plan windows,
 * observed rates, account state). Electron main runs it in the background and
 * posts the result; nothing here posts, persists, or reads a clock.
 *
 * Each live window has three stages, each spoken at most once per window
 * CYCLE (one reset period):
 *
 *   on-course  the forecast first says it runs out before its reset;
 *   soon       the projected run-out is within the operator's lead time;
 *   spent      the window is at its limit.
 *
 * A later stage covers the earlier ones, so a window first seen already
 * within the lead time notifies once, not twice. The cycle is identified by
 * the reset instant rounded to `cycleRoundingMs`, because Codex reports the
 * same reset a few seconds apart from read to read.
 */
import { planWindowKey } from './plan-window-history';
import {
  CONSUMPTION_ACCOUNT_NAME,
  forecastPlanWindow,
  observedAverageRate,
  planMeterLabel,
  planResetPhrase,
  planWhenPhrase,
  type PlanPhraseOptions,
} from './plan-forecast';
import type { ProviderPlanAccountState } from './live-snapshot';
import type { ConsumptionSourceId, PlanWindow } from './types';

const MIN = 60_000;

/**
 * The developer-tunable alert policy. The operator's own choices (on or off,
 * and the lead time) live in Settings, Notifications; these are the bounds
 * and defaults those choices sit inside.
 */
export const USAGE_ALERT_POLICY = {
  /** Default lead time for the "soon" alert, in minutes. */
  defaultLeadMinutes: 60,
  /** The lead times Settings offers. null turns the second alert off. */
  leadMinuteChoices: [null, 30, 60, 120] as const,
  /** Codex's reset instant jitters by seconds; a cycle is this coarse. */
  cycleRoundingMs: 10 * MIN,
} as const;

export type UsageAlertLeadMinutes =
  (typeof USAGE_ALERT_POLICY.leadMinuteChoices)[number];

export type UsageAlertStage = 'on-course' | 'soon' | 'spent';

const STAGE_ORDER: readonly UsageAlertStage[] = ['on-course', 'soon', 'spent'];

export interface UsageAlert {
  source: ConsumptionSourceId;
  stage: UsageAlertStage;
  title: string;
  body: string;
  /** Every stage key this alert speaks for; remember them all as sent. */
  keys: string[];
}

export interface UsageAlertInput {
  planWindows: readonly PlanWindow[];
  windowRates: Readonly<Record<string, number>>;
  providerPlanAccounts?: readonly ProviderPlanAccountState[];
}

export interface UsageAlertSettings {
  /** Minutes before the projected run-out for the second alert; null = off. */
  leadMinutes: number | null;
}

/** One stage of one window cycle: what "already sent" remembers. */
export function usageAlertKey(
  window: PlanWindow,
  resetsAtMs: number,
  stage: UsageAlertStage
): string {
  const cycle =
    Math.round(resetsAtMs / USAGE_ALERT_POLICY.cycleRoundingMs) *
    USAGE_ALERT_POLICY.cycleRoundingMs;
  return `${planWindowKey(window)}@${cycle}#${stage}`;
}

/** Keys whose cycle has reset are history: drop them so the set stays small. */
export function liveUsageAlertKeys(
  keys: Iterable<string>,
  nowMs: number
): string[] {
  const out: string[] = [];
  for (const key of keys) {
    const match = /@(\d+)#/u.exec(key);
    if (match && Number(match[1]) + USAGE_ALERT_POLICY.cycleRoundingMs > nowMs) {
      out.push(key);
    }
  }
  return out;
}

/** The newest reading per window bucket, live ones only. */
function liveWindows(windows: readonly PlanWindow[], nowMs: number): PlanWindow[] {
  const byKey = new Map<string, PlanWindow>();
  for (const window of windows) {
    if (window.windowMinutes <= 0 || !window.resetsAt) continue;
    const key = planWindowKey(window);
    const previous = byKey.get(key);
    if (!previous || Date.parse(window.observedAt) > Date.parse(previous.observedAt)) {
      byKey.set(key, window);
    }
  }
  return [...byKey.values()].filter(window => {
    const resetsAtMs = Date.parse(window.resetsAt!);
    const observedAtMs = Date.parse(window.observedAt);
    if (Number.isNaN(resetsAtMs) || Number.isNaN(observedAtMs)) return false;
    // Expired: a past cycle. Stale: older than the window it describes.
    if (nowMs >= resetsAtMs) return false;
    return nowMs - observedAtMs <= window.windowMinutes * MIN;
  });
}

export function dueUsageAlerts(
  input: UsageAlertInput,
  nowMs: number,
  settings: UsageAlertSettings,
  sent: ReadonlySet<string>,
  phrase: PlanPhraseOptions = {}
): UsageAlert[] {
  const alerts: UsageAlert[] = [];
  for (const window of liveWindows(input.planWindows, nowMs)) {
    const resetsAtMs = Date.parse(window.resetsAt!);
    const key = planWindowKey(window);
    const forecast = forecastPlanWindow(
      {
        usedPercent: window.usedPercent,
        windowMinutes: window.windowMinutes,
        resetsAtMs,
        ratePerHour: input.windowRates[key] ?? observedAverageRate(window),
      },
      nowMs
    );
    const outlook = forecast.outlook;
    let stage: UsageAlertStage | null = null;
    if (outlook?.kind === 'spent') stage = 'spent';
    else if (outlook?.kind === 'runs-out') {
      const lead = settings.leadMinutes;
      stage = lead !== null && forecast.msToExhaust <= lead * MIN ? 'soon' : 'on-course';
    }
    if (!stage) continue;
    const covered = STAGE_ORDER.slice(0, STAGE_ORDER.indexOf(stage) + 1).map(s =>
      usageAlertKey(window, resetsAtMs, s)
    );
    if (sent.has(covered[covered.length - 1])) continue;

    const name = CONSUMPTION_ACCOUNT_NAME[window.source];
    const label = planMeterLabel(window.windowMinutes, window.limitName);
    const used = `${Math.round(window.usedPercent)}% used`;
    const resets = `resets ${planResetPhrase(resetsAtMs, nowMs, phrase)}`;
    const account = input.providerPlanAccounts?.find(a => a.source === window.source);
    const spare = account?.status === 'ok' ? (account.resets?.available ?? 0) : 0;
    const spareLine =
      spare > 0 ? ` · ${spare} free ${spare === 1 ? 'reset' : 'resets'}` : '';
    const body =
      stage === 'spent'
        ? `Out until it ${resets}${spareLine}`
        : `Runs out ${planWhenPhrase(nowMs + forecast.msToExhaust, nowMs, phrase)} at this pace · ${used} · ${resets}${spareLine}`;
    alerts.push({
      source: window.source,
      stage,
      title: `${name} · ${label}`,
      body,
      keys: covered,
    });
  }
  return alerts;
}

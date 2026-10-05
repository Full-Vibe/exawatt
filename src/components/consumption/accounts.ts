/**
 * Usage accounts (ENG-008 E15): the one projection every usage surface
 * renders. The `/usage` account cards, the chrome meter's popover, and the
 * `/hud-gallery/usage-scenarios` workbench all read `usageOverview`, so the
 * page, the glance and the simulator cannot disagree.
 *
 * The unit is the vendor ACCOUNT, not the harness. A plan window the vendor
 * reports meters everything on the plan (claude.ai chat as well as Claude
 * Code), so the card is named for the account and holds every meter that
 * account enforces: its windows, its pay-as-you-go lane, and its banked
 * resets. A future Agent Source plugin adds an account by producing the same
 * `ConsumptionSourceView`; nothing here names a vendor except for display.
 *
 * Honesty rules this module owns:
 *
 * - A read that failed keeps its last windows at their TRUE as-of instant and
 *   says it is stale. It never disappears, and its forecast lines keep
 *   speaking from that reading, so losing a read never makes a card calmer
 *   than the last thing Exawatt saw.
 * - Facts only (operator, 2026-10-05, ENG-008 E17): cards and sections, no
 *   prose summary across accounts. Forecasts come from core's
 *   `forecastPlanWindow`, the same derivation main's usage alerts use.
 * - "Off", "couldn't read" and "keeps no plan record" are three different
 *   sentences (`planReadState`), never one.
 * - Absent is never zero: an account whose source cannot report resets or
 *   credits carries `null`, not an empty count.
 * - The burn line (ENG-008 E16) is a projection of the same samples the cards
 *   count, over a short trailing window, per account with a local ledger. An
 *   account read without a ledger (Google) has no burn entry: unmeasured is
 *   not zero. Dollars are modelled at one stated list basis and say so.
 *
 * Pure data and pure functions: no React, no DOM. Wall-clock phrasing takes
 * an optional IANA time zone so tests and the simulator are deterministic.
 */
import {
  CONSUMPTION_ACCOUNT_NAME,
  PLAN_ACCOUNT_SOURCE_IDS,
  isConsumptionSourceId,
  planWhenPhrase,
  resolveModelWeight,
  weightUsage,
  type ConsumptionSample,
  type PlanAccountFailureCause,
  type PlanOutlook,
  type PlanPhraseOptions,
} from '@exawatt/core';
import {
  ACCOUNT_APP,
  planReadState,
  windowFreshness,
  type AccountReadView,
  type AccountSource,
  type AccountSpendView,
  type CapacityWindowView,
  type ConsumptionSourceView,
} from './model';
import { bitesFirst, readWindowPace, type MeterReading } from './meter/meter-model';
import { modelledDollars } from './units';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/* ------------------------------------------------------------------ */
/* shapes                                                              */
/* ------------------------------------------------------------------ */

/**
 * How much of an account Exawatt can see right now.
 *
 *   reporting    — at least one live window from a working read.
 *   stale        — windows exist but the read behind them is failing, or
 *                  is older than the window; shown with their true as-of.
 *   unreadable   — an account read exists and has nothing current.
 *   off          — the operator turned the account read off.
 *   unmetered    — the source keeps no plan record at all (a fact).
 */
type AccountHealth =
  | 'reporting'
  | 'stale'
  | 'unreadable'
  | 'off'
  | 'unmetered';

type MeterForecast = PlanOutlook;

export interface AccountMeter {
  /** Unique window-bucket key (`planWindowKey`). */
  key: string;
  label: string;
  /** The model a narrower limit applies to; null for plan-wide windows. */
  scope: string | null;
  windowMinutes: number;
  usedPercent: number;
  resetsAtMs: number;
  /** Where an evenly consumed window would sit now, 0..100. */
  evenPacePercent: number;
  /** null while the window is too young, or its read too old, to forecast. */
  forecast: MeterForecast | null;
  /** False when the last read is older than the window (drawn dimmed). */
  live: boolean;
  /** The shared pace reading every surface derives from. */
  reading: MeterReading;
}

interface AccountResets {
  available: number;
  /** Exawatt can spend one now: the read is current, the source can spend,
   *  and the account holds at least one. */
  canUse: boolean;
  /** The soonest-expiring reset, when the vendor reported details. */
  next: { title: string | null; expiresAtMs: number | null } | null;
}

export interface UsageAccount {
  key: string;
  harness: AccountSource;
  /** The account as the operator names it: "Claude", "Codex". */
  name: string;
  /** The plan tier, e.g. "Max 20x", "Pro". null when not reported. */
  plan: string | null;
  health: AccountHealth;
  /** The newest instant anything on this card was read. */
  asOfMs: number | null;
  /** Session first, then the plan-wide week, then model-scoped limits. */
  meters: AccountMeter[];
  /** Pay-as-you-go spend past the plan's limits (Claude extra usage). */
  spend: AccountSpendView | null;
  /** Prepaid credit balance (Codex credits). null when not reported. */
  credits: { balance: number | null; unlimited: boolean } | null;
  /** Banked resets. null when the source cannot report them. */
  resets: AccountResets | null;
  /** Why the account's latest read produced nothing, when its source could
   *  say; undefined while reads succeed. */
  failure: PlanAccountFailureCause | null;
  /** Raw tokens measured locally for this source over the view's window. */
  observedTokens: number;
}

/**
 * The trailing span the burn line reads. The harnesses record a sample per
 * assistant message or token-count event, one to five seconds apart while an
 * Agent works, and the scanner pushes appended tails within about ten
 * seconds; ten minutes holds several turns of that cadence, moves within a
 * minute of work starting, and falls to a true zero within minutes of it
 * stopping. Stated on screen as `BURN_WINDOW_LABEL`.
 */
export const BURN_WINDOW_MS = 10 * MIN;
export const BURN_WINDOW_LABEL = 'last 10 min';

interface VendorBurn {
  accountKey: string;
  name: string;
  /** Raw tokens per minute over the window. 0 is a true reading. */
  tokensPerMinute: number;
  /** Modelled dollars per hour at `modelledDollars`' stated list basis; no
   *  vendor reports a rate, so this is never a vendor figure. */
  dollarsPerHour: number;
}

export interface UsageBurn {
  windowMs: number;
  windowLabel: string;
  /** One entry per account with a local ledger and a card, in account order.
   *  An account without a ledger has no entry: unmeasured, never 0. */
  vendors: VendorBurn[];
  /** The vendors' sum: the glance is a projection of the detail. */
  tokensPerMinute: number;
  dollarsPerHour: number;
  /** Raw tokens the window held across the vendors listed. */
  tokens: number;
}

export interface UsageOverview {
  nowMs: number;
  /** The span `observedTokens` covers, in words ("seven days"). */
  windowLabel: string;
  accounts: UsageAccount[];
  /** The meter the chrome glyph shows: the live one that bites first. */
  binding: { accountKey: string; meter: AccountMeter } | null;
  /** What this machine is drawing right now, from the same samples. */
  burn: UsageBurn;
}

/** The parts of a consumption view this projection reads. */
interface UsageOverviewInput {
  nowMs: number;
  windowLabel: string;
  sources: readonly ConsumptionSourceView[];
  samples: readonly ConsumptionSample[];
}

export type PhraseOptions = PlanPhraseOptions;

/* ------------------------------------------------------------------ */
/* the projection                                                      */
/* ------------------------------------------------------------------ */

const ACCOUNT_ORDER: readonly AccountSource[] = PLAN_ACCOUNT_SOURCE_IDS;

export function usageOverview(input: UsageOverviewInput): UsageOverview {
  const { nowMs } = input;
  const tokensBySource = new Map<string, number>();
  for (const s of input.samples) {
    const u = s.usage;
    tokensBySource.set(
      s.source,
      (tokensBySource.get(s.source) ?? 0) +
        u.inputTokens +
        u.cacheReadTokens +
        u.cacheWriteTokens +
        u.outputTokens
    );
  }

  const accounts = [...input.sources]
    .sort(
      (a, b) => ACCOUNT_ORDER.indexOf(a.harness) - ACCOUNT_ORDER.indexOf(b.harness)
    )
    .map(source => accountOf(source, nowMs, tokensBySource.get(source.harness) ?? 0))
    .filter(isWorthACard);

  let binding: UsageOverview['binding'] = null;
  for (const account of accounts) {
    for (const meter of account.meters) {
      if (!meter.live) continue;
      if (!binding || bitesFirst(meter.reading, binding.meter.reading) < 0) {
        binding = { accountKey: account.key, meter };
      }
    }
  }

  return {
    nowMs,
    windowLabel: input.windowLabel,
    accounts,
    binding,
    burn: burnOf(input.samples, accounts, nowMs),
  };
}

/**
 * The burn line: raw tokens per minute and modelled dollars per hour over the
 * trailing `BURN_WINDOW_MS`, per account that keeps a local ledger. Reads the
 * samples the cards already count, so it can never disagree with them.
 */
function burnOf(
  samples: readonly ConsumptionSample[],
  accounts: readonly UsageAccount[],
  nowMs: number
): UsageBurn {
  const from = nowMs - BURN_WINDOW_MS;
  const raw = new Map<string, number>();
  const weighted = new Map<string, number>();
  for (const s of samples) {
    if (Date.parse(s.at) <= from) continue;
    const u = s.usage;
    raw.set(
      s.source,
      (raw.get(s.source) ?? 0) +
        u.inputTokens +
        u.cacheReadTokens +
        u.cacheWriteTokens +
        u.outputTokens
    );
    weighted.set(
      s.source,
      (weighted.get(s.source) ?? 0) +
        weightUsage(u, resolveModelWeight(s.model).weight)
    );
  }
  const minutes = BURN_WINDOW_MS / MIN;
  const perHour = HOUR / BURN_WINDOW_MS;
  const vendors: VendorBurn[] = accounts
    .filter(a => isConsumptionSourceId(a.harness))
    .map(a => ({
      accountKey: a.key,
      name: a.name,
      tokensPerMinute: (raw.get(a.harness) ?? 0) / minutes,
      dollarsPerHour: modelledDollars(weighted.get(a.harness) ?? 0) * perHour,
    }));
  const tokens = vendors.reduce(
    (n, v) => n + (raw.get(v.accountKey) ?? 0),
    0
  );
  return {
    windowMs: BURN_WINDOW_MS,
    windowLabel: BURN_WINDOW_LABEL,
    vendors,
    tokensPerMinute: vendors.reduce((n, v) => n + v.tokensPerMinute, 0),
    dollarsPerHour: vendors.reduce((n, v) => n + v.dollarsPerHour, 0),
    tokens,
  };
}

function accountOf(
  source: ConsumptionSourceView,
  nowMs: number,
  observedTokens: number
): UsageAccount {
  const read = source.accountRead;
  const shown = source.windows
    .filter(w => windowFreshness(w, nowMs) !== 'expired')
    .sort(meterOrder);
  const meters = shown.map(w => meterOf(source, w, nowMs));
  const state = planReadState(source, nowMs);
  // A failing account read makes the card stale only when the figures on it
  // ARE that read's: Codex's rollout logs can carry fresher windows than an
  // account read that has never succeeded (an API-key sign-in, an old
  // binary), and those are a working reading, not a stale one.
  const freshestWindowMs = Math.max(
    -Infinity,
    ...shown.map(w => w.observedAtMs ?? -Infinity)
  );
  const readIsStale =
    read?.status === 'unavailable' &&
    read.observedAtMs !== null &&
    freshestWindowMs <= read.observedAtMs;
  const health: AccountHealth =
    state === 'reported'
      ? readIsStale
        ? 'stale'
        : 'reporting'
      : meters.length > 0
        ? 'stale'
        : state === 'off'
          ? 'off'
          : state === 'unreadable'
            ? 'unreadable'
            : 'unmetered';

  const windowAsOf = source.windows
    .map(w => w.observedAtMs)
    .filter((t): t is number => t !== undefined && Number.isFinite(t));
  const asOfCandidates = [
    ...windowAsOf,
    ...(read?.observedAtMs != null ? [read.observedAtMs] : []),
  ];
  const readable = read?.status === 'ok' || read?.status === 'unavailable';

  return {
    key: source.key,
    harness: source.harness,
    name: CONSUMPTION_ACCOUNT_NAME[source.harness],
    plan: planLabel(read?.planType ?? source.planType, read?.rateLimitTier ?? null),
    health,
    asOfMs: asOfCandidates.length > 0 ? Math.max(...asOfCandidates) : null,
    meters,
    spend: readable ? (read?.spend ?? null) : null,
    credits: readable ? (read?.credits ?? null) : null,
    resets: readable ? resetsOf(read, nowMs) : null,
    failure: read?.status === 'unavailable' ? (read.failure ?? null) : null,
    observedTokens,
  };
}

/**
 * A card is worth showing when the operator uses the account or Exawatt can
 * see it: a harness installed and idle all week does not earn a card, while
 * an account whose read fails always does (its failure is news).
 */
function isWorthACard(account: UsageAccount): boolean {
  if (account.meters.length > 0) return true;
  if (account.spend || account.resets || account.credits) return true;
  if (account.observedTokens > 0) return true;
  // A read that has ever succeeded, or one that ran and named why it failed,
  // is news; a read nothing has ever attempted is not. A ledgerless account
  // (Google) has no tokens to earn a card with, so its named failure is the
  // only way its malfunction can reach the page.
  return (
    account.health === 'unreadable' &&
    (account.asOfMs !== null || account.failure !== null)
  );
}

function meterOrder(a: CapacityWindowView, b: CapacityWindowView): number {
  if (a.windowMinutes !== b.windowMinutes) return a.windowMinutes - b.windowMinutes;
  // The plan-wide window before a model-scoped one of the same length.
  if (!a.scope !== !b.scope) return a.scope ? 1 : -1;
  return a.label.localeCompare(b.label);
}

function meterOf(
  source: ConsumptionSourceView,
  window: CapacityWindowView,
  nowMs: number
): AccountMeter {
  const reading = readWindowPace(source, window, nowMs);
  const live = windowFreshness(window, nowMs) === 'live';
  return {
    key: window.limitId,
    label: window.label,
    scope: window.scope ?? null,
    windowMinutes: window.windowMinutes,
    usedPercent: window.usedPercent,
    resetsAtMs: window.resetsAtMs,
    evenPacePercent: reading.evenPacePercent,
    forecast: live ? reading.outlook : null,
    live,
    reading,
  };
}

/** The forecast one meter can honestly state. */

function resetsOf(read: AccountReadView | undefined, nowMs: number): AccountResets | null {
  const resets = read?.resets;
  if (!resets) return null;
  const upcoming = (resets.credits ?? []).filter(
    c => c.expiresAtMs === null || c.expiresAtMs > nowMs
  );
  const soonest = [...upcoming].sort(
    (a, b) => (a.expiresAtMs ?? Infinity) - (b.expiresAtMs ?? Infinity)
  )[0];
  return {
    available: resets.available,
    canUse:
      read?.status === 'ok' && read.canUseReset === true && resets.available > 0,
    next: soonest ? { title: soonest.title, expiresAtMs: soonest.expiresAtMs } : null,
  };
}

const PLAN_NAMES: Record<string, string> = {
  free: 'Free',
  go: 'Go',
  plus: 'Plus',
  pro: 'Pro',
  prolite: 'Pro Lite',
  promax: 'Pro Max',
  max: 'Max',
  team: 'Team',
  business: 'Business',
  enterprise: 'Enterprise',
  edu: 'Edu',
};

/** `max` + `default_claude_max_20x` -> "Max 20x"; `pro` -> "Pro". */
export function planLabel(planType: string | null, tier: string | null): string | null {
  if (!planType) return null;
  const base =
    PLAN_NAMES[planType] ??
    planType
      .split(/[_\s-]+/u)
      .filter(Boolean)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  const multiple = /(\d+)x$/u.exec(tier ?? '')?.[1];
  return multiple ? `${base} ${multiple}x` : base;
}

/* ------------------------------------------------------------------ */
/* phrasing                                                            */
/* ------------------------------------------------------------------ */

/** "Updated just now" / "Updated 3 min ago" / "Updated 2 hours ago". */
export function asOfPhrase(asOfMs: number | null, nowMs: number): string | null {
  if (asOfMs === null) return null;
  const ms = Math.max(0, nowMs - asOfMs);
  if (ms < MIN) return 'Updated just now';
  if (ms < HOUR) return `Updated ${Math.round(ms / MIN)} min ago`;
  if (ms < DAY) {
    const hours = Math.round(ms / HOUR);
    return `Updated ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  const days = Math.round(ms / DAY);
  return `Updated ${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/** The one line under a meter, or null when it has nothing honest to say. */
export function forecastLine(
  meter: AccountMeter,
  nowMs: number,
  options: PhraseOptions = {},
  short = false
): string | null {
  const f = meter.forecast;
  if (!f) return null;
  const pace = short ? '' : ' at this pace';
  switch (f.kind) {
    case 'spent':
      return 'Out until reset';
    case 'runs-out':
      return `Runs out ${planWhenPhrase(f.atMs, nowMs, options, true, short)}${pace}`;
    case 'left-at-reset':
      return `About ${f.percent}% left at reset${pace}`;
    case 'lasts':
      return `Lasts until reset${pace}`;
  }
}

/** The one sentence for a named read failure, naming the app the account is
 *  read through ("Claude Code", "Codex"). */
function failureSentence(cause: PlanAccountFailureCause, app: string): string {
  switch (cause) {
    case 'not-installed':
      return `${app} isn't installed on this machine.`;
    case 'no-plan':
      return `${app} isn't signed in to a plan.`;
    case 'timed-out':
      return `${app} didn't answer in time.`;
    case 'exited':
      return `${app} stopped with an error.`;
    case 'unrecognized':
      return `${app} answered in a format Exawatt doesn't know yet.`;
  }
}

/** Why a card has no bars, as one short product sentence. */
export function healthLine(account: UsageAccount, nowMs: number): string | null {
  const app = ACCOUNT_APP[account.harness];
  const cause = account.failure ? failureSentence(account.failure, app) : null;
  switch (account.health) {
    case 'reporting':
      return null;
    case 'stale':
      return cause
        ? `Couldn't read plan limits. ${cause} Figures are from the last read.`
        : 'Not read recently. Figures are from the last read.';
    case 'off':
      return 'Plan usage is turned off in Settings, Privacy.';
    case 'unreadable': {
      const ago = asOfPhrase(account.asOfMs, nowMs);
      const last = ago ? ` ${ago.replace('Updated', 'Last read')}.` : '';
      return `Couldn't read plan limits.${cause ? ` ${cause}` : ''}${last}`;
    }
    case 'unmetered':
      return 'No plan limits reported.';
  }
}

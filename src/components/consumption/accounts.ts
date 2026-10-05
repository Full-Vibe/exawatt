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
 *   says it is stale. It never disappears, and it keeps forecasting from that
 *   reading at its true age, so losing a read can never make the headline
 *   calmer than the last thing Exawatt saw.
 * - "Off", "couldn't read" and "keeps no plan record" are three different
 *   sentences (`planReadState`), never one.
 * - Absent is never zero: an account whose source cannot report resets or
 *   credits carries `null`, not an empty count.
 *
 * Pure data and pure functions: no React, no DOM. Wall-clock phrasing takes
 * an optional IANA time zone so tests and the simulator are deterministic.
 */
import {
  CONSUMPTION_SOURCE_IDS,
  type ConsumptionSample,
  type PlanAccountFailureCause,
} from '@exawatt/core';
import {
  ACCOUNT_NAME,
  planReadState,
  windowFreshness,
  type AccountReadView,
  type AccountSpendView,
  type CapacityWindowView,
  type ConsumptionSourceView,
  type Harness,
} from './model';
import { bitesFirst, readWindowPace, type MeterReading } from './meter/meter-model';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Forecasts stay quiet until this share of a window has elapsed: a pace
 *  read from the first minutes of a week is noise. */
const FORECAST_MIN_ELAPSED_FRACTION = 0.03;

/** "About N% left at reset" is worth a line only above this many points. */
const UNUSED_WORTH_SAYING_PTS = 15;

/** A banked reset that expires within this long reaches the headline. */
const RESET_EXPIRY_HEADLINE_MS = 3 * DAY;

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

type MeterForecast =
  | { kind: 'spent' }
  | { kind: 'runs-out'; atMs: number }
  | { kind: 'left-at-reset'; percent: number }
  | { kind: 'lasts' };

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
  /** The soonest-expiring reset, when the vendor reported details. */
  next: { title: string | null; expiresAtMs: number | null } | null;
}

export interface UsageAccount {
  key: string;
  harness: Harness;
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

interface UsageHeadline {
  text: string;
  /** `hot` when something runs out; `calm` for a reset about to expire. */
  tone: 'hot' | 'calm';
  accountKey: string;
  meterKey: string | null;
}

export interface UsageOverview {
  nowMs: number;
  /** The span `observedTokens` covers, in words ("seven days"). */
  windowLabel: string;
  accounts: UsageAccount[];
  headline: UsageHeadline | null;
  /** The meter the chrome glyph shows: the live one that bites first. */
  binding: { accountKey: string; meter: AccountMeter } | null;
}

/** The parts of a consumption view this projection reads. */
interface UsageOverviewInput {
  nowMs: number;
  windowLabel: string;
  sources: readonly ConsumptionSourceView[];
  samples: readonly ConsumptionSample[];
}

export interface PhraseOptions {
  /** IANA zone for wall-clock phrases; the host zone when omitted. */
  timeZone?: string;
}

/* ------------------------------------------------------------------ */
/* the projection                                                      */
/* ------------------------------------------------------------------ */

const ACCOUNT_ORDER: readonly Harness[] = CONSUMPTION_SOURCE_IDS;

export function usageOverview(
  input: UsageOverviewInput,
  options: PhraseOptions = {}
): UsageOverview {
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
    headline: headlineOf(accounts, nowMs, options),
    binding,
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
    name: ACCOUNT_NAME[source.harness],
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
  return account.health === 'unreadable' && account.asOfMs !== null;
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
    forecast: live ? forecastOf(reading, nowMs) : null,
    live,
    reading,
  };
}

/** The forecast one meter can honestly state. */
function forecastOf(r: MeterReading, nowMs: number): MeterForecast | null {
  if (r.usedPercent >= 100) return { kind: 'spent' };
  const windowMs = r.window.windowMinutes * MIN;
  const elapsed = windowMs - r.msToReset;
  if (elapsed < windowMs * FORECAST_MIN_ELAPSED_FRACTION) return null;
  if (r.exhaustsBeforeReset) {
    return { kind: 'runs-out', atMs: nowMs + r.msToExhaust };
  }
  const left = 100 - r.projectedPercent;
  if (left >= UNUSED_WORTH_SAYING_PTS) {
    return { kind: 'left-at-reset', percent: Math.round(left) };
  }
  return { kind: 'lasts' };
}

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
/* the headline — one sentence, only when it earns its place           */
/* ------------------------------------------------------------------ */

function headlineOf(
  accounts: readonly UsageAccount[],
  nowMs: number,
  options: PhraseOptions
): UsageHeadline | null {
  // The sentence speaks for the meter that runs out first AMONG those that
  // state a run-out, which is not always the glyph's binding window: a session
  // five minutes old can bite first on pace yet be too young to forecast,
  // while a week beside it says it runs out on Thursday. Every meter that
  // says "runs out" must have a sentence above it.
  let alarm: { account: UsageAccount; meter: AccountMeter } | null = null;
  for (const account of accounts) {
    for (const meter of account.meters) {
      const kind = meter.forecast?.kind;
      if (!meter.live || (kind !== 'spent' && kind !== 'runs-out')) continue;
      if (!alarm || bitesFirst(meter.reading, alarm.meter.reading) < 0) {
        alarm = { account, meter };
      }
    }
  }
  if (alarm) {
    const { account, meter } = alarm;
    const who = meterSubject(account, meter);
    const spares = spareResets(account);
    if (meter.forecast?.kind === 'spent') {
      return {
        text: `${who} is out until ${resetPhrase(meter.resetsAtMs, nowMs, options)}.${spares}`,
        tone: 'hot',
        accountKey: account.key,
        meterKey: meter.key,
      };
    }
    if (meter.forecast?.kind === 'runs-out') {
      const gap = gapPhrase(meter.resetsAtMs - meter.forecast.atMs);
      return {
        text: `At this pace ${who} runs out ${whenPhrase(meter.forecast.atMs, nowMs, options)}, ${gap} before it resets.${spares}`,
        tone: 'hot',
        accountKey: account.key,
        meterKey: meter.key,
      };
    }
  }

  let expiring: { account: UsageAccount; atMs: number } | null = null;
  for (const account of accounts) {
    const at = account.resets?.next?.expiresAtMs;
    if (at == null || at - nowMs > RESET_EXPIRY_HEADLINE_MS) continue;
    if (!expiring || at < expiring.atMs) expiring = { account, atMs: at };
  }
  if (expiring) {
    return {
      text: `A free ${expiring.account.name} reset expires ${whenPhrase(expiring.atMs, nowMs, options, false)}.`,
      tone: 'calm',
      accountKey: expiring.account.key,
      meterKey: null,
    };
  }
  return null;
}

/** "Codex", "Claude's session limit", "Claude's Fable limit". */
function meterSubject(account: UsageAccount, meter: AccountMeter): string {
  if (meter.scope) return `${account.name}'s ${meter.scope} limit`;
  if (meter.windowMinutes < 1440) return `${account.name}'s session limit`;
  return account.name;
}

function spareResets(account: UsageAccount): string {
  const n = account.resets?.available ?? 0;
  if (n <= 0) return '';
  return n === 1 ? ' 1 free reset left.' : ` ${n} free resets left.`;
}

/* ------------------------------------------------------------------ */
/* phrasing — wall clock, in the operator's zone                        */
/* ------------------------------------------------------------------ */

function parts(ms: number, timeZone: string | undefined) {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(ms)) {
    out[p.type] = p.value;
  }
  return {
    day: Date.UTC(Number(out.year), Number(out.month) - 1, Number(out.day)) / DAY,
    hour: Number(out.hour),
  };
}

function fmt(ms: number, timeZone: string | undefined, format: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-US', { timeZone, ...format }).format(ms);
}

/**
 * The vendor's exact reset instant: "7:10 PM" today, "Mon 2:00 AM" this week,
 * "Oct 12, 2:00 AM" beyond it. A reset time is a fact, so it keeps minutes.
 */
export function resetPhrase(atMs: number, nowMs: number, options: PhraseOptions = {}): string {
  const tz = options.timeZone;
  const days = parts(atMs, tz).day - parts(nowMs, tz).day;
  const time = fmt(atMs, tz, { hour: 'numeric', minute: '2-digit' });
  if (days <= 0) return time;
  if (days < 7) return `${fmt(atMs, tz, { weekday: 'short' })} ${time}`;
  return `${fmt(atMs, tz, { month: 'short', day: 'numeric' })}, ${time}`;
}

/**
 * A forecast instant, stated with the precision a forecast deserves: "in 40
 * min", "tonight around 11 PM", "tomorrow around 8 AM", "Thursday around
 * 11 PM". `approximate: false` drops the "around" for instants that are
 * facts (a reset credit's expiry).
 */
export function whenPhrase(
  atMs: number,
  nowMs: number,
  options: PhraseOptions = {},
  approximate = true,
  short = false
): string {
  const tz = options.timeZone;
  const ms = atMs - nowMs;
  if (approximate && ms < 90 * MIN) {
    return `in ${Math.max(1, Math.round(ms / MIN))} min`;
  }
  const at = approximate ? Math.round(atMs / HOUR) * HOUR : atMs;
  const days = parts(at, tz).day - parts(nowMs, tz).day;
  const hour = parts(at, tz).hour;
  const time = approximate
    ? fmt(at, tz, { hour: 'numeric' })
    : fmt(at, tz, { hour: 'numeric', minute: '2-digit' });
  const around = approximate ? 'around ' : 'at ';
  if (days <= 0) return hour >= 18 ? `tonight ${around}${time}` : `today ${around}${time}`;
  if (days === 1) return `tomorrow ${around}${time}`;
  if (days < 7) {
    return `${fmt(at, tz, { weekday: short ? 'short' : 'long' })} ${around}${time}`;
  }
  return `${fmt(at, tz, { month: 'short', day: 'numeric' })} ${around}${time}`;
}

/** A span as a person says it: "40 min", "5 hours", "1 day", "4½ days". */
export function gapPhrase(ms: number): string {
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
      return `Runs out ${whenPhrase(f.atMs, nowMs, options, true, short)}${pace}`;
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
  const app = account.harness === 'claude-code' ? 'Claude Code' : account.name;
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

'use client';

/**
 * Usage account cards (ENG-008 E15): the bars every usage surface draws.
 *
 * `/usage` renders `AccountCard` at reading size; the chrome meter's popover
 * renders the same card with `compact`; the scenario workbench renders the
 * page itself. Every figure comes from `usageOverview` (`./accounts`), so the
 * three placements are one projection at three sizes.
 *
 * The visual idiom is the one the frontier vendors converged on (claude.ai
 * Settings, Usage; chatgpt.com Usage): one row per limit with its name, when
 * it resets, a thin bar, and the percent used. Exawatt adds two things the
 * vendors' pages do not have, both from the shared pace reading: an even-pace
 * tick on the bar, and one forecast line under a meter when it earns one.
 *
 * Color is data state only (design-system.md, Consumption channel): bars are
 * chrome neutral until a window runs hot, then take the pressure ramp; text
 * stays neutral except a forecast that says a limit runs out.
 */
import type { ReactNode } from 'react';
import {
  CONSUMPTION_CHROME as CHROME,
  FLUX_CSS as FLUX,
  consumptionAlpha,
  pressureColorCss,
  tokens,
} from './flux';
import {
  asOfPhrase,
  forecastLine,
  healthLine,
  type AccountMeter,
  type PhraseOptions,
  type UsageAccount,
} from './accounts';
import { planResetPhrase } from '@exawatt/core';
import { meterTone } from './meter/meter-model';
import { planCredits } from './units';
import { UseResetControl, type UseAccountReset } from './use-reset-control';

const TRACK = consumptionAlpha(CHROME.text, 0.12);
const TICK = consumptionAlpha(CHROME.text, 0.55);

/** Bar paint for one meter: neutral until the window runs hot. */
function barFill(meter: AccountMeter): string {
  const { state } = meter.reading;
  if (state === 'exhausted') return FLUX.hot;
  if (state === 'hot') return pressureColorCss(Math.max(86, meter.usedPercent));
  return meterTone(meter.reading).fill === CHROME.textDim
    ? consumptionAlpha(CHROME.text, 0.55)
    : CHROME.text;
}

/** The thin bar with its even-pace tick. `usedPercent` above 100 fills it. */
function UsageBar({
  meter,
  compact = false,
}: {
  meter: AccountMeter;
  compact?: boolean;
}) {
  const used = Math.max(0, Math.min(100, meter.usedPercent));
  const pace = Math.max(0, Math.min(100, meter.evenPacePercent));
  const height = compact ? 4 : 6;
  return (
    <div
      aria-hidden
      data-usage-bar={meter.key}
      className="relative w-full"
      style={{ height: height + 6 }}
    >
      <div
        className="absolute inset-x-0 rounded-full"
        style={{ top: 3, height, background: TRACK }}
      />
      <div
        className="absolute left-0 rounded-full transition-[width] duration-300 motion-reduce:transition-none"
        style={{
          top: 3,
          height,
          width: `${used}%`,
          minWidth: used > 0 ? height : 0,
          background: barFill(meter),
          opacity: meter.live ? 1 : 0.45,
        }}
      />
      {meter.live && meter.forecast !== null && (
        <div
          data-usage-pace-tick
          className="absolute w-px"
          style={{ left: `${pace}%`, top: 0, height: height + 6, background: TICK }}
        />
      )}
    </div>
  );
}

function forecastColor(meter: AccountMeter): string {
  const kind = meter.forecast?.kind;
  if (kind === 'spent' || kind === 'runs-out') return FLUX.hot;
  return CHROME.textDim;
}

/** One limit: name, reset, bar, percent used, and its forecast line. */
function MeterRow({
  meter,
  nowMs,
  compact = false,
  phrase,
}: {
  meter: AccountMeter;
  nowMs: number;
  compact?: boolean;
  phrase?: PhraseOptions;
}) {
  const forecast = forecastLine(meter, nowMs, phrase, compact);
  const reset = `Resets ${planResetPhrase(meter.resetsAtMs, nowMs, phrase)}`;
  const percent = `${Math.round(meter.usedPercent)}% used`;
  if (compact) {
    return (
      <div data-usage-meter={meter.key} className="flex flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <span className="text-chrome-meta" style={{ color: CHROME.text }}>
            {meter.label}
          </span>
          <span
            className="ml-auto text-chrome-meta tabular-nums"
            style={{ color: CHROME.text }}
          >
            {percent}
          </span>
        </div>
        <UsageBar meter={meter} compact />
        <span className="text-chrome-micro" style={{ color: CHROME.textDim }}>
          {reset}
          {forecast ? (
            <span style={{ color: forecastColor(meter) }}> · {forecast}</span>
          ) : null}
        </span>
      </div>
    );
  }
  return (
    <div
      data-usage-meter={meter.key}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-1 sm:grid-cols-[11rem_minmax(0,1fr)_5.5rem]"
    >
      <div className="col-span-2 flex flex-col sm:col-span-1">
        <span className="text-sm" style={{ color: CHROME.text }}>
          {meter.label}
        </span>
        <span className="text-chrome-meta" style={{ color: CHROME.textDim }}>
          {reset}
        </span>
      </div>
      <UsageBar meter={meter} />
      <span
        className="text-right text-sm tabular-nums"
        style={{ color: CHROME.text }}
      >
        {percent}
      </span>
      {forecast ? (
        <span
          data-usage-forecast={meter.forecast?.kind}
          className="col-span-2 text-chrome-meta sm:col-start-2 sm:col-end-4"
          style={{ color: forecastColor(meter) }}
        >
          {forecast}
        </span>
      ) : null}
    </div>
  );
}

/** A labelled fact row under the meters (extra usage, resets, credits). */
function FactRow({
  label,
  value,
  compact,
  children,
  data,
  action,
}: {
  label: string;
  value: ReactNode;
  compact: boolean;
  children?: ReactNode;
  data: string;
  /** A control beside the value (Use reset). */
  action?: ReactNode;
}) {
  return (
    <div data-usage-fact={data} className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className={compact ? 'text-chrome-meta' : 'text-sm'}
          style={{ color: CHROME.text }}
        >
          {label}
        </span>
        <span className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          <span
            className={`text-right ${compact ? 'text-chrome-meta' : 'text-sm'}`}
            style={{ color: CHROME.textDim }}
          >
            {value}
          </span>
          {action}
        </span>
      </div>
      {children}
    </div>
  );
}

/** One vendor account: its plan, its limits, and what it holds in reserve. */
export function AccountCard({
  account,
  nowMs,
  windowLabel,
  compact = false,
  phrase,
  onUseReset,
}: {
  account: UsageAccount;
  nowMs: number;
  /** The span local token counts cover, in words ("seven days"). */
  windowLabel: string;
  compact?: boolean;
  phrase?: PhraseOptions;
  /** Spends a banked reset; absent where nothing can (demo, workbench). */
  onUseReset?: UseAccountReset;
}) {
  const note = healthLine(account, nowMs);
  const asOf = account.health === 'unmetered' ? null : asOfPhrase(account.asOfMs, nowMs);
  const spend = account.spend;
  const resets = account.resets;
  const credits = account.credits;
  return (
    <section
      aria-label={`${account.name} usage`}
      data-usage-account={account.key}
      data-usage-health={account.health}
      className={
        compact
          ? 'flex flex-col gap-2.5 px-3 py-2.5'
          : 'flex flex-col gap-4 rounded-lg border px-5 py-4'
      }
      style={compact ? undefined : { borderColor: CHROME.border }}
    >
      <header className="flex items-baseline gap-2">
        <h2
          className={compact ? 'text-chrome-label font-semibold' : 'text-base font-semibold'}
          style={{ color: CHROME.text }}
        >
          {account.name}
        </h2>
        {account.plan && (
          <span
            className={compact ? 'text-chrome-meta' : 'text-sm'}
            style={{ color: CHROME.textDim }}
          >
            {account.plan}
          </span>
        )}
        {asOf && (
          <span
            data-usage-as-of
            className="ml-auto text-chrome-meta"
            style={{ color: CHROME.textDim }}
          >
            {asOf}
          </span>
        )}
      </header>

      {note && (
        <p
          data-usage-health-note
          className={compact ? 'text-chrome-micro' : 'text-chrome-meta'}
          style={{ color: CHROME.textDim }}
        >
          {note}
          {account.meters.length === 0 && account.observedTokens > 0
            ? ` ${tokens(account.observedTokens)} tokens in the last ${windowLabel}.`
            : ''}
        </p>
      )}

      {account.meters.length > 0 && (
        <div className={compact ? 'flex flex-col gap-2.5' : 'flex flex-col gap-4'}>
          {account.meters.map(meter => (
            <MeterRow
              key={meter.key}
              meter={meter}
              nowMs={nowMs}
              compact={compact}
              phrase={phrase}
            />
          ))}
        </div>
      )}

      {(spend || resets || credits) && (
        <div
          className={
            compact
              ? 'flex flex-col gap-1.5'
              : 'flex flex-col gap-3 border-t pt-4'
          }
          style={compact ? undefined : { borderColor: CHROME.border }}
        >
          {spend && (
            <FactRow
              data="spend"
              label="Extra usage"
              compact={compact}
              value={
                !spend.enabled
                  ? 'Off'
                  : spend.limitMinor !== null
                    ? `${planCredits(spend.usedMinor, spend)} of ${planCredits(spend.limitMinor, spend)} this month`
                    : `${planCredits(spend.usedMinor, spend)} this month`
              }
            />
          )}
          {resets && (
            <FactRow
              data="resets"
              label="Free resets"
              compact={compact}
              action={
                !compact && onUseReset && resets.canUse ? (
                  <UseResetControl account={account} onUseReset={onUseReset} />
                ) : undefined
              }
              value={
                resets.available === 0
                  ? 'None'
                  : resets.next?.expiresAtMs != null
                    ? `${resets.available} · next expires ${planResetPhrase(resets.next.expiresAtMs, nowMs, phrase)}`
                    : `${resets.available}`
              }
            />
          )}
          {credits && (
            <FactRow
              data="credits"
              label="Credits"
              compact={compact}
              value={
                credits.unlimited
                  ? 'Unlimited'
                  : credits.balance === null
                    ? 'Not reported'
                    : Math.round(credits.balance).toLocaleString('en-US')
              }
            />
          )}
        </div>
      )}
    </section>
  );
}

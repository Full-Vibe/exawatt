'use client';

/**
 * Band 1 — Headroom ("how much is left?"), and the page's one glance zone.
 *
 * The tightest live window is the verdict: one display numeral, the reset,
 * and the pace read as plain words. A viewer who reads nothing else leaves
 * with this line. Every other window — and every source that reports no
 * plan record — sits beside it as a subordinate row of the same answer.
 */
import {
  CONSUMPTION_CHROME as CHROME,
  FLUX_CSS as FLUX,
  duration,
  percent,
} from '@/components/consumption/flux';
import type { ConsumptionSourceView } from '@/components/consumption/model';
import type { WindowPace } from './derive';
import {
  Band,
  Body,
  Caption,
  Data,
  Num,
  PaceBar,
  UnreportedChannel,
  paceFill,
  paceLabel,
  verdictColor,
} from './chrome';

export function Verdict({
  paces,
  silent,
}: {
  paces: WindowPace[];
  silent: ConsumptionSourceView[];
}) {
  const [headline, ...rest] = paces;
  if (!headline) {
    // No live window anywhere — say so, and still show each source's absent
    // channel (observed raw + why) rather than a bare card (E5 empty state).
    return (
      <Band label="Headroom">
        <Caption>No source reports a live plan window.</Caption>
        {silent.length > 0 && (
          <div className="flex min-w-0 max-w-xl flex-col gap-3">
            {silent.map(s => (
              <SilentRow key={s.key} source={s} />
            ))}
          </div>
        )}
      </Band>
    );
  }
  const label = paceLabel(headline);
  return (
    <Band
      label="Headroom"
      aside={
        <Caption>
          {headline.source.label} · {headline.window.label}
        </Caption>
      }
    >
      <div className="grid items-center gap-x-8 gap-y-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Num color={paceFill(headline)}>
              {percent(headline.usedPercent)} used
            </Num>
            <Body color={verdictColor(headline)}>
              resets in {duration(headline.msToReset)} · {label.text}
            </Body>
          </div>
          <PaceBar pace={headline} height={10} />
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          {rest.map(p => (
            <WindowRow key={p.window.limitId} pace={p} />
          ))}
          {silent.map(s => (
            <SilentRow key={s.key} source={s} />
          ))}
        </div>
      </div>
    </Band>
  );
}

/** One subordinate window — same answer, smaller voice. */
function WindowRow({ pace }: { pace: WindowPace }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <Body className="truncate" color={CHROME.textDim}>
          {pace.source.label} · {pace.window.label}
        </Body>
        <Data bright>
          {percent(pace.usedPercent)} · resets in {duration(pace.msToReset)}
        </Data>
      </div>
      <PaceBar pace={pace} height={6} />
    </div>
  );
}

/** A source with no plan record — an absent channel, never 0%. */
function SilentRow({ source }: { source: ConsumptionSourceView }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <Body className="truncate" color={CHROME.textDim}>
          {source.label} · plan
        </Body>
        <Data color={FLUX.unknown}>no plan record</Data>
      </div>
      <UnreportedChannel
        observed={source.observedTokens5h}
        reason={source.unreportedReason}
        height={6}
      />
    </div>
  );
}

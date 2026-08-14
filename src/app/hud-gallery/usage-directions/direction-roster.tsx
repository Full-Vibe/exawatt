'use client';

/**
 * Direction A — ROSTER. The source roster IS the page.
 *
 * Thesis: the only place a source that reported nothing can still be seen is a
 * list that enumerates every source that COULD report. So make that list the
 * surface, give every row identical geometry, and let the headline be a
 * verdict over it rather than a number computed beside it.
 *
 * Closest prior art: CodexBar's provider popover and ManaBar's card grid —
 * the most legible, least clever shape in the corpus, and the one whose
 * failure modes are best understood.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CONSUMPTION_CHROME as CHROME,
  FLUX_CSS as FLUX,
  consumptionAlpha as withAlpha,
  duration,
  tokens,
} from '@/components/consumption/flux';
import { paceSentence } from '@/components/consumption/meter/meter-model';
import { Body, Caption, Data } from '@/app/usage/chrome';
import {
  AbsentChannel,
  AsOf,
  AttentionBlock,
  BoundLine,
  Observed,
  RateFigure,
  Repair,
  Section,
  StateWord,
  Tape,
  VendorMark,
  VerdictWord,
  WindowFigure,
} from './parts';
import type { RosterView, SourceRow } from './model';

export function RosterDirection({ view }: { view: RosterView }) {
  const [cursor, setCursor] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor(c => Math.min(view.rows.length - 1, c + 1));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor(c => Math.max(0, c - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const id = view.rows[cursor]?.id ?? null;
        setOpen(o => (o === id ? null : id));
      }
    },
    [cursor, view.rows]
  );

  useEffect(() => {
    setCursor(0);
    setOpen(null);
  }, [view.state.id]);

  const h = view.headline;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* ---- headline: verdict, then bound + coverage ---- */}
      <Section
        label="Right now"
        aside={
          <Caption>
            {view.corpus.windowDays} days · {tokens(view.corpus.samples)}{' '}
            records
          </Caption>
        }
      >
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <VerdictWord word={h.verdict.word} tone={h.verdict.tone} />
            <Body color={h.verdict.tone === 'hot' ? FLUX.hot : CHROME.text}>
              {h.verdict.because}
            </Body>
          </div>
          {h.verdict.degradedNote && (
            <Body color="var(--exa-hud-amber)">{h.verdict.degradedNote}</Body>
          )}
          {h.expiring && h.expiringSource && (
            <Body color={CHROME.textDim}>
              {h.expiringSource.account} · {h.expiring.label} —{' '}
              {paceSentence(h.expiring.read)}.
            </Body>
          )}
          <BoundLine bound={h.bound} coverage={h.coverage} scan={view.scan} />
        </div>
      </Section>

      <AttentionBlock rows={view.attention} nowMs={view.nowMs} />

      {/* ---- the roster ---- */}
      <Section
        label="Sources"
        aside={<Caption>j / k to move · Enter for detail</Caption>}
      >
        <div
          ref={ref}
          tabIndex={0}
          onKeyDown={onKey}
          className="flex min-w-0 flex-col outline-none"
          style={{ borderColor: CHROME.border }}
        >
          {view.rows.map((row, i) => (
            <RosterRow
              key={row.id}
              row={row}
              nowMs={view.nowMs}
              cursor={i === cursor}
              open={open === row.id}
              onOpen={() => {
                setCursor(i);
                setOpen(o => (o === row.id ? null : row.id));
              }}
            />
          ))}
        </div>
      </Section>
    </div>
  );
}

/**
 * One vendor account. Geometry is FIXED: identity column, window column,
 * state column — a row that cannot report keeps every one of them and swaps
 * the tape for the unreported channel and the figure for a word.
 */
function RosterRow({
  row,
  nowMs,
  cursor,
  open,
  onOpen,
}: {
  row: SourceRow;
  nowMs: number;
  cursor: boolean;
  open: boolean;
  onOpen: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={-1}
      onClick={onOpen}
      data-e12-row={row.id}
      className="grid cursor-pointer grid-cols-[minmax(0,15rem)_minmax(0,1fr)_auto] items-start gap-x-5 gap-y-2 border-t py-3 first:border-t-0"
      style={{
        borderColor: CHROME.border,
        background: cursor ? withAlpha(CHROME.text, 0.05) : 'transparent',
        boxShadow: cursor ? `inset 2px 0 0 0 ${FLUX.calm}` : 'none',
      }}
    >
      {/* identity */}
      <div className="flex min-w-0 items-start gap-2 pl-2">
        <VendorMark row={row} />
        <div className="flex min-w-0 flex-col">
          <Body className="truncate">{row.account}</Body>
          <Caption>
            {row.vendor} · {row.lane === 'plan' ? 'plan' : 'API'}
            {row.planLabel ? ` · ${row.planLabel}` : ''}
          </Caption>
          {/* Plan-level truth is stated ONCE per source, not on every window. */}
          {row.windows.some(w => w.planLevel) && (
            <Caption>meters the whole account</Caption>
          )}
        </div>
      </div>

      {/* windows, or the absent channel at the same height */}
      <div className="flex min-w-0 flex-col gap-2">
        {row.windows.length > 0 ? (
          row.windows.map(w => (
            <div key={w.key} className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <Body color={CHROME.textDim} className="truncate">
                  {w.label}
                </Body>
                <WindowFigure w={w} />
              </div>
              <Tape w={w} />
              <div className="flex flex-wrap items-baseline gap-x-3">
                <RateFigure w={w} />
                <Caption>{paceSentence(w.read)}</Caption>
              </div>
            </div>
          ))
        ) : (
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <Body color={CHROME.textDim}>
                {row.lane === 'plan' ? 'plan window' : 'metered spend'}
              </Body>
              <Data color={FLUX.unknown}>
                {row.lane === 'plan'
                  ? 'no window reported'
                  : 'no spend reported'}
              </Data>
            </div>
            <AbsentChannel />
            {row.note && <Caption>{row.note}</Caption>}
          </div>
        )}
      </div>

      {/* state + freshness */}
      <div className="flex min-w-0 flex-col items-end gap-1 pr-2">
        <StateWord row={row} />
        <AsOf row={row} nowMs={nowMs} />
        <Caption>{row.provenance}</Caption>
        {row.repair && <Repair row={row} />}
      </div>

      {open && (
        <div className="col-span-3 flex min-w-0 flex-col gap-2 px-2 pt-2">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <Observed row={row} />
            {row.spend && (
              <Data
                bright={
                  row.spend.limit !== null && row.spend.used >= row.spend.limit
                }
              >
                extra usage ${row.spend.used.toFixed(2)}
                {row.spend.limit === null
                  ? ' · no cap'
                  : ` of $${row.spend.limit.toFixed(2)}`}
                {row.spend.enabled ? '' : ' · off'}
              </Data>
            )}
            {row.statusPage && <Caption>{row.statusPage}</Caption>}
          </div>
          {row.note && row.windows.length > 0 && <Caption>{row.note}</Caption>}
          {row.windows.map(w => (
            <div
              key={`d-${w.key}`}
              className="flex flex-wrap items-baseline gap-x-4"
            >
              <Caption>{w.label}</Caption>
              <Data>
                even pace {Math.round(w.read.evenPacePercent)}% · now{' '}
                {Math.round(w.read.usedPercent)}%
              </Data>
              <Data>
                {w.ratePerHour === null
                  ? 'projection — no prior data'
                  : `→ ${Math.round(w.read.projectedPercent)}% at reset`}
              </Data>
              <Data>
                resets{' '}
                {new Date(w.read.window.resetsAtMs).toLocaleString('en-US', {
                  weekday: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </Data>
              <Data>{duration(w.read.msToReset)} left</Data>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

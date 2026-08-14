'use client';

/**
 * Direction B — LEDGER. One reconciling table, row-zero totals, drawn residuals.
 *
 * Thesis: incompleteness should be ARITHMETICALLY visible. The total is
 * computed independently of the breakdown (LiteLLM's schema rule), the parts
 * are drawn beneath it, and the gap between them is a named row rather than a
 * rounding error. Every column that qualifies a number — provenance, as-of —
 * is a column, not a tooltip.
 *
 * Closest prior art: LiteLLM's daily breakdown, Datadog's Analyze tab,
 * Screen Time's row-zero table, CloudZero's `Not In Dimension`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CONSUMPTION_CHROME as CHROME,
  FLUX_CSS as FLUX,
  consumptionAlpha as withAlpha,
  duration,
  percent,
  pressureColorCss as pressureColor,
  tokens,
} from '@/components/consumption/flux';
import { paceSentence } from '@/components/consumption/meter/meter-model';
import { Body, Caption, Data, MicroLabel } from '@/app/usage/chrome';
import {
  AsOf,
  AttentionBlock,
  BoundLine,
  Section,
  StateWord,
  Tape,
  VendorMark,
  VerdictWord,
} from './parts';
import {
  PIVOTS,
  buildLedger,
  type PivotId,
  type RosterView,
  type SourceRow,
} from './model';

export function LedgerDirection({ view }: { view: RosterView }) {
  const [pivot, setPivot] = useState<PivotId>('project');
  const [filter, setFilter] = useState('');
  const [filtering, setFiltering] = useState(false);
  const [cursor, setCursor] = useState(0);
  const filterRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const ledger = useMemo(() => buildLedger(pivot, view), [pivot, view]);
  const rows = useMemo(
    () =>
      filter
        ? ledger.rows.filter(r =>
            r.label.toLowerCase().includes(filter.toLowerCase())
          )
        : ledger.rows,
    [ledger.rows, filter]
  );

  useEffect(() => {
    setCursor(0);
  }, [pivot, filter, view.state.id]);

  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === '/') {
        e.preventDefault();
        setFiltering(true);
        window.setTimeout(() => filterRef.current?.focus(), 0);
        return;
      }
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor(c => Math.min(rows.length - 1, c + 1));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor(c => Math.max(0, c - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const i = PIVOTS.findIndex(p => p.id === pivot);
        setPivot(PIVOTS[(i + 1) % PIVOTS.length].id);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const i = PIVOTS.findIndex(p => p.id === pivot);
        setPivot(PIVOTS[(i - 1 + PIVOTS.length) % PIVOTS.length].id);
      } else if (e.key === 'Escape') {
        setFilter('');
        setFiltering(false);
        gridRef.current?.focus();
      }
    },
    [pivot, rows.length]
  );

  const h = view.headline;
  const max = Math.max(...rows.map(r => r.nt ?? 0), 1);
  const unattributed = ledger.total.nt - ledger.attributed;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* ---- headline, ledger-shaped: the verdict is row zero's caption ---- */}
      <Section label="Right now">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <VerdictWord
              word={h.verdict.word}
              tone={h.verdict.tone}
              size="section"
            />
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

      {/* ---- the source ledger: one line per account, columns not tooltips ---- */}
      <Section label="Source ledger">
        <div className="min-w-0 overflow-x-auto">
          <div className="min-w-[52rem]">
            <div
              className="grid grid-cols-[minmax(0,12rem)_minmax(0,11rem)_4.5rem_minmax(0,7rem)_5rem_minmax(0,12rem)_minmax(0,7rem)] items-center gap-x-3 border-b pb-1.5"
              style={{ borderColor: CHROME.border }}
            >
              <MicroLabel>Account</MicroLabel>
              <MicroLabel>Binding window</MicroLabel>
              <MicroLabel className="text-right">Used</MicroLabel>
              <MicroLabel>Resets</MicroLabel>
              <MicroLabel className="text-right">Rate</MicroLabel>
              <MicroLabel>As of</MicroLabel>
              <MicroLabel>Provenance</MicroLabel>
            </div>
            {view.rows.map(row => (
              <SourceLine key={row.id} row={row} nowMs={view.nowMs} />
            ))}
          </div>
        </div>
        <Caption>
          Percentages are per account and never summed — a cross-vendor headroom
          total has no unit.
        </Caption>
      </Section>

      {/* ---- the attribution ledger ---- */}
      <Section
        label="Attribution ledger"
        aside={
          <span className="flex items-center gap-2">
            {PIVOTS.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPivot(p.id)}
                aria-pressed={p.id === pivot}
                className="rounded px-2 py-0.5 text-chrome-label"
                style={{
                  color: p.id === pivot ? CHROME.text : CHROME.textDim,
                  background:
                    p.id === pivot
                      ? withAlpha(CHROME.text, 0.1)
                      : 'transparent',
                }}
              >
                {p.label}
              </button>
            ))}
          </span>
        }
      >
        <div
          ref={gridRef}
          tabIndex={0}
          onKeyDown={onKey}
          className="flex min-w-0 flex-col outline-none"
        >
          {/* row zero — the total, computed independently of the rows below */}
          <div
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,14rem)_7rem_minmax(0,8rem)_minmax(0,6rem)] items-baseline gap-x-3 border-b py-2"
            style={{ borderColor: CHROME.borderStrong }}
          >
            <Body>All sources</Body>
            <span />
            <Data bright className="text-right">
              {ledger.total.label}
            </Data>
            <Caption>{h.coverage.line}</Caption>
            <Caption>
              {ledger.total.isBound ? 'lower bound' : 'complete pass'}
            </Caption>
          </div>

          {filtering && (
            <input
              ref={filterRef}
              value={filter}
              onChange={e => setFilter(e.target.value)}
              onKeyDown={onKey}
              placeholder="filter rows"
              className="my-1 w-56 rounded border bg-transparent px-2 py-1 text-sm outline-none"
              style={{ borderColor: CHROME.border, color: CHROME.text }}
            />
          )}

          {rows.map((r, i) => (
            <div
              key={r.key}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,14rem)_7rem_minmax(0,8rem)_minmax(0,6rem)] items-center gap-x-3 border-b py-1.5"
              style={{
                borderColor: withAlpha(CHROME.border, 0.6),
                background:
                  i === cursor ? withAlpha(CHROME.text, 0.05) : 'transparent',
                boxShadow:
                  i === cursor ? `inset 2px 0 0 0 ${FLUX.calm}` : 'none',
              }}
            >
              <span className="flex min-w-0 items-center gap-2">
                {r.color && (
                  <span
                    aria-hidden
                    className="inline-block h-3 w-[3px] shrink-0 rounded-full"
                    style={{ background: r.color }}
                  />
                )}
                <Body
                  className="truncate"
                  color={r.residual ? FLUX.unknown : CHROME.text}
                >
                  {r.label}
                </Body>
              </span>
              <span className="min-w-0">
                {r.nt === null ? (
                  <span
                    aria-hidden
                    className="inline-block h-1.5 w-full rounded-[1px]"
                    style={{
                      background: `repeating-linear-gradient(-45deg, ${withAlpha(FLUX.unknown, 0.34)} 0 1px, transparent 1px 5px)`,
                      boxShadow: `inset 0 0 0 1px ${FLUX.unknownLine}`,
                    }}
                  />
                ) : (
                  <span
                    aria-hidden
                    className="inline-block h-1.5 rounded-[1px]"
                    style={{
                      width: `${Math.max(1, ((r.nt ?? 0) / max) * 100)}%`,
                      background: r.residual ? FLUX.unknown : FLUX.mid,
                    }}
                  />
                )}
              </span>
              <Data
                bright={!r.residual}
                color={r.nt === null ? FLUX.unknown : undefined}
                className="text-right"
              >
                {r.nt === null ? 'not measurable' : `${tokens(r.nt)} nt`}
              </Data>
              <Caption className="truncate">{r.meta ?? ''}</Caption>
              <Caption>{r.provenance}</Caption>
            </div>
          ))}

          {/* the reconciliation line — the gap is a rendered object, and the
              rows that carry no figure are counted rather than forgotten */}
          <div className="flex flex-wrap items-baseline gap-x-3 pt-2">
            <Caption>
              Rows sum to{' '}
              {Math.round(ledger.attributed).toLocaleString('en-US')} nt against
              a total of {Math.round(ledger.total.nt).toLocaleString('en-US')}{' '}
              nt
              {Math.abs(unattributed) < 1
                ? ' — they agree.'
                : `, a gap of ${tokens(Math.abs(unattributed))} nt.`}
            </Caption>
            <Caption>
              {rows.filter(r => r.nt === null).length} row
              {rows.filter(r => r.nt === null).length === 1 ? '' : 's'} carry no
              measurable figure and are excluded from both.
            </Caption>
          </div>
        </div>
        <Caption>← / → pivot · j / k row · / filter · esc clear</Caption>
      </Section>
    </div>
  );
}

function SourceLine({ row, nowMs }: { row: SourceRow; nowMs: number }) {
  const w = row.windows[0] ?? null;
  return (
    <div
      className="grid grid-cols-[minmax(0,12rem)_minmax(0,11rem)_4.5rem_minmax(0,7rem)_5rem_minmax(0,12rem)_minmax(0,7rem)] items-center gap-x-3 border-b py-2"
      style={{ borderColor: withAlpha(CHROME.border, 0.6) }}
    >
      <span className="flex min-w-0 items-center gap-2">
        <VendorMark row={row} />
        <Body className="truncate">{row.account}</Body>
      </span>
      {w ? (
        <span className="flex min-w-0 flex-col gap-1">
          <Body color={CHROME.textDim} className="truncate">
            {w.label}
          </Body>
          <Tape w={w} height={4} />
        </span>
      ) : (
        <span className="flex min-w-0 flex-col gap-1">
          <StateWord row={row} />
          <span
            aria-hidden
            className="inline-block h-1 w-full rounded-[1px]"
            style={{
              background: `repeating-linear-gradient(-45deg, ${withAlpha(FLUX.unknown, 0.34)} 0 1px, transparent 1px 5px)`,
            }}
          />
        </span>
      )}
      <Data
        bright
        color={w ? pressureColor(w.read.usedPercent) : FLUX.unknown}
        className="text-right"
      >
        {w ? percent(w.read.usedPercent) : '—'}
      </Data>
      <Data>{w ? `in ${duration(w.read.msToReset)}` : '—'}</Data>
      <Data className="text-right">
        {w
          ? w.ratePerHour === null
            ? '—'
            : `${w.ratePerHour.toFixed(2)}%/h`
          : '—'}
      </Data>
      <AsOf row={row} nowMs={nowMs} />
      <Caption>{row.provenance}</Caption>
    </div>
  );
}

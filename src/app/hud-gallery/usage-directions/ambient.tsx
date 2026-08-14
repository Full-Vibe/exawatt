'use client';

/**
 * The ambient projection of each direction — the title-bar mark, at size.
 *
 * All three read `ambientProjection(view)`, which is the SAME rows in the
 * SAME order with columns dropped. None of them computes a summary, so none
 * of them can lose a source the page still shows. Every glance/detail
 * divergence in the E12 corpus (ccusage, AIQuotaBar, Codex Ratelimit,
 * CodexBar #2707) happened at exactly the cast this file refuses to make.
 */
import {
  CONSUMPTION_CHROME as CHROME,
  FLUX_CSS as FLUX,
  consumptionAlpha as withAlpha,
  percent,
  pressureColorCss as pressureColor,
  tokens,
} from '@/components/consumption/flux';
import { Caption, Data } from '@/app/usage/chrome';
import { ambientProjection, type AmbientCell, type RosterView } from './model';

const H = 28;

function cellColor(cell: AmbientCell): string {
  if (cell.usedPercent === null) return FLUX.unknown;
  return cell.hot ? FLUX.hot : pressureColor(cell.usedPercent);
}

function Chrome({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded px-2"
      style={{
        height: H,
        background: withAlpha(CHROME.text, 0.06),
        boxShadow: `inset 0 0 0 1px ${CHROME.border}`,
      }}
    >
      {children}
    </span>
  );
}

/** A — the roster, miniaturized: one mini tape per source, order preserved. */
export function AmbientRoster({ view }: { view: RosterView }) {
  const a = ambientProjection(view);
  return (
    <Chrome>
      {a.cells.map(cell => (
        <span
          key={cell.id}
          className="inline-flex flex-col items-center gap-0.5"
          title={cell.short}
        >
          <span
            aria-hidden
            className="inline-block w-6 rounded-[1px]"
            style={{
              height: 4,
              background:
                cell.usedPercent === null
                  ? `repeating-linear-gradient(-45deg, ${withAlpha(FLUX.unknown, 0.5)} 0 1px, transparent 1px 4px)`
                  : withAlpha(CHROME.text, 0.14),
              boxShadow: `inset 0 0 0 1px ${withAlpha(CHROME.text, 0.16)}`,
              position: 'relative',
            }}
          >
            {cell.usedPercent !== null && (
              <span
                className="absolute left-0 top-0 h-full rounded-[1px]"
                style={{
                  width: `${cell.usedPercent}%`,
                  background: cellColor(cell),
                }}
              />
            )}
          </span>
          {/* A figure carried over from a failed read must not look fresh —
              the whole corpus failure class is a stale number wearing a fresh
              face. One pip, in the attention role, on the cell itself. */}
          <span
            className="font-mono text-chrome-nano tracking-[0.08em]"
            style={{
              color:
                cell.state === 'unreadable'
                  ? 'var(--exa-hud-amber)'
                  : cell.usedPercent === null
                    ? FLUX.unknown
                    : CHROME.textDim,
            }}
          >
            {cell.state === 'unreadable' ? '·' : ''}
            {cell.short}
          </span>
        </span>
      ))}
      <span
        aria-hidden
        className="inline-block h-4 w-px"
        style={{ background: withAlpha(CHROME.text, 0.18) }}
      />
      <Data color={a.tone === 'hot' ? FLUX.hot : CHROME.text}>
        {a.coverage}
      </Data>
    </Chrome>
  );
}

/** B — row zero, miniaturized: the bound and its coverage, nothing else. */
export function AmbientLedger({ view }: { view: RosterView }) {
  const a = ambientProjection(view);
  const h = view.headline;
  return (
    <Chrome>
      <Data color={a.tone === 'hot' ? FLUX.hot : CHROME.text}>
        {h.bound.isBound ? '≥ ' : ''}
        {tokens(h.bound.value)} nt
      </Data>
      <span
        aria-hidden
        className="inline-block h-4 w-px"
        style={{ background: withAlpha(CHROME.text, 0.18) }}
      />
      <Data>{a.coverage} sources</Data>
      {h.binding && (
        <>
          <span
            aria-hidden
            className="inline-block h-4 w-px"
            style={{ background: withAlpha(CHROME.text, 0.18) }}
          />
          <Data color={pressureColor(h.binding.read.usedPercent)}>
            {percent(h.binding.read.usedPercent)}{' '}
            {h.binding.label.toLowerCase()}
          </Data>
        </>
      )}
    </Chrome>
  );
}

/** C — the verdict word and one scale. The instrument, at 28px. */
export function AmbientInstrument({ view }: { view: RosterView }) {
  const a = ambientProjection(view);
  const binding = view.headline.binding;
  // Only a source that SHOULD be reporting counts as unread. A settled
  // "not available for this account" is not something waiting to be fetched.
  const missing = a.cells.filter(
    c =>
      c.state === 'unreadable' || c.state === 'stale' || c.state === 'reading'
  ).length;
  return (
    <Chrome>
      <Data
        color={
          a.tone === 'hot'
            ? FLUX.hot
            : a.tone === 'unknown'
              ? FLUX.unknown
              : CHROME.text
        }
      >
        {a.word}
      </Data>
      <span
        aria-hidden
        className="relative inline-block w-16 rounded-[1px]"
        style={{
          height: 6,
          background: withAlpha(CHROME.text, 0.14),
          boxShadow: `inset 0 0 0 1px ${withAlpha(CHROME.text, 0.16)}`,
        }}
      >
        {binding && (
          <span
            className="absolute left-0 top-0 h-full rounded-[1px]"
            style={{
              width: `${Math.min(100, binding.read.usedPercent)}%`,
              background: pressureColor(binding.read.usedPercent),
            }}
          />
        )}
        {binding && (
          <span
            className="absolute top-[-2px]"
            style={{
              left: `calc(${Math.min(100, binding.read.evenPacePercent)}% - 1px)`,
              width: 1.5,
              height: 10,
              background: withAlpha(CHROME.text, 0.85),
            }}
          />
        )}
      </span>
      {missing > 0 && <Data color={FLUX.unknown}>{missing} unread</Data>}
    </Chrome>
  );
}

export function AmbientRow({ view }: { view: RosterView }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <span className="flex items-center gap-2">
        <Caption>A</Caption>
        <AmbientRoster view={view} />
      </span>
      <span className="flex items-center gap-2">
        <Caption>B</Caption>
        <AmbientLedger view={view} />
      </span>
      <span className="flex items-center gap-2">
        <Caption>C</Caption>
        <AmbientInstrument view={view} />
      </span>
    </div>
  );
}

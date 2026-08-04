'use client';

/**
 * The drill-down floor, part 1 — attribution ("where is it going?").
 *
 * One pivot — Project / Session / Model / Source / Roadmap item — over the
 * same rollups, normalized by default with a raw-units mode. Every bar is a
 * door: selecting it opens the sessions behind it in the shared drill panel.
 * Controls are neutral chrome; only the bars carry consumption color.
 */
import { useMemo, type CSSProperties } from 'react';
import {
  CONSUMPTION_CHROME as CHROME,
  FLUX_CSS as FLUX,
  consumptionAlpha as withAlpha,
  tokens,
} from '@/components/consumption/flux';
// The printed basis MUST be the arithmetic's own basis: figures here are
// weighted by `@exawatt/core`'s model-weight table, so the sentence is
// stated from core's constants (units.ts), never a parallel ratio table.
import { NORMALIZED_BASIS_SENTENCE } from '@/components/consumption/units';
import { UnitStack, UnitLegend } from '@/components/consumption/atoms';
import { rawTotal } from '@/components/consumption/model';
import { PIVOT_LABEL, type PivotKey, type PivotRow } from './derive';
import { Band, Body, Data } from './chrome';

const PIVOTS: PivotKey[] = ['project', 'session', 'model', 'source', 'roadmap'];

export type UnitMode = 'normalized' | 'raw';

/** One neutral chip recipe for every control on the floor. */
function chipStyle(active: boolean): CSSProperties {
  return {
    borderColor: active ? CHROME.borderStrong : CHROME.border,
    color: active ? CHROME.text : CHROME.textDim,
    background: active ? 'var(--exa-hud-fill)' : 'transparent',
  };
}

const CHIP =
  'rounded border px-2 py-0.5 text-sm outline-none transition-colors hover:bg-[var(--exa-hud-fill)] focus-visible:ring-1 focus-visible:ring-[var(--exa-foundation-focus)]';

export function Attribution({
  rows,
  pivot,
  onPivot,
  mode,
  onMode,
  selectedId,
  onSelect,
}: {
  rows: PivotRow[];
  pivot: PivotKey;
  onPivot: (k: PivotKey) => void;
  mode: UnitMode;
  onMode: (m: UnitMode) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  // Raw mode is a real reordering, not a re-skin: rows sort by raw total and
  // bars scale to the raw max, so what reads biggest IS biggest in raw units.
  const ordered = useMemo(
    () =>
      mode === 'raw'
        ? [...rows].sort((a, b) => rawTotal(b.usage) - rawTotal(a.usage))
        : rows,
    [rows, mode]
  );
  const max =
    mode === 'raw'
      ? (ordered[0] ? rawTotal(ordered[0].usage) : 1)
      : (ordered[0]?.weighted ?? 1);
  const overflow = ordered.slice(9);
  return (
    <Band
      label="Attribution"
      aside={
        <span className="flex items-center gap-1.5">
          {(['normalized', 'raw'] as const).map(m => (
            <button
              key={m}
              type="button"
              aria-pressed={m === mode}
              onClick={() => onMode(m)}
              title={m === 'normalized' ? NORMALIZED_BASIS_SENTENCE : undefined}
              className={CHIP}
              style={chipStyle(m === mode)}
            >
              {m === 'raw' ? 'raw tokens' : 'normalized'}
            </button>
          ))}
        </span>
      }
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {PIVOTS.map(k => (
          <button
            key={k}
            type="button"
            aria-pressed={k === pivot}
            onClick={() => onPivot(k)}
            className={CHIP}
            style={chipStyle(k === pivot)}
          >
            {PIVOT_LABEL[k]}
          </button>
        ))}
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        {ordered.slice(0, 9).map(r => (
          <PivotBarRow
            key={r.id}
            row={r}
            max={max}
            mode={mode}
            selected={r.id === selectedId}
            onSelect={() => onSelect(r.id)}
          />
        ))}
        {overflow.length > 0 && (
          <p className="px-1 pt-1">
            <Data>
              {overflow.length} more ·{' '}
              {mode === 'raw'
                ? `${tokens(overflow.reduce((n, r) => n + rawTotal(r.usage), 0))} raw`
                : `${tokens(overflow.reduce((n, r) => n + r.weighted, 0))} nt`}
            </Data>
          </p>
        )}
        {mode === 'raw' && (
          <div className="pt-2">
            <UnitLegend compact />
          </div>
        )}
      </div>
    </Band>
  );
}

/** One pivot row — a door. */
function PivotBarRow({
  row,
  max,
  mode,
  selected,
  onSelect,
}: {
  row: PivotRow;
  max: number;
  mode: UnitMode;
  selected: boolean;
  onSelect: () => void;
}) {
  const value = mode === 'raw' ? rawTotal(row.usage) : row.weighted;
  const share = value / Math.max(1, max);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className="grid grid-cols-[minmax(120px,200px)_1fr_76px] items-center gap-3 rounded px-1.5 py-1 text-left outline-none transition-colors hover:bg-[var(--exa-hud-fill)] focus-visible:ring-1 focus-visible:ring-[var(--exa-foundation-focus)]"
      style={{
        background: selected ? 'var(--exa-hud-fill)' : undefined,
        boxShadow: selected ? `inset 0 0 0 1px ${CHROME.borderStrong}` : undefined,
      }}
    >
      <span className="flex min-w-0 items-center gap-2">
        {row.identity && (
          <span
            aria-hidden
            className="h-3.5 w-0.5 shrink-0 rounded-full"
            style={{ background: row.identity }}
          />
        )}
        <Body
          className="truncate"
          color={row.unknown ? FLUX.unknown : CHROME.text}
        >
          {row.label}
        </Body>
      </span>
      <span className="min-w-0">
        {mode === 'raw' ? (
          <UnitStack
            usage={row.usage}
            width="100%"
            height={7}
            scaleTo={max}
            dim={row.unknown}
          />
        ) : (
          <span
            aria-hidden
            className="block h-[7px] w-full rounded-[1px]"
            style={{ background: FLUX.track }}
          >
            <span
              className="block h-full rounded-[1px]"
              style={{
                width: `${Math.max(1.5, share * 100)}%`,
                background: row.unknown ? FLUX.unknown : FLUX.mid,
                boxShadow: row.unknown
                  ? 'none'
                  : `0 0 6px ${withAlpha(FLUX.mid, 0.4)}`,
              }}
            />
          </span>
        )}
      </span>
      <Data className="text-right">
        {tokens(value)}
        {mode === 'raw' ? '' : ' nt'}
      </Data>
    </button>
  );
}

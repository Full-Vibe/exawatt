'use client';

/**
 * Band: attribution ("where is it going?").
 *
 * One pivot — Project / Session / Model / Source / Roadmap item — over the
 * same rollups, normalized by default with a raw-units mode. Every bar is a
 * door: selecting it opens the sessions behind it in the shared drill panel.
 */
import { HUD, withAlpha } from '@/components/hud';
import {
  FLUX,
  WEIGHT_BASIS_SENTENCE,
  tokens,
} from '@/components/consumption/flux';
import { UnitStack, UnitLegend } from '@/components/consumption/atoms';
import { rawTotal } from '@/components/consumption/model';
import { PIVOT_LABEL, type PivotKey, type PivotRow } from './derive';
import { Card, MicroLabel } from './chrome';

const PIVOTS: PivotKey[] = ['project', 'session', 'model', 'source', 'roadmap'];

export type UnitMode = 'normalized' | 'raw';

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
  return (
    <Card label="Attribution" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <MicroLabel>Group by</MicroLabel>
          {PIVOTS.map(k => (
            <button
              key={k}
              type="button"
              aria-pressed={k === pivot}
              onClick={() => onPivot(k)}
              className="rounded border px-2 py-0.5 text-chrome-label outline-none transition-colors hover:bg-white/10 focus-visible:ring-1 focus-visible:ring-hud-cyan"
              style={{
                borderColor:
                  k === pivot ? withAlpha(FLUX.mid, 0.7) : 'rgba(150,120,255,0.2)',
                color: k === pivot ? HUD.text : HUD.textDim,
                background: k === pivot ? withAlpha(FLUX.mid, 0.12) : 'transparent',
              }}
            >
              {PIVOT_LABEL[k]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          {(['normalized', 'raw'] as const).map(m => (
            <button
              key={m}
              type="button"
              aria-pressed={m === mode}
              onClick={() => onMode(m)}
              title={m === 'normalized' ? WEIGHT_BASIS_SENTENCE : undefined}
              className="rounded border px-2 py-0.5 font-mono text-chrome-micro outline-none transition-colors hover:bg-white/10 focus-visible:ring-1 focus-visible:ring-hud-cyan"
              style={{
                borderColor:
                  m === mode ? withAlpha(FLUX.mid, 0.7) : 'rgba(150,120,255,0.2)',
                color: m === mode ? HUD.text : HUD.textDim,
              }}
            >
              {m === 'raw' ? 'raw tokens' : 'normalized'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        {rows.slice(0, 9).map(r => (
          <PivotBarRow
            key={r.id}
            row={r}
            max={rows[0]?.weighted ?? 1}
            mode={mode}
            selected={r.id === selectedId}
            onSelect={() => onSelect(r.id)}
          />
        ))}
        {rows.length > 9 && (
          <p
            className="px-1 pt-1 font-mono text-chrome-meta"
            style={{ color: HUD.textDim }}
          >
            {rows.length - 9} more ·{' '}
            {tokens(rows.slice(9).reduce((n, r) => n + r.weighted, 0))} nt
          </p>
        )}
        {mode === 'raw' && (
          <div className="pt-2">
            <UnitLegend compact />
          </div>
        )}
      </div>
    </Card>
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
  const share = row.weighted / Math.max(1, max);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className="grid grid-cols-[minmax(120px,200px)_1fr_76px] items-center gap-3 rounded px-1.5 py-1 text-left outline-none transition-colors hover:bg-white/[0.05] focus-visible:ring-1 focus-visible:ring-hud-cyan"
      style={{
        background: selected ? withAlpha(FLUX.mid, 0.1) : undefined,
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
        <span
          className="truncate text-chrome-label"
          style={{ color: row.unknown ? FLUX.unknown : HUD.text }}
        >
          {row.label}
        </span>
      </span>
      <span className="min-w-0">
        {mode === 'raw' ? (
          <UnitStack
            usage={row.usage}
            width="100%"
            height={7}
            scaleTo={undefined}
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
      <span
        className="text-right font-mono text-chrome-meta tabular-nums"
        style={{ color: HUD.textDim }}
      >
        {tokens(mode === 'raw' ? rawTotal(row.usage) : row.weighted)}
        {mode === 'raw' ? '' : ' nt'}
      </span>
    </button>
  );
}

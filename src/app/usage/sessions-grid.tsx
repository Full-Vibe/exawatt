'use client';

/**
 * The drill-down floor, part 2 — the session grid ("what did each run
 * cost?"). Every operator session is a row — inline burn sparkline, raw and
 * normalized figures, impact bar, intervention count. Rows are doors into
 * the same drill panel the attribution bars open. Provider sessions outside
 * the fleet record render with measured figures and honestly absent
 * identity; the grid folds beyond a cap so Voltaic's fortnight stays
 * comfortable.
 */
import {
  CONSUMPTION_CHROME as CHROME,
  FLUX_CSS as FLUX,
  duration,
  tokens,
} from '@/components/consumption/flux';
import { Sparkline } from '@/components/consumption/atoms';
import { STATUS_LIGHT_META } from '@/components/status-light/protocol';
import type { GridRow } from './derive';
import { Body, Caption, Card, Data, MicroLabel } from './chrome';

const ROW_CAP = 14;

const COLS =
  'grid-cols-[minmax(0,1.6fr)_116px_92px_76px_76px_minmax(64px,0.6fr)_40px]';

/**
 * "Live" is agent-activity state, not burn intensity: it renders in the
 * status protocol's Active blue, never in FLUX magenta — on this surface
 * the consumption ramp must only ever mean burn (channel-ownership rule).
 */
const LIVE = STATUS_LIGHT_META.active.color;

export function SessionsGrid({
  rows,
  nowMs,
  selectedId,
  onSelect,
  expanded,
  onToggleExpanded,
}: {
  rows: GridRow[];
  nowMs: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const visible = expanded ? rows : rows.slice(0, ROW_CAP);
  const hidden = rows.slice(ROW_CAP);
  const maxWeighted = rows[0]?.weighted ?? 1;
  const codexBlind = rows.some(r => r.source === 'codex');
  // A column of em-dashes is a blank, not a fact. When NO row in scope
  // carries a count, the legend says why instead of leaving the reader to
  // infer that every session ran untouched.
  const noInterventions =
    rows.length > 0 && rows.every(r => r.interventions === null);

  return (
    <Card label="Sessions" className="flex min-w-0 flex-col p-0">
      {/* gap-3 keeps the right-aligned NORM figure clear of the left-aligned
          IMPACT header — at gap-2 the two tracked micro-labels read as one */}
      <div
        className={`grid ${COLS} items-center gap-3 border-b px-3 py-1.5`}
        style={{ borderColor: CHROME.border }}
      >
        <MicroLabel>Session</MicroLabel>
        <MicroLabel>Src / model</MicroLabel>
        <MicroLabel>Burn</MicroLabel>
        <MicroLabel className="text-right">Raw</MicroLabel>
        <MicroLabel className="text-right">Norm</MicroLabel>
        <MicroLabel>Impact</MicroLabel>
        <MicroLabel className="text-right">Int</MicroLabel>
      </div>
      {visible.map(r => (
        <SessionRow
          key={r.id}
          row={r}
          nowMs={nowMs}
          maxWeighted={maxWeighted}
          selected={r.id === selectedId}
          onSelect={() => onSelect(r.id)}
        />
      ))}
      {rows.length === 0 && (
        <div className="px-3 py-3">
          <Caption>No sessions in this window</Caption>
        </div>
      )}
      {hidden.length > 0 && (
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          className="w-full border-t px-3 py-1.5 text-left outline-none transition-colors hover:bg-[var(--exa-hud-fill)] focus-visible:ring-1 focus-visible:ring-[var(--exa-foundation-focus)]"
          style={{ borderColor: CHROME.border }}
        >
          <Data>
            {expanded
              ? 'Show fewer'
              : `Show all ${rows.length} sessions · ${hidden.length} more · ${tokens(
                  hidden.reduce((n, r) => n + r.weighted, 0)
                )} nt`}
          </Data>
        </button>
      )}
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-3 py-1.5"
        style={{ borderColor: CHROME.border }}
      >
        <Caption>norm = normalized tokens, stated ratio basis</Caption>
        <Caption>impact = normalized burn relative to the largest session</Caption>
        <Caption>int = operator messages after launch</Caption>
        {noInterventions && (
          <span className="text-chrome-meta" style={{ color: FLUX.unknown }}>
            Interventions: not recorded
          </span>
        )}
        {codexBlind && (
          <span className="text-chrome-meta" style={{ color: FLUX.unknown }}>
            Codex per-agent delegation: not recorded
          </span>
        )}
      </div>
    </Card>
  );
}

function SessionRow({
  row: r,
  nowMs,
  maxWeighted,
  selected,
  onSelect,
}: {
  row: GridRow;
  nowMs: number;
  maxWeighted: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const share = r.weighted / Math.max(1, maxWeighted);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`grid ${COLS} w-full items-center gap-3 border-b px-3 py-1 text-left outline-none transition-colors last:border-b-0 hover:bg-[var(--exa-hud-fill)] focus-visible:ring-1 focus-visible:ring-[var(--exa-foundation-focus)]`}
      style={{
        borderColor: CHROME.border,
        background: selected ? 'var(--exa-hud-fill)' : undefined,
        boxShadow: selected
          ? `inset 0 0 0 1px ${CHROME.borderStrong}`
          : undefined,
      }}
    >
      <span className="flex min-w-0 items-baseline gap-1.5">
        {r.identityColor && (
          <span
            aria-hidden
            className="h-3 w-0.5 shrink-0 self-center rounded-full"
            style={{ background: r.identityColor }}
          />
        )}
        <Body
          className="truncate"
          color={r.identified ? CHROME.text : FLUX.unknown}
        >
          <span
            title={
              r.identified
                ? undefined
                : 'outside the fleet record — measured from local logs, no session identity'
            }
          >
            {r.title}
          </span>
        </Body>
        {r.live ? (
          <Data className="shrink-0" color={LIVE}>
            live
          </Data>
        ) : (
          <Data className="shrink-0">-{duration(nowMs - r.lastAtMs)}</Data>
        )}
        {r.agents !== null && r.agents > 0 && (
          <Data className="shrink-0">
            <span title={`${r.agents} delegated agents booked to this session`}>
              +{r.agents}
            </span>
          </Data>
        )}
      </span>
      <Data className="truncate">
        {r.source === 'codex' ? 'codex' : 'claude'}
        {r.model ? ` · ${r.model.replace(/^claude-|^gpt-/, '')}` : ''}
      </Data>
      {/* the sparkline is burn, so it stays in the FLUX channel regardless
          of liveness */}
      <Sparkline values={r.spark} width={84} height={14} color={FLUX.mid} />
      <Data className="text-right">{tokens(r.raw)}</Data>
      <Data bright className="text-right">
        {tokens(r.weighted)}
      </Data>
      <span
        aria-hidden
        className="inline-block h-[7px] w-full rounded-[1px]"
        style={{ background: FLUX.track }}
      >
        <span
          className="block h-full rounded-[1px]"
          style={{
            width: `${Math.max(2, share * 100)}%`,
            background: FLUX.calm,
          }}
        />
      </span>
      {r.interventions === null ? (
        <Data className="text-right" color={FLUX.unknown}>
          {/* two different absences, and they used to share one sentence:
              an identified Session HAS a record, its interventions are just
              not on the snapshot yet */}
          <span
            title={
              r.identified
                ? 'not recorded — the live read carries no intervention counts yet'
                : 'no session record for this id'
            }
          >
            —
          </span>
        </Data>
      ) : (
        <Data className="text-right">{r.interventions}</Data>
      )}
    </button>
  );
}

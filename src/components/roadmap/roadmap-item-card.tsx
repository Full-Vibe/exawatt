// No 'use client': only imported by the client workspace surface.

/**
 * One station on the roadmap feed line. Information resolution falls off
 * with distance from now: the now station renders as a hero card, other
 * unfinished items as mid-density rows, shipped/parked as compact rows.
 * Read-only by design: the only affordance is drill (Enter/→/click).
 */
import { CornerBrackets } from '@/components/hud';
import {
  WORKSPACE_HUD as HUD,
  withThemeAlpha as withAlpha,
} from '@/components/workspace/workspace-theme';
import type { RoadmapItemView } from '@exawatt/ui-model';
import {
  ROADMAP_STATUS_COLOR,
  RoadmapBlockedBadge,
  RoadmapStatusPill,
} from './roadmap-status-pill';
import {
  cleanMilestoneTitle,
  milestoneFractionSentence,
  statusNoteProse,
} from './roadmap-format';

export type RoadmapCardVariant = 'hero' | 'row' | 'compact';

/** spine node: the station marker on the feed line */
export function SpineNode({
  color,
  variant,
}: {
  color: string;
  variant: 'active' | 'open' | 'done' | 'dim';
}) {
  const size = variant === 'active' ? 10 : 7;
  return (
    <span
      aria-hidden
      className="absolute top-1/2 shrink-0 -translate-y-1/2 rounded-full"
      style={{
        left: 12 - size / 2,
        width: size,
        height: size,
        background:
          variant === 'active' || variant === 'done' ? color : 'transparent',
        border: `1.5px solid ${color}`,
        boxShadow: variant === 'active' ? `0 0 8px ${color}` : 'none',
        opacity: variant === 'dim' ? 0.55 : 1,
      }}
    />
  );
}

export function RoadmapItemCard({
  item,
  variant,
  selected,
  onDrill,
  onHover,
}: {
  item: RoadmapItemView;
  variant: RoadmapCardVariant;
  selected: boolean;
  onDrill: () => void;
  onHover?: () => void;
}) {
  const statusColor = ROADMAP_STATUS_COLOR[item.displayStatus];
  const nodeVariant =
    item.status === 'shipped'
      ? 'done'
      : item.isNowStation
        ? 'active'
        : item.status === 'later' || item.status === 'parked'
          ? 'dim'
          : 'open';

  if (variant === 'hero') {
    const nextMilestone = item.milestones.find(m => !m.done && !m.retired);
    const pct =
      item.milestonesTotal > 0
        ? Math.round((item.milestonesDone / item.milestonesTotal) * 100)
        : null;
    return (
      <button
        type="button"
        tabIndex={-1}
        data-roadmap-row={item.id}
        data-selected={selected || undefined}
        onClick={onDrill}
        onMouseEnter={onHover}
        className="relative w-full cursor-default pl-6 pr-2 text-left outline-none"
      >
        <SpineNode color={statusColor} variant={nodeVariant} />
        <div
          className="relative flex flex-col gap-1.5 rounded border p-3"
          style={{
            borderColor: selected
              ? withAlpha(statusColor, 0.75)
              : withAlpha(statusColor, 0.35),
            background: HUD.bg.panelFill,
            boxShadow: selected ? `0 0 14px ${withAlpha(statusColor, 0.33)}` : 'none',
          }}
        >
          {selected && <CornerBrackets color={HUD.cyan} tone="cyan" active />}
          <div className="flex items-center gap-2">
            <RoadmapStatusPill status={item.displayStatus} />
            {item.blocked && <RoadmapBlockedBadge />}
            {item.declaredId && (
              <span className="font-mono text-xs" style={{ color: HUD.textMono }}>
                {item.declaredId}
              </span>
            )}
            {item.milestonesTotal > 0 && (
              <span
                className="ml-auto font-mono text-chrome-micro"
                title={`${milestoneFractionSentence(item.milestonesDone, item.milestonesTotal)} milestones`}
                style={{ color: HUD.textDim }}
              >
                {item.milestonesDone}/{item.milestonesTotal}
              </span>
            )}
          </div>
          <p
            className="line-clamp-2 font-display text-sm font-semibold leading-5"
            style={{ color: HUD.text }}
          >
            {item.title}
          </p>
          {pct !== null && (
            <div
              aria-hidden
              className="h-[3px] w-full overflow-hidden rounded-full"
              style={{ background: HUD.divider }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${pct}%`,
                  background: item.blocked ? HUD.amber : HUD.green,
                }}
              />
            </div>
          )}
          {/* the blocker is more actionable than the next milestone */}
          {item.blocked && statusNoteProse(item.statusNote) ? (
            <p
              className="line-clamp-2 font-ui text-chrome-label"
              style={{ color: HUD.amber }}
            >
              Blocked — {statusNoteProse(item.statusNote)}
            </p>
          ) : nextMilestone ? (
            <p className="truncate font-ui text-chrome-meta" style={{ color: HUD.textDim }}>
              Next up:{' '}
              <span style={{ color: HUD.text }}>
                {cleanMilestoneTitle(nextMilestone.title)}
              </span>
            </p>
          ) : null}
        </div>
      </button>
    );
  }

  const compact = variant === 'compact';
  return (
    <button
      type="button"
      tabIndex={-1}
      data-roadmap-row={item.id}
      data-selected={selected || undefined}
      onClick={onDrill}
      onMouseEnter={onHover}
      className="relative flex w-full cursor-default items-center gap-2 py-1 pl-6 pr-2 text-left outline-none"
      style={{
        minHeight: compact ? 28 : 40,
        background: selected ? HUD.fillHi : 'transparent',
        opacity: compact || item.status === 'later' ? 0.75 : 1,
      }}
    >
      <SpineNode color={statusColor} variant={nodeVariant} />
      {item.declaredId && (
        <span
          className="shrink-0 font-mono text-chrome-meta"
          style={{ color: compact ? withAlpha(HUD.textMono, 0.7) : HUD.textMono }}
        >
          {item.declaredId}
        </span>
      )}
      <span
        className={`min-w-0 truncate text-xs leading-4 ${compact ? '' : 'font-medium'}`}
        style={{ color: compact ? HUD.textDim : HUD.text }}
      >
        {item.title}
      </span>
      {item.blocked && <RoadmapBlockedBadge />}
      {item.hasWarnings && (
        <span
          title="parts of this item did not parse"
          className="shrink-0 font-mono text-chrome-micro"
          style={{ color: HUD.amber }}
        >
          !
        </span>
      )}
      {item.chips.length > 0 && (
        <span
          title={`${item.chips.length} linked session${item.chips.length === 1 ? '' : 's'}`}
          className="shrink-0 font-mono text-chrome-micro"
          style={{ color: statusColor }}
        >
          ▸{item.chips.length}
        </span>
      )}
      {item.milestonesTotal > 0 && (
        <span
          className="ml-auto shrink-0 font-mono text-chrome-micro"
          style={{ color: compact ? withAlpha(HUD.textDim, 0.7) : HUD.textDim }}
        >
          {item.milestonesDone}/{item.milestonesTotal}
        </span>
      )}
    </button>
  );
}

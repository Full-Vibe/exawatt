// No 'use client': only imported by the client workspace surface.

/**
 * R1 drill panel for one roadmap item: status note, scope, exit criteria,
 * milestone spine, description, and the doc chips that are the lens's only
 * edit path (open the file — Exawatt never writes the roadmap).
 */
import { HUD, withAlpha } from '@/components/hud';
import type { RoadmapItemView } from '@exawatt/ui-model';
import {
  ROADMAP_STATUS_COLOR,
  RoadmapBlockedBadge,
  RoadmapStatusPill,
} from './roadmap-status-pill';
import { RoadmapSessionChipButton } from './roadmap-session-chip';
import {
  cleanMilestoneTitle,
  milestoneFractionSentence,
  statusNoteProse,
} from './roadmap-format';

/** roadmap prose is markdown; the rail renders it as plain text, so strip
 *  the inline tokens that would otherwise show literally */
function deMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="font-ui text-[11px] font-medium" style={{ color: HUD.textDim }}>
      {children}
    </p>
  );
}

function BulletList({ lines }: { lines: string[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {lines.map((line, i) => (
        <li
          key={i}
          className="flex gap-1.5 text-xs leading-5"
          style={{ color: HUD.text }}
        >
          <span aria-hidden className="shrink-0" style={{ color: HUD.textDim }}>
            ·
          </span>
          <span className="min-w-0">{deMarkdown(line)}</span>
        </li>
      ))}
    </ul>
  );
}

export function RoadmapItemDetail({
  item,
  color,
  selectedMilestone = null,
  onOpenPath,
  onSelectSession,
}: {
  item: RoadmapItemView;
  /** the Project identity color for session chips */
  color: string;
  /** roved milestone index (S7 R2 keyboard level); null = no roving */
  selectedMilestone?: number | null;
  /** open a repo-relative path in the OS default app */
  onOpenPath: (path: string) => void;
  onSelectSession: (tabId: string) => void;
}) {
  const statusColor = ROADMAP_STATUS_COLOR[item.displayStatus];
  return (
    <div className="flex flex-col gap-3 px-3 pb-3">
      <div className="flex flex-wrap items-center gap-2">
        <RoadmapStatusPill status={item.displayStatus} />
        {item.blocked && <RoadmapBlockedBadge />}
        {item.declaredId && (
          <span className="font-mono text-xs" style={{ color: HUD.textMono }}>
            {item.declaredId}
          </span>
        )}
      </div>
      <p
        className="font-display text-sm font-semibold leading-5"
        style={{ color: HUD.text }}
      >
        {item.title}
      </p>
      {statusNoteProse(item.statusNote) && (
        <p className="text-xs leading-5" style={{ color: HUD.textDim }}>
          {deMarkdown(statusNoteProse(item.statusNote) as string)}
        </p>
      )}
      {item.chips.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Sessions</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {item.chips.map(chip => (
              <RoadmapSessionChipButton
                key={chip.sessionId}
                chip={chip}
                color={color}
                selected={false}
                onJump={() => chip.tabId && onSelectSession(chip.tabId)}
              />
            ))}
          </div>
        </div>
      )}
      {item.scope.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Scope</SectionLabel>
          <BulletList lines={item.scope} />
        </div>
      )}
      {item.exitCriteria.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Exit criteria</SectionLabel>
          <BulletList lines={item.exitCriteria} />
        </div>
      )}
      {item.milestones.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel>{`Milestones · ${milestoneFractionSentence(item.milestonesDone, item.milestonesTotal)}`}</SectionLabel>
          <ul className="flex flex-col">
            {item.milestones.map((m, i) => {
              const roved = selectedMilestone === i;
              return (
                <li
                  key={i}
                  data-roadmap-milestone={i}
                  data-selected={roved || undefined}
                  ref={
                    roved
                      ? el => {
                          // roving implies rail focus; the guard keeps a
                          // background re-render from scrolling the page
                          if (
                            el
                              ?.closest('[data-roadmap-rail]')
                              ?.contains(document.activeElement)
                          ) {
                            el.scrollIntoView({ block: 'nearest' });
                          }
                        }
                      : undefined
                  }
                  className="relative flex gap-2 rounded py-1 pl-6 pr-1"
                  style={{ background: roved ? HUD.fillHi : 'transparent' }}
                >
                  {/* a checkmark you can read: done ✓, open hollow,
                      retired dashed + struck out below */}
                  <span
                    aria-hidden
                    className="absolute left-0.5 top-[5px] grid h-[14px] w-[14px] place-items-center rounded-full text-[9px] font-bold"
                    style={
                      m.done
                        ? { background: HUD.green, color: '#08120b' }
                        : {
                            border: m.retired
                              ? `1.5px dashed ${withAlpha(HUD.textDim, 0.6)}`
                              : `1.5px solid ${withAlpha(statusColor, 0.6)}`,
                            color: 'transparent',
                          }
                    }
                  >
                    ✓
                  </span>
                  {m.id && (
                    <span
                      className="shrink-0 font-mono text-[11px] leading-5"
                      style={{
                        color: m.done || m.retired ? HUD.textDim : HUD.textMono,
                        textDecoration: m.retired ? 'line-through' : undefined,
                      }}
                    >
                      {m.id}
                    </span>
                  )}
                  <span
                    className="min-w-0 text-xs leading-5"
                    style={{
                      color: m.done || m.retired ? HUD.textDim : HUD.text,
                      textDecoration: m.retired ? 'line-through' : undefined,
                      opacity: m.retired ? 0.75 : 1,
                    }}
                  >
                    {cleanMilestoneTitle(m.title)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {item.description.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Notes</SectionLabel>
          <div className="flex flex-col gap-1">
            {item.description.map((line, i) => (
              <p key={i} className="text-xs leading-5" style={{ color: HUD.textDim }}>
                {deMarkdown(line)}
              </p>
            ))}
          </div>
        </div>
      )}
      {item.docPaths.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Project doc</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {item.docPaths.map(docPath => (
              <button
                key={docPath}
                type="button"
                tabIndex={-1}
                onClick={() => onOpenPath(docPath)}
                className="max-w-full truncate rounded border px-1.5 py-0.5 font-mono text-[10px] outline-none hover:bg-white/10"
                style={{
                  color: HUD.textMono,
                  borderColor: 'rgba(80,230,255,0.25)',
                }}
                title={docPath}
              >
                {docPath}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

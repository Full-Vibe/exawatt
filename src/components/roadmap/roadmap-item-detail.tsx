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
    <p className="font-mono text-[10px]" style={{ color: HUD.textDim }}>
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
  onOpenPath,
  onSelectSession,
}: {
  item: RoadmapItemView;
  /** the Project identity color for session chips */
  color: string;
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
      {item.statusNote && (
        <p className="text-xs leading-5" style={{ color: HUD.textDim }}>
          {deMarkdown(item.statusNote)}
        </p>
      )}
      {item.chips.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel>sessions</SectionLabel>
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
          <SectionLabel>scope</SectionLabel>
          <BulletList lines={item.scope} />
        </div>
      )}
      {item.exitCriteria.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel>exit criteria</SectionLabel>
          <BulletList lines={item.exitCriteria} />
        </div>
      )}
      {item.milestones.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel>{`milestones · ${item.milestonesDone}/${item.milestones.length}`}</SectionLabel>
          <ul className="flex flex-col">
            {item.milestones.map((m, i) => (
              <li key={i} className="relative flex gap-2 py-1 pl-5">
                {/* mini-spine: a done node is filled, an open one hollow */}
                <span
                  aria-hidden
                  className="absolute left-1 top-[9px] h-2 w-2 rounded-full"
                  style={{
                    background: m.done ? HUD.green : 'transparent',
                    border: `1.5px solid ${m.done ? HUD.green : withAlpha(statusColor, 0.6)}`,
                  }}
                />
                {m.id && (
                  <span
                    className="shrink-0 font-mono text-[11px] leading-5"
                    style={{ color: m.done ? HUD.textDim : HUD.textMono }}
                  >
                    {m.id}
                  </span>
                )}
                <span
                  className="min-w-0 text-xs leading-5"
                  style={{ color: m.done ? HUD.textDim : HUD.text }}
                >
                  {m.title}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {item.description.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel>notes</SectionLabel>
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
          <SectionLabel>project doc</SectionLabel>
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

// No 'use client': only imported by the client workspace surface.

/**
 * S13 detail: live state first, contract prose one disclosure deeper.
 * Queue manipulation stays structural and delegates every write to the
 * compare-before-write Electron boundary from decision 0035.
 */
import { useEffect, useState } from 'react';
import {
  WORKSPACE_FOUNDATION,
  WORKSPACE_HUD as HUD,
  withThemeAlpha as withAlpha,
} from '@/components/workspace/workspace-theme';
import { Button } from '@/components/ui/button';
import type {
  RoadmapItemView,
  RoadmapLensSessionInput,
} from '@exawatt/ui-model';
import type {
  RoadmapWritableStatus,
  RoadmapWriteAction,
} from '@/types/electron';
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

function deMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p
      className="font-ui text-chrome-meta font-medium"
      style={{ color: HUD.textDim }}
    >
      {children}
    </p>
  );
}

function BulletList({ lines }: { lines: string[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {lines.map((line, index) => (
        <li
          key={index}
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

function relativeTime(timestamp: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const WRITABLE_STATUSES: Array<{
  value: RoadmapWritableStatus;
  label: string;
}> = [
  { value: 'now', label: 'Now' },
  { value: 'next', label: 'Next' },
  { value: 'later', label: 'Later' },
  { value: 'parked', label: 'Parked' },
];

export function RoadmapItemDetail({
  item,
  color,
  selectedMilestone = null,
  unmappedSessions,
  manipulable,
  writeBusy,
  onOpenPath,
  onSelectSession,
  onStartAgent,
  onAttachSession,
  onMutate,
}: {
  item: RoadmapItemView;
  color: string;
  selectedMilestone?: number | null;
  unmappedSessions: RoadmapLensSessionInput[];
  manipulable: boolean;
  writeBusy: boolean;
  onOpenPath: (path: string) => void;
  onSelectSession: (tabId: string) => void;
  onStartAgent: (item: RoadmapItemView) => Promise<boolean>;
  onAttachSession: (tabId: string, itemId: string) => boolean;
  onMutate: (action: RoadmapWriteAction) => void;
}) {
  const [attachOpen, setAttachOpen] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchFailed, setLaunchFailed] = useState(false);
  const [now, setNow] = useState(Date.now());
  const statusColor = ROADMAP_STATUS_COLOR[item.displayStatus];
  const hasWriteTarget =
    manipulable && Boolean(item.declaredId) && item.hasUniqueDeclaredId;
  const canChangeStatus =
    hasWriteTarget &&
    WRITABLE_STATUSES.some(status => status.value === item.status);
  const canReorder =
    hasWriteTarget &&
    item.status === item.sectionStatus &&
    (canChangeStatus || item.status === 'backlog');
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const launch = async () => {
    setLaunchFailed(false);
    setLaunching(true);
    try {
      setLaunchFailed(!(await onStartAgent(item)));
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div
      className="flex flex-col gap-3 px-3 pb-3"
      aria-busy={writeBusy || undefined}
    >
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
        className="font-display text-base font-semibold leading-6"
        style={{ color: HUD.text }}
      >
        {item.title}
      </p>

      {item.description[0] && (
        <p
          className="line-clamp-2 text-xs leading-5"
          style={{ color: HUD.textDim }}
        >
          {deMarkdown(item.description[0])}
        </p>
      )}

      {item.status === 'backlog' && item.backlog ? (
        <div
          className="flex flex-wrap items-center gap-1.5 font-mono text-chrome-meta"
          style={{ color: HUD.textDim }}
        >
          <span>{item.backlog.kind}</span>
          <span aria-hidden>·</span>
          <span>{item.backlog.ownerItemId}</span>
          <span aria-hidden>·</span>
          <span>{item.backlog.provenance}</span>
        </div>
      ) : item.blocked && statusNoteProse(item.statusNote) ? (
        <p className="text-xs leading-5" style={{ color: HUD.amber }}>
          Blocked — {deMarkdown(statusNoteProse(item.statusNote) as string)}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" onClick={() => void launch()} disabled={launching}>
          {launching ? 'Starting…' : 'Start agent'}
        </Button>
        {unmappedSessions.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAttachOpen(open => !open)}
          >
            Attach running
          </Button>
        )}
        {canChangeStatus && item.declaredId && (
          <>
            <select
              aria-label="Roadmap status"
              value={item.status}
              disabled={writeBusy}
              onChange={event =>
                onMutate({
                  kind: 'set-status',
                  itemId: item.declaredId as string,
                  status: event.target.value as RoadmapWritableStatus,
                })
              }
              className="h-8 rounded-md border bg-transparent px-2 font-ui text-chrome-label outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan disabled:cursor-wait disabled:opacity-60"
              style={{ borderColor: HUD.strokeSoft, color: HUD.text }}
            >
              {WRITABLE_STATUSES.map(status => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </>
        )}
        {canReorder && item.declaredId && (
          <>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Move item up"
              disabled={writeBusy || !item.canMoveUp}
              title={item.canMoveUp ? 'Move item up' : 'First in this state'}
              onClick={() =>
                onMutate({
                  kind: 'move-item',
                  itemId: item.declaredId as string,
                  direction: 'up',
                })
              }
            >
              ↑
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Move item down"
              disabled={writeBusy || !item.canMoveDown}
              title={item.canMoveDown ? 'Move item down' : 'Last in this state'}
              onClick={() =>
                onMutate({
                  kind: 'move-item',
                  itemId: item.declaredId as string,
                  direction: 'down',
                })
              }
            >
              ↓
            </Button>
          </>
        )}
        {manipulable && item.declaredId && !item.hasUniqueDeclaredId && (
          <span
            className="font-ui text-chrome-meta"
            style={{ color: HUD.amber }}
            title="Resolve duplicate item ids in the roadmap before changing state."
          >
            Duplicate id · view only
          </span>
        )}
        {hasWriteTarget && item.status !== item.sectionStatus && (
          <span
            className="font-ui text-chrome-meta"
            style={{ color: HUD.textDim }}
            title="Move the item into its displayed section before reordering it."
          >
            Section mismatch · reorder unavailable
          </span>
        )}
        {launchFailed && (
          <span
            role="status"
            className="font-ui text-chrome-meta"
            style={{ color: HUD.amber }}
          >
            Agent could not start · check Agent Sources
          </span>
        )}
      </div>

      {attachOpen && (
        <div
          className="flex flex-col gap-1.5 rounded border p-2"
          style={{ borderColor: HUD.strokeSoft }}
        >
          <SectionLabel>Running Sessions</SectionLabel>
          {unmappedSessions.map(session => (
            <button
              key={session.sessionId}
              type="button"
              onClick={() => {
                if (session.tabId && onAttachSession(session.tabId, item.id))
                  setAttachOpen(false);
              }}
              className="flex items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs outline-none hover:bg-hud-fill-hi"
              style={{ color: HUD.text }}
            >
              <span className="truncate">{session.title}</span>
              <span
                className="shrink-0 font-mono text-chrome-micro"
                style={{ color: HUD.textDim }}
              >
                {session.turnState === 'working'
                  ? 'working'
                  : session.turnState === 'needs-you'
                    ? 'needs you'
                    : 'waiting'}
              </span>
            </button>
          ))}
        </div>
      )}

      {item.chips.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Sessions</SectionLabel>
          <div className="flex flex-col items-start gap-1.5">
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

      {item.milestones.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel>{`Milestones · ${milestoneFractionSentence(item.milestonesDone, item.milestonesTotal)}`}</SectionLabel>
          <ul className="flex flex-col">
            {item.milestones.map((milestone, index) => {
              const roved = selectedMilestone === index;
              const canToggle =
                hasWriteTarget && !writeBusy && !milestone.retired;
              return (
                <li
                  key={index}
                  data-roadmap-milestone={index}
                  data-selected={roved || undefined}
                  className="relative flex gap-2 rounded py-1 pl-6 pr-1"
                  style={{ background: roved ? HUD.fillHi : 'transparent' }}
                >
                  <button
                    type="button"
                    disabled={!canToggle}
                    aria-label={`${milestone.done ? 'Untick' : 'Tick'} ${milestone.id ?? milestone.title}`}
                    onClick={() =>
                      item.declaredId &&
                      onMutate({
                        kind: 'set-milestone',
                        itemId: item.declaredId,
                        line: milestone.source.line,
                        done: !milestone.done,
                      })
                    }
                    className="absolute left-0.5 top-1 grid h-4 w-4 place-items-center rounded-full font-mono text-chrome-nano font-bold outline-none disabled:cursor-default"
                    style={
                      milestone.done
                        ? {
                            background: HUD.green,
                            color: WORKSPACE_FOUNDATION.actionText,
                          }
                        : {
                            border: milestone.retired
                              ? `1.5px dashed ${withAlpha(HUD.textDim, 0.6)}`
                              : `1.5px solid ${withAlpha(statusColor, 0.6)}`,
                            color: 'transparent',
                          }
                    }
                  >
                    ✓
                  </button>
                  {milestone.id && (
                    <span
                      className="shrink-0 font-mono text-chrome-meta leading-5"
                      style={{
                        color:
                          milestone.done || milestone.retired
                            ? HUD.textDim
                            : HUD.textMono,
                        textDecoration: milestone.retired
                          ? 'line-through'
                          : undefined,
                      }}
                    >
                      {milestone.id}
                    </span>
                  )}
                  <span
                    className="min-w-0 text-xs leading-5"
                    style={{
                      color:
                        milestone.done || milestone.retired
                          ? HUD.textDim
                          : HUD.text,
                      textDecoration: milestone.retired
                        ? 'line-through'
                        : undefined,
                      opacity: milestone.retired ? 0.75 : 1,
                    }}
                  >
                    {cleanMilestoneTitle(milestone.title)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {item.recentChanges.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Recent changes</SectionLabel>
          <ul className="flex flex-col gap-1">
            {item.recentChanges.map(change => (
              <li
                key={change.hash}
                className="flex items-baseline justify-between gap-2 text-xs leading-5"
              >
                <span
                  className="min-w-0 truncate"
                  style={{ color: HUD.text }}
                  title={change.subject}
                >
                  {change.subject}
                </span>
                <span
                  className="shrink-0 font-mono text-chrome-micro"
                  style={{ color: HUD.textDim }}
                >
                  {relativeTime(change.committedAt, now)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(item.scope.length > 0 ||
        item.exitCriteria.length > 0 ||
        item.description.length > 1) && (
        <details
          className="group rounded border px-3 py-2"
          style={{ borderColor: HUD.strokeSoft }}
        >
          <summary
            className="cursor-pointer list-none font-ui text-chrome-label font-medium outline-none"
            style={{ color: HUD.text }}
          >
            Scope & criteria{' '}
            <span
              aria-hidden
              className="ml-1 font-mono text-chrome-micro"
              style={{ color: HUD.textDim }}
            >
              ▸
            </span>
          </summary>
          <div className="mt-3 flex flex-col gap-3">
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
            {item.description.length > 1 && (
              <div className="flex flex-col gap-1.5">
                <SectionLabel>Notes</SectionLabel>
                {item.description.slice(1).map((line, index) => (
                  <p
                    key={index}
                    className="text-xs leading-5"
                    style={{ color: HUD.textDim }}
                  >
                    {deMarkdown(line)}
                  </p>
                ))}
              </div>
            )}
          </div>
        </details>
      )}

      {item.docPaths.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Project doc</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {item.docPaths.map(docPath => (
              <button
                key={docPath}
                type="button"
                onClick={() => onOpenPath(docPath)}
                className="max-w-full truncate rounded border px-1.5 py-0.5 font-mono text-chrome-micro outline-none hover:bg-hud-fill-hi"
                style={{ color: HUD.textMono, borderColor: HUD.strokeSoft }}
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

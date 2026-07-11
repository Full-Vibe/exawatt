// No 'use client': only imported by the client workspace surface.

/**
 * Roadmap rail (ENG-017 S2): the workspace expression of the roadmap lens.
 * A feed line — the Project's queue as stations on a spine in the Project's
 * identity color, the now station dominant, resolution falling off with
 * distance (the altitude principle inside one panel).
 *
 * Keyboard-first: ⌘B summons (wired in the workspace shortcut layer), the
 * rail owns plain keys while focused (roving selection, Enter/→ drill,
 * Esc/← back out, `o` opens the file, `g` jumps to the now station).
 * Read-only is a trust posture: no edit affordances anywhere; the footer
 * says exactly what file is read.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { HUD, withAlpha } from '@/components/hud';
import { FOCUS_ACTIVE_TERMINAL_EVENT } from '../workspace/session-jump';
import type { RoadmapItemView, RoadmapLensView } from '@exawatt/ui-model';
import { useProjectRoadmap } from './use-project-roadmap';
import { RoadmapItemCard } from './roadmap-item-card';
import { RoadmapItemDetail } from './roadmap-item-detail';
import {
  RoadmapEmptyQueue,
  RoadmapNoRoadmap,
  RoadmapReadError,
} from './roadmap-empty-queue';

export type RoadmapRailMode = 'strip' | 'open';

/** dispatched by the workspace ⌘B verb to move focus into the rail */
export const ROADMAP_RAIL_FOCUS_EVENT = 'exawatt:focus-roadmap-rail';

export const ROADMAP_RAIL_WIDTH = 320;
export const ROADMAP_STRIP_WIDTH = 36;

/** machine-local view preference; repo state never lives here */
const MODE_STORAGE_KEY = 'exawatt:roadmap-rail-mode';

export function loadRailMode(): RoadmapRailMode {
  try {
    const raw = window.localStorage.getItem(MODE_STORAGE_KEY);
    return raw === 'open' ? 'open' : 'strip';
  } catch {
    return 'strip';
  }
}

export function saveRailMode(mode: RoadmapRailMode): void {
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // preference only; losing it is harmless
  }
}

type RailRow =
  | { kind: 'group'; group: 'shipped' | 'parked'; label: string }
  | { kind: 'item'; item: RoadmapItemView; variant: 'hero' | 'row' | 'compact' };

function formatUpdated(mtimeMs: number): string {
  const age = Date.now() - mtimeMs;
  if (age < 60_000) return 'updated just now';
  if (age < 3_600_000) return `updated ${Math.floor(age / 60_000)}m ago`;
  const d = new Date(mtimeMs);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `updated ${hh}:${mm}`;
}

function trustLine(view: RoadmapLensView): string {
  const t = view.trust;
  if (!t) return '';
  const parts = [`${t.itemCount} item${t.itemCount === 1 ? '' : 's'}`];
  if (t.warningCount > 0) parts.push(`${t.warningCount} warning${t.warningCount === 1 ? '' : 's'}`);
  if (t.unparsedLineCount > 0) parts.push(`${t.unparsedLineCount} lines unrecognized`);
  return parts.join(' · ');
}

export function RoadmapRail({
  projectDir,
  projectName,
  projectColor,
  mode,
  onModeChange,
  /** dock beside the stage, or float over it on narrow windows */
  overlay,
}: {
  projectDir: string | null;
  projectName: string | null;
  projectColor: string | null;
  mode: RoadmapRailMode;
  onModeChange: (mode: RoadmapRailMode) => void;
  overlay: boolean;
}) {
  const { view } = useProjectRoadmap(projectDir);
  const color = projectColor ?? HUD.cyan;
  const rootRef = useRef<HTMLDivElement>(null);
  const [entered, setEntered] = useState(false);
  const [shippedOpen, setShippedOpen] = useState(false);
  const [parkedOpen, setParkedOpen] = useState(false);
  const [drillId, setDrillId] = useState<string | null>(null);
  const [sel, setSel] = useState(0);

  // entrance stagger (exposé recipe): flag flips post-mount
  useEffect(() => {
    if (mode !== 'open') return;
    setEntered(false);
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, [mode]);

  // project switch re-scopes the rail: drill resets, selection returns home
  useEffect(() => {
    setDrillId(null);
    setSel(0);
    setShippedOpen(false);
    setParkedOpen(false);
  }, [projectDir]);

  // the workspace ⌘B verb moves focus here
  useEffect(() => {
    const onFocusRail = () => rootRef.current?.focus();
    window.addEventListener(ROADMAP_RAIL_FOCUS_EVENT, onFocusRail);
    return () => window.removeEventListener(ROADMAP_RAIL_FOCUS_EVENT, onFocusRail);
  }, []);

  const rows = useMemo<RailRow[]>(() => {
    if (view.status !== 'ok' || view.queueEmpty) return [];
    const list: RailRow[] = [];
    if (view.shipped.length > 0) {
      list.push({
        kind: 'group',
        group: 'shipped',
        label: `${view.shipped.length} shipped`,
      });
      if (shippedOpen) {
        for (const item of view.shipped)
          list.push({ kind: 'item', item, variant: 'compact' });
      }
    }
    view.now.forEach((item, i) =>
      list.push({ kind: 'item', item, variant: i === 0 ? 'hero' : 'row' })
    );
    for (const item of view.next) list.push({ kind: 'item', item, variant: 'row' });
    for (const item of view.later)
      list.push({ kind: 'item', item, variant: 'compact' });
    if (view.parked.length > 0) {
      list.push({
        kind: 'group',
        group: 'parked',
        label: `${view.parked.length} parked`,
      });
      if (parkedOpen) {
        for (const item of view.parked)
          list.push({ kind: 'item', item, variant: 'compact' });
      }
    }
    return list;
  }, [view, shippedOpen, parkedOpen]);

  useEffect(() => {
    setSel(s => Math.min(s, Math.max(0, rows.length - 1)));
  }, [rows.length]);

  const drilled = useMemo<RoadmapItemView | null>(() => {
    if (!drillId || view.status !== 'ok') return null;
    return (
      [...view.now, ...view.next, ...view.later, ...view.shipped, ...view.parked].find(
        item => item.id === drillId
      ) ?? null
    );
  }, [drillId, view]);

  const openPath = useCallback(
    (path: string | null) => {
      if (!path || !projectDir) return;
      void window.electron?.pty?.openPath(path, projectDir).catch(() => {});
    },
    [projectDir]
  );

  const focusTerminal = () =>
    window.dispatchEvent(new CustomEvent(FOCUS_ACTIVE_TERMINAL_EVENT));

  const activateRow = (row: RailRow) => {
    if (row.kind === 'group') {
      if (row.group === 'shipped') setShippedOpen(open => !open);
      else setParkedOpen(open => !open);
    } else {
      setDrillId(row.item.id);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return; // workspace verbs pass through
    const key = e.key;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (key === 'Escape' || key === 'ArrowLeft') {
      handled();
      if (drillId) setDrillId(null);
      else if (key === 'Escape') focusTerminal();
      return;
    }
    if (drillId) {
      if (key === 'o') {
        handled();
        openPath(view.file);
      }
      return; // R1: native scroll owns ↑↓
    }
    if (key === 'ArrowDown' || key === 'j') {
      handled();
      setSel(s => Math.min(rows.length - 1, s + 1));
    } else if (key === 'ArrowUp' || key === 'k') {
      handled();
      setSel(s => Math.max(0, s - 1));
    } else if (key === 'Enter' || key === 'ArrowRight') {
      const row = rows[sel];
      if (row) {
        handled();
        activateRow(row);
      }
    } else if (key === 'g') {
      const i = rows.findIndex(r => r.kind === 'item' && r.item.isNowStation);
      if (i >= 0) {
        handled();
        setSel(i);
      }
    } else if (key === 'o') {
      handled();
      openPath(view.file);
    }
  };

  // keep the selected row in view as selection roves
  useEffect(() => {
    const row = rows[sel];
    if (!row || row.kind !== 'item') return;
    rootRef.current
      ?.querySelector(`[data-roadmap-row="${CSS.escape(row.item.id)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [sel, rows]);

  const remaining =
    view.status === 'ok' ? view.now.length + view.next.length + view.later.length : 0;
  const healthAlert =
    view.status === 'ok' && (view.queueEmpty || (view.trust?.warningCount ?? 0) > 0);

  if (mode === 'strip') {
    return (
      <button
        type="button"
        aria-label={`Open roadmap rail${healthAlert ? ' — needs attention' : ''}`}
        title="Roadmap (⌘B)"
        onClick={() => onModeChange('open')}
        className="relative flex shrink-0 flex-col items-center gap-2 border-l pt-3 outline-none hover:bg-white/5 focus-visible:ring-1 focus-visible:ring-hud-cyan"
        style={{
          width: ROADMAP_STRIP_WIDTH,
          borderColor: 'rgba(80,230,255,0.12)',
          background: HUD.bg.deep,
        }}
      >
        {/* the spine survives collapse: node + remaining count = health at a glance */}
        <span
          aria-hidden
          className="h-2.5 w-2.5 rounded-full"
          style={{
            background: view.queueEmpty ? 'transparent' : color,
            border: `1.5px solid ${view.queueEmpty ? HUD.amber : color}`,
            boxShadow: `0 0 6px ${withAlpha(view.queueEmpty ? HUD.amber : color, 0.6)}`,
          }}
        />
        <span
          aria-hidden
          className="w-px flex-1"
          style={{ background: withAlpha(color, 0.35) }}
        />
        {view.status === 'ok' && (
          <span
            className="pb-2 font-mono text-[10px]"
            style={{ color: healthAlert ? HUD.amber : HUD.textDim }}
          >
            {view.queueEmpty ? '!' : remaining}
          </span>
        )}
      </button>
    );
  }

  const stagger = (i: number): React.CSSProperties => ({
    opacity: entered ? 1 : 0,
    transform: entered ? 'none' : 'translateY(10px)',
    transition: 'opacity 200ms cubic-bezier(0.16,1,0.3,1), transform 200ms cubic-bezier(0.16,1,0.3,1)',
    transitionDelay: entered ? `${Math.min(i * 18, 300)}ms` : '0ms',
  });

  return (
    <div
      ref={rootRef}
      data-roadmap-rail
      role="complementary"
      aria-label="Project roadmap"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={`flex shrink-0 flex-col border-l outline-none motion-reduce:[&_*]:!transition-none ${
        overlay ? 'absolute inset-y-0 right-0 z-10 shadow-[-12px_0_32px_rgba(0,0,0,0.55)]' : ''
      }`}
      style={{
        width: ROADMAP_RAIL_WIDTH,
        borderColor: 'rgba(80,230,255,0.15)',
        background: HUD.bg.deep,
      }}
    >
      {/* header: whose roadmap this is, from which file */}
      <div
        className="flex shrink-0 flex-col gap-1 border-b px-3 py-2"
        style={{ borderColor: 'rgba(80,230,255,0.12)' }}
      >
        <div className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2 w-2 shrink-0 rotate-45"
            style={{ background: color, boxShadow: `0 0 5px ${color}` }}
          />
          <span
            className="min-w-0 truncate font-display text-sm font-semibold"
            style={{ color: HUD.text }}
          >
            {projectName ?? 'No project'}
          </span>
          <span className="font-mono text-xs" style={{ color: HUD.textDim }}>
            roadmap
          </span>
          <button
            type="button"
            aria-label="Collapse roadmap rail"
            title="Collapse (⌘B)"
            onClick={() => {
              onModeChange('strip');
              focusTerminal();
            }}
            className="ml-auto grid h-6 w-6 shrink-0 place-items-center rounded outline-none hover:bg-white/10"
            style={{ color: HUD.textDim }}
          >
            ×
          </button>
        </div>
        {view.status === 'ok' && view.file && (
          <div className="flex items-center gap-2 font-mono text-[10px]" style={{ color: HUD.textDim }}>
            <button
              type="button"
              tabIndex={-1}
              onClick={() => openPath(view.file)}
              className="min-w-0 truncate rounded border px-1 py-px outline-none hover:bg-white/10"
              style={{ color: HUD.textMono, borderColor: 'rgba(80,230,255,0.2)' }}
              title={`open ${view.file}`}
            >
              {view.file}
            </button>
            {view.mtimeMs !== null && <span className="shrink-0">{formatUpdated(view.mtimeMs)}</span>}
          </div>
        )}
      </div>

      {/* body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!projectDir ? (
          <p className="px-3 py-4 text-xs leading-5" style={{ color: HUD.textDim }}>
            Open a project to see its roadmap.
          </p>
        ) : view.status === 'loading' ? (
          <div className="flex flex-col gap-2 p-3" aria-label="Loading roadmap">
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="h-8 animate-pulse rounded"
                style={{ background: HUD.fill }}
              />
            ))}
          </div>
        ) : view.status === 'none' ? (
          <RoadmapNoRoadmap checkedPaths={view.checkedPaths} />
        ) : view.status === 'error' ? (
          <RoadmapReadError error={view.error ?? 'unknown error'} />
        ) : drilled ? (
          <div>
            <div className="flex items-center gap-1.5 px-3 py-2">
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setDrillId(null)}
                aria-label="Back to queue"
                className="rounded px-1 font-mono text-xs outline-none hover:bg-white/10"
                style={{ color: HUD.textDim }}
              >
                ←
              </button>
              <span className="font-mono text-[11px]" style={{ color: HUD.textDim }}>
                roadmap · {drilled.declaredId ?? drilled.title}
              </span>
            </div>
            <RoadmapItemDetail item={drilled} onOpenPath={openPath} />
          </div>
        ) : view.queueEmpty ? (
          <div className="relative">
            <span
              aria-hidden
              className="absolute bottom-0 left-[11px] top-0 w-0.5"
              style={{ background: withAlpha(color, 0.3) }}
            />
            <RoadmapEmptyQueue
              shippedCount={view.shipped.length}
              onOpenFile={view.file ? () => openPath(view.file) : null}
            />
          </div>
        ) : (
          <div className="relative py-1.5">
            {/* the feed line itself */}
            <span
              aria-hidden
              className="absolute bottom-2 left-[11px] top-2 w-0.5"
              style={{ background: withAlpha(color, 0.3) }}
            />
            {rows.map((row, i) => (
              <div key={row.kind === 'item' ? row.item.id : row.group} style={stagger(i)}>
                {row.kind === 'group' ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    data-selected={i === sel || undefined}
                    onClick={() => activateRow(row)}
                    onMouseEnter={() => setSel(i)}
                    className="flex w-full cursor-default items-center gap-2 py-1 pl-6 pr-2 text-left font-mono text-[11px] outline-none"
                    style={{
                      color: row.group === 'shipped' ? HUD.green : HUD.textDim,
                      background: i === sel ? HUD.fillHi : 'transparent',
                      minHeight: 26,
                    }}
                  >
                    <span aria-hidden className="text-[9px]">
                      {(row.group === 'shipped' ? shippedOpen : parkedOpen) ? '▾' : '▸'}
                    </span>
                    {row.label}
                  </button>
                ) : (
                  <RoadmapItemCard
                    item={row.item}
                    variant={row.variant}
                    selected={i === sel}
                    onDrill={() => setDrillId(row.item.id)}
                    onHover={() => setSel(i)}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* trust strip + rail keys: what is read, and that it is never written */}
      <div
        className="flex shrink-0 flex-col gap-0.5 border-t px-3 py-1.5 font-mono text-[10px]"
        style={{ borderColor: 'rgba(80,230,255,0.12)', color: HUD.textDim }}
      >
        {view.status === 'ok' && view.trust && (
          <span style={{ color: (view.trust.warningCount > 0 || view.trust.unparsedLineCount > 0) ? HUD.amber : HUD.textDim }}>
            {trustLine(view)}
          </span>
        )}
        <span>reads repo state · read-only</span>
        <span>↑↓ move · ⏎ open · esc back · ⌘B close</span>
      </div>
    </div>
  );
}

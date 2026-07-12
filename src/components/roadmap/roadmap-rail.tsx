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
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { HUD, withAlpha } from '@/components/hud';
import { FOCUS_ACTIVE_TERMINAL_EVENT } from '../workspace/session-jump';
import type {
  RoadmapItemView,
  RoadmapLensSessionInput,
  RoadmapLensView,
  RoadmapSessionChip,
} from '@exawatt/ui-model';
import { buildRoadmapStrip } from '@exawatt/ui-model';
import { RoadmapItemCard } from './roadmap-item-card';
import { RoadmapSessionChipButton } from './roadmap-session-chip';
import { RoadmapItemDetail } from './roadmap-item-detail';
import {
  RoadmapEmptyQueue,
  RoadmapNoRoadmap,
  RoadmapReadError,
} from './roadmap-empty-queue';

export type RoadmapRailMode = 'strip' | 'open';

/** dispatched by the workspace ⌘B verb to move focus into the rail */
export const ROADMAP_RAIL_FOCUS_EVENT = 'exawatt:focus-roadmap-rail';
/** dispatched (detail: item id) to open the rail drilled into one item */
export const ROADMAP_DRILL_EVENT = 'exawatt:roadmap-drill';

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
  | {
      kind: 'item';
      item: RoadmapItemView;
      variant: 'hero' | 'row' | 'compact';
      /** plain-language group label rendered above the first row of a run */
      heading?: string;
    }
  | { kind: 'chip'; chip: RoadmapSessionChip; itemId: string }
  | { kind: 'unmapped'; session: RoadmapLensSessionInput };

function rowKey(row: RailRow): string {
  return row.kind === 'item'
    ? row.item.id
    : row.kind === 'chip'
      ? `c-${row.chip.sessionId}`
      : row.kind === 'unmapped'
        ? `u-${row.session.sessionId}`
        : row.group;
}

function formatUpdated(mtimeMs: number): string {
  const age = Date.now() - mtimeMs;
  if (age < 60_000) return 'updated just now';
  if (age < 3_600_000) return `updated ${Math.floor(age / 60_000)}m ago`;
  if (age < 86_400_000) return `updated ${Math.floor(age / 3_600_000)}h ago`;
  const d = new Date(mtimeMs);
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `updated ${d.getFullYear()}-${mo}-${dd}`;
}

/**
 * The collapsed strip's spine (S6): one node per queue position, top-to-
 * bottom as the queue reads. The CURRENT node (live agent attached) carries
 * the strip's only motion; blocked/starving/unmapped are the only color.
 */
function RoadmapStripSpine({
  view,
  color,
}: {
  view: RoadmapLensView;
  color: string;
}) {
  const nodes = useMemo(() => buildRoadmapStrip(view), [view]);
  if (nodes.length === 0) return null;
  return (
    <span className="flex flex-col items-center gap-[6px]">
      {nodes.map((node, i) => {
        if (node.kind === 'unmapped') {
          return (
            <span
              key={`u-${i}`}
              data-strip-node="unmapped"
              title={node.label}
              aria-hidden
              className="h-1.5 w-1.5 rotate-45"
              style={{ background: HUD.amber }}
            />
          );
        }
        if (node.kind === 'starving') {
          return (
            <span
              key="starving"
              data-strip-node="starving"
              title={node.label}
              aria-hidden
              className="grid h-3.5 w-3.5 place-items-center rounded-full font-mono text-[9px] font-bold motion-safe:[animation:roadmap-node-pulse_2.4s_ease-in-out_infinite]"
              style={
                {
                  color: HUD.amber,
                  border: `1.5px solid ${HUD.amber}`,
                  '--roadmap-pulse-color': withAlpha(HUD.amber, 0.8),
                } as React.CSSProperties
              }
            >
              !
            </span>
          );
        }
        if (node.kind === 'aggregate') {
          return (
            <span
              key={`agg-${node.group}`}
              data-strip-node={`agg-${node.group}`}
              title={node.label}
              aria-hidden
              className="font-mono text-[9px] leading-none"
              style={{
                color: node.group === 'shipped' ? withAlpha(HUD.green, 0.65) : HUD.textDim,
              }}
            >
              {node.group === 'shipped' ? `✓${node.count}` : `+${node.count}`}
            </span>
          );
        }
        const loud = node.blocked || node.needsAttention;
        const nodeColor = loud
          ? HUD.amber
          : node.role === 'shipped'
            ? withAlpha(HUD.green, 0.55)
            : node.role === 'current' || node.role === 'now'
              ? color
              : HUD.idle;
        const size = node.role === 'current' ? 10 : 7;
        const filled =
          node.role === 'shipped' || node.role === 'current' || node.blocked;
        return (
          <span
            key={`${node.id}-${i}`}
            data-strip-node={node.role}
            data-strip-item={node.id}
            title={node.label}
            aria-hidden
            className={`shrink-0 rounded-full ${
              node.role === 'current'
                ? 'motion-safe:[animation:roadmap-node-pulse_2.4s_ease-in-out_infinite]'
                : ''
            }`}
            style={
              {
                width: size,
                height: size,
                background: filled ? nodeColor : 'transparent',
                border: `1.5px solid ${nodeColor}`,
                opacity: node.role === 'later' ? 0.55 : 1,
                '--roadmap-pulse-color': withAlpha(nodeColor, 0.85),
              } as React.CSSProperties
            }
          />
        );
      })}
    </span>
  );
}

/**
 * Header sequence bar (S7): the whole queue as one glanceable line —
 * shipped ▰, active ●, queued ○ — so "where are we" survives scrolling.
 */
function RoadmapSequenceBar({
  view,
  color,
}: {
  view: RoadmapLensView;
  color: string;
}) {
  const nodes = useMemo(() => buildRoadmapStrip(view, 24), [view]);
  if (view.status !== 'ok' || nodes.length === 0) return null;
  const summary = `${view.shipped.length} shipped · ${view.now.length} active · ${
    view.next.length + view.later.length
  } queued`;
  return (
    <div
      data-roadmap-sequence
      title={summary}
      aria-label={summary}
      className="flex items-center gap-[3px] overflow-hidden font-mono text-[9px] leading-none"
    >
      {nodes.map((node, i) => {
        if (node.kind === 'unmapped') return null; // header stays queue-only
        if (node.kind === 'starving') {
          return (
            <span key="starving" style={{ color: HUD.amber }}>
              !
            </span>
          );
        }
        if (node.kind === 'aggregate') {
          return (
            <span
              key={`agg-${node.group}-${i}`}
              style={{
                color:
                  node.group === 'shipped' ? withAlpha(HUD.green, 0.6) : HUD.textDim,
              }}
            >
              {node.group === 'shipped' ? `✓${node.count}` : `+${node.count}`}
            </span>
          );
        }
        const loud = node.blocked || node.needsAttention;
        return (
          <span
            key={`${node.id}-${i}`}
            style={{
              color: loud
                ? HUD.amber
                : node.role === 'shipped'
                  ? withAlpha(HUD.green, 0.6)
                  : node.role === 'current' || node.role === 'now'
                    ? color
                    : HUD.idle,
              opacity: node.role === 'later' ? 0.55 : 1,
            }}
          >
            {node.role === 'shipped' ? '✓' : node.role === 'current' ? '●' : '○'}
          </span>
        );
      })}
    </div>
  );
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
  view,
  projectDir,
  projectName,
  projectColor,
  mode,
  onModeChange,
  onSelectSession,
  /** dock beside the stage, or float over it on narrow windows */
  overlay,
}: {
  view: RoadmapLensView;
  projectDir: string | null;
  projectName: string | null;
  projectColor: string | null;
  mode: RoadmapRailMode;
  onModeChange: (mode: RoadmapRailMode) => void;
  /** focus the terminal tab a chip points at */
  onSelectSession: (tabId: string) => void;
  overlay: boolean;
}) {
  const color = projectColor ?? HUD.cyan;
  const rootRef = useRef<HTMLDivElement>(null);
  const [entered, setEntered] = useState(false);
  const [shippedOpen, setShippedOpen] = useState(false);
  const [parkedOpen, setParkedOpen] = useState(false);
  const [drillId, setDrillId] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  // milestone roving inside the drill (S7, the deferred R2 level)
  const [msel, setMsel] = useState(0);
  useEffect(() => setMsel(0), [drillId]);

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

  // the context-bar reciprocal chip opens the rail drilled into its item
  useEffect(() => {
    const onDrill = (e: Event) => {
      const itemId = (e as CustomEvent<string>).detail;
      if (typeof itemId === 'string') {
        setDrillId(itemId);
        rootRef.current?.focus();
      }
    };
    window.addEventListener(ROADMAP_DRILL_EVENT, onDrill);
    return () => window.removeEventListener(ROADMAP_DRILL_EVENT, onDrill);
  }, []);

  const rows = useMemo<RailRow[]>(() => {
    if (view.status !== 'ok' || view.queueEmpty) return [];
    const list: RailRow[] = [];
    for (const session of view.unmappedSessions) {
      list.push({ kind: 'unmapped', session });
    }
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
    // every attached session is an individually focusable station (S7) —
    // agents are visible wherever they are in the queue, not only on the hero
    view.now.forEach((item, i) => {
      list.push({
        kind: 'item',
        item,
        variant: i === 0 ? 'hero' : 'row',
        heading: i === 0 ? 'Now' : undefined,
      });
      for (const chip of item.chips)
        list.push({ kind: 'chip', chip, itemId: item.id });
    });
    view.next.forEach((item, i) => {
      list.push({
        kind: 'item',
        item,
        variant: 'row',
        heading: i === 0 ? 'Up next' : undefined,
      });
      for (const chip of item.chips)
        list.push({ kind: 'chip', chip, itemId: item.id });
    });
    view.later.forEach((item, i) => {
      list.push({
        kind: 'item',
        item,
        variant: 'compact',
        heading: i === 0 ? 'Later' : undefined,
      });
    });
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

  // update motion (S5): a file change on disk announces itself — one cyan
  // sweep across the header, and moved rows FLIP to their new slots so a
  // repo-side reprioritization reads as motion, not a mystery reshuffle
  const [sweep, setSweep] = useState(0);
  const lastMtime = useRef<number | null>(null);
  useEffect(() => {
    if (view.mtimeMs === null) return;
    if (lastMtime.current !== null && lastMtime.current !== view.mtimeMs) {
      setSweep(s => s + 1);
    }
    lastMtime.current = view.mtimeMs;
  }, [view.mtimeMs]);

  const rowRefs = useRef(new Map<string, HTMLDivElement | null>());
  const prevTops = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const next = new Map<string, number>();
    for (const [key, el] of rowRefs.current) {
      if (!el || !el.isConnected) continue;
      const top = el.getBoundingClientRect().top;
      next.set(key, top);
      const prev = prevTops.current.get(key);
      if (!reduced && prev !== undefined && Math.abs(prev - top) > 4) {
        el.animate(
          [{ transform: `translateY(${prev - top}px)` }, { transform: 'translateY(0)' }],
          { duration: 300, easing: 'cubic-bezier(0.16,1,0.3,1)' }
        );
      }
    }
    prevTops.current = next;
  }, [rows]);

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
      // roadmap file + `Project doc:` bullets are repo content — contain to
      // the project so a malicious roadmap can't open paths outside it
      void window.electron?.pty
        ?.openPath(path, projectDir, { contain: true })
        .catch(() => {});
    },
    [projectDir]
  );

  const focusTerminal = () =>
    window.dispatchEvent(new CustomEvent(FOCUS_ACTIVE_TERMINAL_EVENT));

  const activateRow = (row: RailRow) => {
    if (row.kind === 'group') {
      if (row.group === 'shipped') setShippedOpen(open => !open);
      else setParkedOpen(open => !open);
    } else if (row.kind === 'chip') {
      if (row.chip.tabId) onSelectSession(row.chip.tabId);
    } else if (row.kind === 'unmapped') {
      if (row.session.tabId) onSelectSession(row.session.tabId);
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
        return;
      }
      // milestone roving (R2): ↑↓/jk walk the milestone spine when the
      // drilled item has one; items without milestones keep native scroll
      const count = drilled?.milestones.length ?? 0;
      if (count > 0 && (key === 'ArrowDown' || key === 'j')) {
        handled();
        setMsel(s => Math.min(count - 1, s + 1));
      } else if (count > 0 && (key === 'ArrowUp' || key === 'k')) {
        handled();
        setMsel(s => Math.max(0, s - 1));
      }
      return;
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

  // keep the selected row in view as selection roves — but only while the
  // rail owns focus; otherwise a re-render (project switch, lab state flip)
  // scrolls every scrollable ancestor, including the page
  useEffect(() => {
    const row = rows[sel];
    if (!row) return;
    if (!rootRef.current?.contains(document.activeElement)) return;
    const selector =
      row.kind === 'item'
        ? `[data-roadmap-row="${CSS.escape(row.item.id)}"]`
        : row.kind === 'chip'
          ? `[data-roadmap-chip="${CSS.escape(row.chip.sessionId)}"]`
          : row.kind === 'unmapped'
            ? `[data-roadmap-unmapped="${CSS.escape(row.session.sessionId)}"]`
            : null;
    if (!selector) return;
    rootRef.current?.querySelector(selector)?.scrollIntoView({ block: 'nearest' });
  }, [sel, rows]);

  const remaining =
    view.status === 'ok' ? view.now.length + view.next.length + view.later.length : 0;
  const healthAlert =
    view.status === 'ok' &&
    (view.queueEmpty ||
      (view.trust?.warningCount ?? 0) > 0 ||
      view.unmappedSessions.length > 0 ||
      [...view.now, ...view.next].some(item => item.blocked));

  if (mode === 'strip') {
    return (
      <button
        type="button"
        aria-label={`Open roadmap rail${healthAlert ? ' — needs attention' : ''}`}
        title="Roadmap (⌘B)"
        onClick={() => onModeChange('open')}
        className="relative flex shrink-0 flex-col items-center border-l pb-2 pt-3 outline-none hover:bg-white/5 focus-visible:ring-1 focus-visible:ring-hud-cyan"
        style={{
          width: ROADMAP_STRIP_WIDTH,
          borderColor: 'rgba(80,230,255,0.12)',
          background: HUD.bg.deep,
        }}
      >
        <RoadmapStripSpine view={view} color={color} />
        <span
          aria-hidden
          className="my-1.5 w-px flex-1"
          style={{ background: withAlpha(color, 0.3) }}
        />
        {view.status === 'ok' && (
          <span
            data-strip-remaining
            className="font-mono text-[10px]"
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
        className="relative flex shrink-0 flex-col gap-1 overflow-hidden border-b px-3 py-2"
        style={{ borderColor: 'rgba(80,230,255,0.12)' }}
      >
        {sweep > 0 && (
          <span
            key={sweep}
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-1/3 motion-reduce:hidden"
            style={{
              background: `linear-gradient(90deg, transparent, ${withAlpha(HUD.cyan, 0.16)}, transparent)`,
              animation: 'roadmap-sweep 700ms cubic-bezier(0.16,1,0.3,1) forwards',
            }}
          />
        )}
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
          <span className="font-ui text-xs" style={{ color: HUD.textDim }}>
            Roadmap
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
        <RoadmapSequenceBar view={view} color={color} />
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
              <span className="min-w-0 truncate font-ui text-[11px]" style={{ color: HUD.textDim }}>
                Roadmap · {drilled.declaredId ?? drilled.title}
              </span>
            </div>
            <RoadmapItemDetail
              item={drilled}
              color={color}
              selectedMilestone={drilled.milestones.length > 0 ? msel : null}
              onOpenPath={openPath}
              onSelectSession={onSelectSession}
            />
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
              <div
                key={rowKey(row)}
                ref={el => {
                  if (el) rowRefs.current.set(rowKey(row), el);
                  else rowRefs.current.delete(rowKey(row));
                }}
                style={stagger(i)}
              >
                {row.kind === 'unmapped' ? (
                  <div className="pl-6 pr-2">
                    {(i === 0 || rows[i - 1].kind !== 'unmapped') && (
                      <p
                        className="pb-1 pt-1.5 font-ui text-[11px] font-medium"
                        style={{ color: HUD.amber }}
                      >
                        {view.unmappedSessions.length === 1
                          ? '1 session not linked to an item'
                          : `${view.unmappedSessions.length} sessions not linked to an item`}
                      </p>
                    )}
                    <div className="pb-1" onMouseEnter={() => setSel(i)}>
                      <button
                        type="button"
                        tabIndex={-1}
                        data-roadmap-unmapped={row.session.sessionId}
                        data-selected={i === sel || undefined}
                        title="no roadmap item matched this session"
                        onClick={() =>
                          row.session.tabId && onSelectSession(row.session.tabId)
                        }
                        className="flex min-w-0 max-w-full items-center gap-1.5 rounded border border-dashed px-1.5 py-0.5 font-mono text-[10px] outline-none hover:bg-white/10"
                        style={{
                          borderColor: withAlpha(HUD.amber, i === sel ? 0.9 : 0.45),
                          color: HUD.text,
                          background:
                            i === sel ? withAlpha(HUD.amber, 0.1) : 'transparent',
                        }}
                      >
                        <span
                          aria-hidden
                          className="inline-block h-1.5 w-1.5 shrink-0 rotate-45"
                          style={{ background: HUD.amber }}
                        />
                        <span className="min-w-0 truncate">{row.session.title}</span>
                      </button>
                    </div>
                  </div>
                ) : row.kind === 'chip' ? (
                  <div
                    className="flex pb-1 pl-10 pr-3"
                    onMouseEnter={() => setSel(i)}
                  >
                    <RoadmapSessionChipButton
                      chip={row.chip}
                      color={color}
                      selected={i === sel}
                      onJump={() => row.chip.tabId && onSelectSession(row.chip.tabId)}
                    />
                  </div>
                ) : row.kind === 'group' ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    data-selected={i === sel || undefined}
                    onClick={() => activateRow(row)}
                    onMouseEnter={() => setSel(i)}
                    className="flex w-full cursor-default items-center gap-2 py-1 pl-6 pr-2 text-left font-ui text-[11px] outline-none"
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
                  <>
                    {row.heading && (
                      <p
                        className="pb-1 pl-6 pr-2 pt-2.5 font-ui text-[11px] font-medium"
                        style={{ color: HUD.textDim }}
                      >
                        {row.heading}
                      </p>
                    )}
                    <RoadmapItemCard
                      item={row.item}
                      variant={row.variant}
                      selected={i === sel}
                      onDrill={() => setDrillId(row.item.id)}
                      onHover={() => setSel(i)}
                    />
                  </>
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
          <span
            className="font-ui text-[11px]"
            style={{ color: (view.trust.warningCount > 0 || view.trust.unparsedLineCount > 0) ? HUD.amber : HUD.textDim }}
          >
            {trustLine(view)}
          </span>
        )}
        <span className="font-ui text-[11px]">
          Read-only — Exawatt reads this file, never writes it
        </span>
        <span>↑↓ move · ⏎ open · esc back · ⌘B close</span>
      </div>
    </div>
  );
}

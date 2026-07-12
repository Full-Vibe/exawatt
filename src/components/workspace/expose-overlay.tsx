// No 'use client' directive: only imported by the client workspace surface.

/**
 * Exposé overview (ENG-015 S3): ⌘O fans every live session out as a rich
 * tile — project color, harness mark, title, micro-context, needs-you
 * pulse, and the last lines of scrollback — so "where is everything?"
 * answers itself in one glance. Fully keyboard-driven: arrows move,
 * Enter/click drops into the session, Esc/⌘O closes. DOM-rendered per the
 * decision `0003` hybrid rule; motion respects prefers-reduced-motion.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HUD } from '@/components/hud';
import { FOCUS_SESSIONS_EVENT } from '@/components/nav/command-altitude-events';
import { HarnessGlyph } from './harness-icons';
import { previewLines } from './scrollback-preview';
import { tabIsLive } from './use-workspace-state';
import type { Project } from './use-workspace-state';
import type { PtyHarness } from '@/types/electron';

interface Tile {
  /** null when the tab has no process (restored, not resumed) */
  sessionId: string | null;
  tabId: string;
  dir: string;
  harness: PtyHarness;
  title: string;
  projectName: string;
  color: string;
  /** running/resumed process behind the tab */
  live: boolean;
  /** short state word for non-live tabs ("stopped", "interrupted", …) */
  stateLabel: string | null;
}

/** ENG-018 lifecycle → tile state word (overview shows EVERY tab, live or
 *  not — a stopped agent is still a session the operator owns) */
const TILE_STATE_LABEL: Record<string, string> = {
  'stopped-clean': 'stopped',
  interrupted: 'interrupted',
  exited: 'exited',
  resuming: 'resuming…',
  failed: 'failed',
};

const TILE_W = 300; // px — column math for ↑/↓ derives from this

export function ExposeOverlay({
  projects,
  summaries,
  attention,
  roadmapByTab = {},
  activeTabId,
  onPick,
  onClose,
}: {
  projects: Project[];
  summaries: Record<string, string>;
  /** presence-only (S8 merges roadmap-derived entries) */
  attention: Record<string, { since: number }>;
  /** tabId → linked roadmap item (ENG-017 S9 mirror): the exposé is an
   *  AGENT-FIRST view, so each tile says what its agent is executing */
  roadmapByTab?: Record<
    string,
    { label: string; fraction: string | null; inferred: boolean }
  >;
  /** selection starts on the session the operator came from */
  activeTabId: string | null;
  onPick: (dir: string, tabId: string) => void;
  onClose: () => void;
}) {
  // stable order = model order (spatial memory: tiles never reshuffle)
  const tiles = useMemo<Tile[]>(
    () =>
      projects.flatMap(g =>
        g.tabs.map(t => {
          const live = tabIsLive(t) && !!t.sessionId && t.exitCode === null;
          return {
            sessionId: t.sessionId,
            tabId: t.id,
            dir: g.dir,
            harness: t.harness,
            title: t.title,
            projectName: g.name,
            color: g.color,
            live,
            stateLabel: live
              ? null
              : (TILE_STATE_LABEL[t.lifecycle] ??
                (t.exitCode !== null ? 'exited' : 'stopped')),
          };
        })
      ),
    [projects]
  );

  // start where the operator was — ⌘O then Enter must be a no-op return,
  // never a jump to whatever happens to be tile 0
  const [sel, setSel] = useState(() => {
    const i = tiles.findIndex(t => t.tabId === activeTabId);
    return i === -1 ? 0 : i;
  });
  const [previews, setPreviews] = useState<Record<string, string[]>>({});
  const [entered, setEntered] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef(new Map<string, HTMLButtonElement>());
  const selectedIndexRef = useRef(sel);
  selectedIndexRef.current = sel;

  const focusSelection = useCallback(
    (index = selectedIndexRef.current) => {
      const tile = tiles[index];
      if (tile) {
        const node = tileRefs.current.get(tile.tabId);
        node?.focus({ preventScroll: true });
        node?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      } else {
        rootRef.current?.focus({ preventScroll: true });
      }
    },
    [tiles]
  );

  // tiles can shrink while open (a session exits) — selection stays in range
  useEffect(() => {
    setSel(s => {
      const next = Math.min(s, Math.max(0, tiles.length - 1));
      requestAnimationFrame(() => focusSelection(next));
      return next;
    });
  }, [focusSelection, tiles.length]);

  // fetch scrollback for tiles we haven't covered yet (tiles can also GROW
  // while open, e.g. a tab finishing auto-revive)
  const fetchedRef = useRef(new Set<string>());
  useEffect(() => {
    const api = window.electron?.pty;
    if (!api) return;
    const missing = tiles.filter(
      (t): t is Tile & { sessionId: string } =>
        !!t.sessionId && !fetchedRef.current.has(t.sessionId)
    );
    if (missing.length === 0) return;
    for (const t of missing) fetchedRef.current.add(t.sessionId);
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        missing.map(async t => {
          const buf = await api.buffer(t.sessionId).catch(() => '');
          return [t.sessionId, previewLines(buf, 5, 90)] as const;
        })
      );
      if (!cancelled) {
        setPreviews(prev => ({ ...prev, ...Object.fromEntries(entries) }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tiles]);

  // take the keyboard away from xterm; entrance flag flips post-mount so
  // tiles transition in (staggered)
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setEntered(true);
      focusSelection();
    });
    return () => cancelAnimationFrame(raf);
  }, [focusSelection]);

  useEffect(() => {
    const focus = () => focusSelection();
    window.addEventListener(FOCUS_SESSIONS_EVENT, focus);
    return () => window.removeEventListener(FOCUS_SESSIONS_EVENT, focus);
  }, [focusSelection]);

  useEffect(() => {
    const closeFromShellChrome = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Escape') return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (rootRef.current?.contains(target)) return;
      if (
        target.closest('[role="dialog"], [cmdk-root], .xterm-helper-textarea')
      ) {
        return;
      }
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', closeFromShellChrome, true);
    return () =>
      window.removeEventListener('keydown', closeFromShellChrome, true);
  }, [onClose]);

  const cols = () => {
    const w = gridRef.current?.offsetWidth ?? TILE_W;
    // the last tile in a row needs no trailing gap
    return Math.max(1, Math.floor((w + 12) / (TILE_W + 12)));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' || (e.metaKey && e.key.toLowerCase() === 'o')) {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'Enter') {
      const t = tiles[sel];
      if (t) {
        e.preventDefault();
        onPick(t.dir, t.tabId);
      }
      return;
    }
    // arrows move the grid selection; plain j/k mirror down/up (D9 — the
    // app's list-navigation vocabulary works here too). Modifier combos are
    // NOT movement: ⌘K must stay the palette, ⌘J the attention jump.
    const plainKey = !e.metaKey && !e.ctrlKey && !e.altKey;
    const delta =
      e.key === 'ArrowRight'
        ? 1
        : e.key === 'ArrowLeft'
          ? -1
          : e.key === 'ArrowDown' || (plainKey && e.key === 'j')
            ? cols()
            : e.key === 'ArrowUp' || (plainKey && e.key === 'k')
              ? -cols()
              : 0;
    if (delta !== 0 && tiles.length > 0) {
      e.preventDefault();
      setSel(s => {
        const next = Math.min(tiles.length - 1, Math.max(0, s + delta));
        requestAnimationFrame(() => focusSelection(next));
        return next;
      });
    }
  };

  return (
    <div
      ref={rootRef}
      role="region"
      aria-label="Session overview"
      data-expose
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="absolute inset-0 z-20 overflow-y-auto outline-none transition-opacity duration-200 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
      style={{
        background: 'rgba(4,6,11,0.84)',
        backdropFilter: 'blur(6px)',
        opacity: entered ? 1 : 0,
      }}
    >
      <div className="px-6 pb-6 pt-5">
        <div
          className="mb-4 flex items-baseline gap-3 font-mono text-xs"
          style={{ color: HUD.textDim }}
        >
          <h2
            className="font-display text-sm font-semibold"
            style={{ color: HUD.text }}
          >
            All sessions
          </h2>
          <span>arrows or J/K move · enter opens · esc returns</span>
        </div>
        {tiles.length === 0 ? (
          <div
            className="flex min-h-48 max-w-lg flex-col justify-center gap-2 border-y py-8"
            style={{ borderColor: 'rgba(80,230,255,0.12)' }}
          >
            <p
              className="font-display text-base font-semibold"
              style={{ color: HUD.text }}
            >
              No sessions yet
            </p>
            <p
              className="max-w-md font-mono text-xs leading-5"
              style={{ color: HUD.textDim }}
            >
              Return to Terminal and launch an agent or shell. This altitude
              will become the live overview for every running session.
            </p>
          </div>
        ) : null}
        <div ref={gridRef} className="flex flex-wrap gap-3">
          {tiles.map((t, i) => {
            const selected = i === sel;
            const needsYou = !!(t.sessionId && attention[t.sessionId]);
            const subtitle = t.sessionId ? summaries[t.sessionId] : undefined;
            return (
              <button
                key={t.tabId}
                ref={node => {
                  if (node) tileRefs.current.set(t.tabId, node);
                  else tileRefs.current.delete(t.tabId);
                }}
                data-expose-tile
                data-selected={selected || undefined}
                tabIndex={selected ? 0 : -1}
                aria-label={`${t.title}, ${t.projectName}${needsYou ? ', needs attention' : ''}${t.stateLabel ? `, ${t.stateLabel}` : ''}`}
                onClick={() => onPick(t.dir, t.tabId)}
                onMouseEnter={() => setSel(i)}
                onFocus={() => setSel(i)}
                className="flex flex-col gap-1.5 rounded border p-3 text-left outline-none transition-[opacity,transform,border-color,box-shadow] duration-200 motion-reduce:transition-none"
                style={{
                  width: TILE_W,
                  borderColor: selected ? t.color : `${t.color}44`,
                  background: 'rgba(7,12,20,0.92)',
                  boxShadow: selected ? `0 0 14px ${t.color}55` : 'none',
                  opacity: entered ? (t.live ? 1 : 0.55) : 0,
                  transform: entered
                    ? selected
                      ? 'scale(1.02)'
                      : 'none'
                    : 'translateY(10px) scale(0.97)',
                  transitionDelay: entered
                    ? `${Math.min(i * 18, 300)}ms`
                    : '0ms',
                }}
              >
                <div className="flex w-full items-center gap-1.5 font-mono text-xs">
                  <span
                    className="inline-block h-2 w-2 shrink-0 rotate-45"
                    style={{
                      background: t.color,
                      boxShadow: `0 0 5px ${t.color}`,
                    }}
                  />
                  {t.harness !== 'shell' && (
                    <span style={{ color: t.color }}>
                      <HarnessGlyph harness={t.harness} size={11} />
                    </span>
                  )}
                  <span className="truncate" style={{ color: HUD.text }}>
                    {t.title}
                  </span>
                  <span
                    className="ml-auto truncate pl-2 text-[10px]"
                    style={{ color: `${t.color}B0` }}
                  >
                    {t.projectName}
                  </span>
                  {t.stateLabel && (
                    <span
                      data-expose-state={t.stateLabel}
                      className="shrink-0 pl-1.5 font-mono text-[10px]"
                      style={{ color: HUD.textDim }}
                    >
                      {t.stateLabel}
                    </span>
                  )}
                  {roadmapByTab[t.tabId] && (
                    <span
                      data-expose-roadmap-item
                      title={
                        roadmapByTab[t.tabId].inferred
                          ? 'inferred link'
                          : 'declared at launch'
                      }
                      className="max-w-[45%] shrink truncate pl-1.5 font-mono text-[10px]"
                      style={{ color: HUD.textMono }}
                    >
                      {roadmapByTab[t.tabId].inferred ? '▹' : '▸'}{' '}
                      {roadmapByTab[t.tabId].label}
                      {roadmapByTab[t.tabId].fraction
                        ? ` ${roadmapByTab[t.tabId].fraction}`
                        : ''}
                    </span>
                  )}
                  {needsYou && (
                    <span className="relative ml-1 inline-flex h-1.5 w-1.5 shrink-0">
                      <span
                        className="absolute inline-flex h-full w-full animate-ping rounded-full motion-reduce:animate-none"
                        style={{ background: HUD.amber, opacity: 0.6 }}
                      />
                      <span
                        className="relative inline-flex h-1.5 w-1.5 rounded-full"
                        style={{ background: HUD.amber }}
                      />
                    </span>
                  )}
                </div>
                {subtitle && (
                  <div
                    className="line-clamp-2 min-h-10 w-full text-sm leading-5"
                    style={{ color: `${t.color}B0` }}
                  >
                    {subtitle}
                  </div>
                )}
                <div
                  className="w-full whitespace-pre font-mono text-[9px] leading-[1.5]"
                  style={{
                    color: HUD.textDim,
                    minHeight: 54,
                    overflow: 'hidden',
                  }}
                >
                  {(t.sessionId ? previews[t.sessionId] : undefined)?.join('\n') ??
                    (t.live ? '…' : 'process ended — enter opens the tab')}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

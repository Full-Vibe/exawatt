'use client';

/**
 * Ribbon dogfood bench (2026-08-02 round). A manipulable reproduction rig
 * for the elastic ribbon's information-loss and motion findings: the real
 * TabStrip above a fake fixed-budget terminal stage, wired to the REAL
 * tab-ring/ordinal modules, with instrumentation the app cannot show —
 * per-tab render visibility, stage resize bursts, and a CSS-transition
 * counter per gesture. The production lab specimen stays untouched at
 * /hud-gallery/project-ribbon; this page exists to make failures visible
 * and countable, not to look good.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TabStrip } from '@/components/workspace/tab-strip';
import { DEFAULT_RIBBON_POLICY } from '@/components/workspace/project-ribbon-layout';
import { nextTabInRing, tabAtOrdinal } from '@/components/workspace/tab-ring';
import {
  WORKSPACE_HUD as HUD,
  withThemeAlpha,
} from '@/components/workspace/workspace-theme';
import type {
  Project,
  WorkspaceTab,
} from '@/components/workspace/use-workspace-state';
import {
  fleetAttention,
  mergeFleetAttention,
  type SessionAttentionSignal,
} from '@/components/workspace/session-status';
import type { CloneSessionTarget } from '@/components/workspace/session-clone';
import type { SessionDelegation } from '@/types/electron';

const COLORS = [
  '#66A3FF',
  '#FF3B8B',
  '#79F2A6',
  '#19E6FF',
  '#FFB02E',
  '#9B7BFF',
];

let benchSeq = 0;
function benchTab(title: string, cwd: string, fresh = false): WorkspaceTab {
  benchSeq += 1;
  const id = `bench-${benchSeq}`;
  return {
    id,
    durableSessionId: `durable-${id}`,
    harness: benchSeq % 3 === 0 ? 'claude' : 'codex',
    title: fresh ? 'Codex' : title,
    titleKind: fresh ? 'default' : 'operator',
    cwd,
    sessionId: `session-${id}`,
    harnessSessionId: `provider-${id}`,
    resumeState: 'live',
    lifecycle: 'running',
    exitCode: null,
    roadmapItemId: null,
    // fresh = never given work: excluded from summaries/engaged so the
    // dashed-ring state is exercisable on the acceptance instrument
    initialTask: fresh ? null : title,
  };
}

function benchProject(
  name: string,
  titles: string[],
  colorIndex: number,
  { freshTail = false }: { freshTail?: boolean } = {}
): Project {
  const dir = `/workspace/${name}`;
  const tabs = titles.map(title => benchTab(title, dir));
  if (freshTail) tabs.push(benchTab('', dir, true));
  return {
    dir,
    name,
    color: COLORS[colorIndex % COLORS.length],
    activeTabId: tabs[0]?.id ?? null,
    tabs,
  };
}

/** Jake's reported shape: three prior Projects holding ordinals 1–6, the
 *  active dense Project (5 Agents), then the one-Agent Switcheroo. */
function initialProjects(): Project[] {
  benchSeq = 0;
  return [
    benchProject('gpagent', ['Fix UTC boundary', 'Ship date audit'], 0),
    benchProject('cortex-ehr', ['MMHC conversation', 'RAF feature plan'], 1),
    benchProject('workmusic', ['Master the EP', 'Cover art pass'], 2),
    benchProject(
      'exawatt',
      [
        'VSCode-Like Theme Across Exawatt Surfaces',
        'Fix Sessions Rendering Across Every Altitude',
        'Define the Durable Initiative Model',
        'Review Keyboard Navigation and Focus',
        'Design Clear Subagent Activity Topology',
      ],
      3
    ),
    benchProject('switcheroo', ['Migrate billing hooks'], 4),
    benchProject('photo-generator', ['Localization expansion'], 5, {
      freshTail: true,
    }),
  ];
}

/** The real strip commonly carries delegated-child truth beside status.
 *  Keep one worst-case active tab in the bench so readability cannot pass by
 *  measuring a cleaner fixture than production. */
const BENCH_DELEGATION: Record<string, SessionDelegation> = {
  'session-bench-7': {
    ownTurn: 'available',
    blockedOn: null,
    children: [
      {
        id: 'bench-child-1',
        agentType: 'Explore',
        description: 'Audit the ribbon geometry',
        startedAt: 0,
      },
    ],
  },
};

/**
 * Clone to… targets, deliberately including the worst realistic case: a saved
 * High setup and the engine's own Medium default on the SAME model, so both
 * rows read `GPT-5.6 Codex`. That pair is what the operator hit — two rows he
 * could not tell apart, both highlighting at once — and it is the fixture the
 * bench keeps so the failure stays visible instead of only unit tested.
 */
const BENCH_CLONE_TARGETS: readonly CloneSessionTarget[] = [
  {
    id: 'agent:codex:gpt-5.6-sol:high',
    sourceId: 'codex-local',
    source: 'codex',
    modelId: 'gpt-5.6-sol',
    effort: 'high',
    label: 'GPT-5.6 Codex',
    detail: 'High',
    accessibleLabel: 'Codex, GPT-5.6 Codex, High',
  },
  {
    id: 'agent:codex:gpt-5.6-sol:medium',
    sourceId: 'codex-local',
    source: 'codex',
    modelId: 'gpt-5.6-sol',
    effort: 'medium',
    label: 'GPT-5.6 Codex',
    detail: 'Medium',
    accessibleLabel: 'Codex, GPT-5.6 Codex, Medium',
  },
  {
    id: 'agent:claude:opus-5:null',
    sourceId: 'claude-local',
    source: 'claude',
    modelId: 'claude-opus-5',
    effort: null,
    label: 'Opus 5',
    accessibleLabel: 'Claude Code, Opus 5',
  },
];

type TabVisibility = 'visible' | 'overflow-hidden' | 'not-rendered';

interface VisibilityRow {
  ordinal: number | null;
  tabId: string;
  project: string;
  title: string;
  visibility: TabVisibility;
  active: boolean;
}

/** The stage below the strip, standing in for the terminal pane. It renders
 *  a character grid from its measured box exactly like a fitted xterm would,
 *  counts every ResizeObserver delivery, and flashes on each one. */
function FakeTerminalStage({
  onResizeEvent,
}: {
  onResizeEvent: (size: { cols: number; rows: number }) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [grid, setGrid] = useState({ cols: 0, rows: 0 });
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const CELL_W = 8.4;
    const CELL_H = 17;
    const observer = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      const cols = Math.max(1, Math.floor(box.width / CELL_W));
      const rows = Math.max(1, Math.floor(box.height / CELL_H));
      setGrid(current =>
        current.cols === cols && current.rows === rows
          ? current
          : { cols, rows }
      );
      onResizeEvent({ cols, rows });
      setFlash(true);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(false), 300);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, [onResizeEvent]);

  const lines = useMemo(() => {
    const out: string[] = [];
    for (let row = 0; row < grid.rows; row += 1) {
      const stamp = `${String(row + 1).padStart(3, ' ')} │ `;
      out.push(
        (stamp + 'agent output '.repeat(20)).slice(0, Math.max(8, grid.cols))
      );
    }
    return out;
  }, [grid]);

  return (
    <div
      ref={ref}
      data-bench-stage
      data-bench-stage-rows={grid.rows}
      className="min-h-0 flex-1 overflow-hidden px-2 py-1 font-mono text-[11px] leading-[17px] transition-colors"
      style={{
        color: withThemeAlpha(HUD.textDim, 0.72),
        background: flash ? withThemeAlpha(HUD.magenta, 0.08) : 'transparent',
        boxShadow: flash
          ? `inset 0 0 0 1px ${withThemeAlpha(HUD.magenta, 0.8)}`
          : 'none',
      }}
    >
      {lines.map((line, index) => (
        <div key={index} className="whitespace-pre">
          {line}
        </div>
      ))}
    </div>
  );
}

export function RibbonDogfoodBench() {
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [activeDir, setActiveDir] = useState('/workspace/exawatt');
  const [benchWidth, setBenchWidth] = useState(1080);
  // The layout dial, live (operator, 2026-08-03: "I'll need to play with
  // it"). minTab is the hard floor; comfort is how much title the active
  // Project's tabs are entitled to before quiet Projects fold to protect it.
  const [minTab, setMinTab] = useState(DEFAULT_RIBBON_POLICY.minTabWidth);
  const [comfortTab, setComfortTab] = useState(
    DEFAULT_RIBBON_POLICY.comfortTabWidth
  );
  const layoutPolicy = useMemo(
    () => ({
      ...DEFAULT_RIBBON_POLICY,
      minTabWidth: minTab,
      comfortTabWidth: comfortTab,
    }),
    [comfortTab, minTab]
  );
  const [attention, setAttention] = useState<
    Record<string, SessionAttentionSignal>
  >({});
  // The bench drives the REAL strip, so it declares its fixture the same way
  // the workspace declares main's PTY channel: a complete fleet map.
  const benchAttention = useMemo(
    () => mergeFleetAttention(fleetAttention('ribbon-bench', attention)),
    [attention]
  );
  const [activity, setActivity] = useState<Record<string, boolean>>({});
  const [visibilityRows, setVisibilityRows] = useState<VisibilityRow[]>([]);
  const [resizeLog, setResizeLog] = useState<
    { at: number; cols: number; rows: number }[]
  >([]);
  const [transitionCount, setTransitionCount] = useState(0);
  const gestureTransitions = useRef(0);
  const [lastGestureTransitions, setLastGestureTransitions] = useState(0);
  const benchRef = useRef<HTMLDivElement>(null);

  const engaged = useMemo(
    () =>
      Object.fromEntries(
        projects.flatMap(project =>
          project.tabs
            .filter(item => item.initialTask !== null)
            .map(item => [item.sessionId ?? '', true])
        )
      ),
    [projects]
  );
  const summaries = useMemo(
    () =>
      Object.fromEntries(
        projects.flatMap(project =>
          project.tabs
            .filter(item => item.initialTask !== null)
            .map(item => [item.durableSessionId, item.title])
        )
      ),
    [projects]
  );

  const activeProject = projects.find(project => project.dir === activeDir);
  const activeTab = activeProject?.tabs.find(
    item => item.id === activeProject.activeTabId
  );

  // ── gesture instrumentation ──────────────────────────────────────────
  useEffect(() => {
    const node = benchRef.current;
    if (!node) return;
    const onTransition = (event: Event) => {
      const property = (event as TransitionEvent).propertyName;
      if (property !== 'transform' && property !== 'opacity') return;
      gestureTransitions.current += 1;
      setTransitionCount(current => current + 1);
    };
    node.addEventListener('transitionrun', onTransition, true);
    return () => node.removeEventListener('transitionrun', onTransition, true);
  }, []);

  const beginGesture = useCallback(() => {
    gestureTransitions.current = 0;
    setTimeout(() => {
      setLastGestureTransitions(gestureTransitions.current);
    }, 600);
  }, []);

  const onStageResize = useCallback(
    (size: { cols: number; rows: number }) => {
      setResizeLog(current =>
        [...current, { at: Date.now(), ...size }].slice(-200)
      );
    },
    []
  );
  const recentResizeBurst = useMemo(() => {
    const now = Date.now();
    return resizeLog.filter(entry => now - entry.at < 1500).length;
  }, [resizeLog]);

  // ── DOM-truth visibility readout ─────────────────────────────────────
  const recomputeVisibility = useCallback(() => {
    const strip = benchRef.current?.querySelector(
      '[data-workspace-tab-strip]'
    );
    const allTabs = projects.flatMap(project =>
      project.tabs.map(tab => ({ project, tab }))
    );
    const rows: VisibilityRow[] = allTabs.map(({ project, tab }, index) => {
      const ordinal =
        index < 8
          ? index + 1
          : index === allTabs.length - 1 && allTabs.length >= 9
            ? 9
            : null;
      const node = strip?.querySelector(
        `[data-ribbon-key="tab:${tab.id}"]`
      ) as HTMLElement | null;
      const visibility: TabVisibility = !node
        ? 'not-rendered'
        : node.getAttribute('aria-hidden') === 'true'
          ? 'overflow-hidden'
          : 'visible';
      return {
        ordinal,
        tabId: tab.id,
        project: project.name,
        title: tab.title,
        visibility,
        active:
          project.dir === activeDir && tab.id === project.activeTabId,
      };
    });
    setVisibilityRows(current =>
      JSON.stringify(current) === JSON.stringify(rows) ? current : rows
    );
  }, [activeDir, projects]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      // after the ribbon's measurement/layout effects settle
      const raf2 = requestAnimationFrame(recomputeVisibility);
      return () => cancelAnimationFrame(raf2);
    });
    const settle = setTimeout(recomputeVisibility, 350);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(settle);
    };
  }, [recomputeVisibility, benchWidth, attention, activity]);

  // ── verbs (the real modules, not re-implementations) ─────────────────
  const selectTab = useCallback(
    (dir: string, tabId: string) => {
      beginGesture();
      setActiveDir(dir);
      setProjects(current =>
        current.map(project =>
          project.dir === dir ? { ...project, activeTabId: tabId } : project
        )
      );
    },
    [beginGesture]
  );

  const ringStep = useCallback(
    (delta: 1 | -1) => {
      const target = nextTabInRing(projects, activeDir, delta);
      if (!target) return;
      if (target.tab) selectTab(target.dir, target.tab.id);
      else {
        beginGesture();
        setActiveDir(target.dir);
      }
    },
    [activeDir, beginGesture, projects, selectTab]
  );

  const ordinalJump = useCallback(
    (index: number) => {
      const target = tabAtOrdinal(projects, index);
      if (target) selectTab(target.dir, target.tab.id);
    },
    [projects, selectTab]
  );

  const toggleBell = useCallback((sessionId: string | null) => {
    if (!sessionId) return;
    setAttention(current => {
      const next = { ...current };
      if (next[sessionId]) delete next[sessionId];
      else next[sessionId] = { kind: 'bell', since: Date.now() };
      return next;
    });
  }, []);

  const toggleWorking = useCallback((sessionId: string | null) => {
    if (!sessionId) return;
    setActivity(current => ({ ...current, [sessionId]: !current[sessionId] }));
  }, []);

  const toggleStopped = useCallback((tabId: string) => {
    setProjects(current =>
      current.map(project => ({
        ...project,
        tabs: project.tabs.map(item =>
          item.id !== tabId
            ? item
            : item.resumeState === 'live'
              ? {
                  ...item,
                  sessionId: null,
                  resumeState: 'ended-resumable' as const,
                  lifecycle: 'exited' as const,
                }
              : {
                  ...item,
                  sessionId: `session-${item.id}`,
                  resumeState: 'live' as const,
                  lifecycle: 'running' as const,
                }
        ),
      }))
    );
  }, []);

  const reset = useCallback(() => {
    setProjects(initialProjects());
    setActiveDir('/workspace/exawatt');
    setAttention({});
    setActivity({});
    setResizeLog([]);
    setTransitionCount(0);
    setLastGestureTransitions(0);
  }, []);

  const flatTabs = projects.flatMap(project =>
    project.tabs.map(tab => ({ project, tab }))
  );

  return (
    <TooltipProvider>
      <div className="flex w-full flex-col gap-4">
        {/* ── the workspace replica: chrome above a flex-1 stage ── */}
        <div
          ref={benchRef}
          data-bench-root
          className="flex flex-col overflow-hidden rounded-lg border"
          style={{
            width: benchWidth,
            height: 380,
            color: HUD.text,
            background: HUD.bg.deep,
            borderColor: HUD.strokeFaint,
          }}
        >
          <div
            className="flex shrink-0 items-start gap-2 border-b px-3 py-2"
            style={{ borderColor: HUD.strokeFaint }}
          >
            <div className="min-w-0 flex-1">
              <TabStrip
                layoutPolicy={layoutPolicy}
                projects={projects}
                activeDir={activeDir}
                pinnedTabId={null}
                summaries={summaries}
                attention={benchAttention}
                activity={activity}
                engaged={engaged}
                delegation={BENCH_DELEGATION}
                cloneTargets={BENCH_CLONE_TARGETS}
                onCloneTab={() => undefined}
                feedbackEnabled
                onRateContext={async () => true}
                onSelectProject={index => {
                  const project = projects[index];
                  if (!project) return;
                  beginGesture();
                  setActiveDir(project.dir);
                }}
                onSelectTab={selectTab}
                onCloseTab={tabId => {
                  beginGesture();
                  setProjects(current =>
                    current.map(project => {
                      const tabs = project.tabs.filter(
                        item => item.id !== tabId
                      );
                      return tabs.length === project.tabs.length
                        ? project
                        : {
                            ...project,
                            tabs,
                            activeTabId: tabs[0]?.id ?? null,
                          };
                    })
                  );
                }}
                onRenameTab={() => undefined}
                onRenameProject={() => undefined}
                onSetProjectColor={() => undefined}
                onReorderTab={(tabId, targetTabId, place) => {
                  beginGesture();
                  setProjects(current =>
                    current.map(project => {
                      const from = project.tabs.findIndex(
                        item => item.id === tabId
                      );
                      const at = project.tabs.findIndex(
                        item => item.id === targetTabId
                      );
                      if (from === -1 || at === -1) return project;
                      const tabs = [...project.tabs];
                      const [moved] = tabs.splice(from, 1);
                      const anchor = tabs.findIndex(
                        item => item.id === targetTabId
                      );
                      tabs.splice(
                        place === 'before' ? anchor : anchor + 1,
                        0,
                        moved
                      );
                      return { ...project, tabs };
                    })
                  );
                }}
                onReorderProject={(dir, targetDir, place) => {
                  beginGesture();
                  setProjects(current => {
                    const from = current.findIndex(
                      project => project.dir === dir
                    );
                    if (from === -1) return current;
                    const next = [...current];
                    const [moved] = next.splice(from, 1);
                    const anchor = next.findIndex(
                      project => project.dir === targetDir
                    );
                    if (anchor === -1) return current;
                    next.splice(
                      place === 'before' ? anchor : anchor + 1,
                      0,
                      moved
                    );
                    return next;
                  });
                }}
              />
            </div>
          </div>
          <FakeTerminalStage onResizeEvent={onStageResize} />
        </div>

        {/* ── controls ── */}
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
          <button
            type="button"
            data-bench-ring-prev
            className="rounded border border-white/15 px-2 py-1 hover:bg-white/5"
            onClick={() => ringStep(-1)}
          >
            ⌘⇧[ ring prev
          </button>
          <button
            type="button"
            data-bench-ring-next
            className="rounded border border-white/15 px-2 py-1 hover:bg-white/5"
            onClick={() => ringStep(1)}
          >
            ⌘⇧] ring next
          </button>
          {Array.from({ length: 9 }, (_, index) => (
            <button
              key={index}
              type="button"
              data-bench-ordinal={index + 1}
              className="rounded border border-white/15 px-1.5 py-1 hover:bg-white/5"
              onClick={() => ordinalJump(index)}
            >
              ⌘{index + 1}
            </button>
          ))}
          <button
            type="button"
            data-bench-reset
            className="rounded border border-white/15 px-2 py-1 hover:bg-white/5"
            onClick={reset}
          >
            reset
          </button>
          <label className="ml-2 flex items-center gap-2">
            width {benchWidth}px
            <input
              type="range"
              min={680}
              max={1480}
              step={20}
              value={benchWidth}
              onChange={event => setBenchWidth(Number(event.target.value))}
            />
          </label>
          <label className="flex items-center gap-2">
            min tab {minTab}px
            <input
              type="range"
              data-bench-min-tab
              min={72}
              max={420}
              step={2}
              value={minTab}
              onChange={event => {
                const next = Number(event.target.value);
                setMinTab(next);
                setComfortTab(current => Math.max(current, next));
              }}
            />
          </label>
          <label className="flex items-center gap-2">
            fold to protect {comfortTab}px
            <input
              type="range"
              data-bench-comfort-tab
              min={72}
              max={440}
              step={2}
              value={comfortTab}
              onChange={event =>
                setComfortTab(Math.max(minTab, Number(event.target.value)))
              }
            />
          </label>
        </div>
        <p
          className="max-w-[80ch] font-mono text-[11px] leading-relaxed"
          style={{ color: 'rgba(160,190,220,0.6)' }}
        >
          Leave “fold to protect” equal to “min tab” and the row shrinks tabs
          first, then scrolls the last inch. Raise it and quiet Projects fold
          into counted containers sooner so tabs keep their titles and nothing
          scrolls. Lower “min tab” for shorter titles that fit more.
        </p>

        {/* ── instrumentation readout ── */}
        <div
          className="flex gap-6 font-mono text-[11px]"
          style={{ color: 'rgba(160,190,220,0.8)' }}
        >
          <span data-bench-active>
            active: {activeProject?.name ?? '—'} /{' '}
            {activeTab?.title ?? '(none)'}
          </span>
          <span data-bench-resize-count={resizeLog.length}>
            stage resizes: {resizeLog.length} (burst {recentResizeBurst})
          </span>
          <span data-bench-transitions={transitionCount}>
            transitions total: {transitionCount} · last gesture:{' '}
            {lastGestureTransitions}
          </span>
        </div>

        <table className="w-full max-w-3xl border-collapse font-mono text-[11px]">
          <thead>
            <tr
              className="text-left"
              style={{ color: 'rgba(160,190,220,0.6)' }}
            >
              <th className="py-1 pr-3">⌘</th>
              <th className="py-1 pr-3">project</th>
              <th className="py-1 pr-3">tab</th>
              <th className="py-1 pr-3">rendered</th>
              <th className="py-1 pr-3">state</th>
            </tr>
          </thead>
          <tbody data-bench-visibility>
            {visibilityRows.map(row => {
              const flat = flatTabs.find(
                entry => entry.tab.id === row.tabId
              );
              const sessionId = flat?.tab.sessionId ?? null;
              return (
                <tr
                  key={row.tabId}
                  data-bench-row={row.tabId}
                  data-bench-vis={row.visibility}
                  style={{
                    color: row.active
                      ? '#fff'
                      : row.visibility === 'visible'
                        ? 'rgba(160,190,220,0.85)'
                        : '#FF3B8B',
                  }}
                >
                  <td className="py-0.5 pr-3">{row.ordinal ?? '·'}</td>
                  <td className="py-0.5 pr-3">{row.project}</td>
                  <td className="py-0.5 pr-3">
                    {row.title}
                    {row.active ? ' ◀ active' : ''}
                  </td>
                  <td className="py-0.5 pr-3">{row.visibility}</td>
                  <td className="py-0.5 pr-3">
                    <button
                      type="button"
                      className="mr-1 rounded border border-white/15 px-1 hover:bg-white/5"
                      onClick={() => toggleBell(sessionId)}
                    >
                      {sessionId && attention[sessionId] ? 'bell✓' : 'bell'}
                    </button>
                    <button
                      type="button"
                      className="mr-1 rounded border border-white/15 px-1 hover:bg-white/5"
                      onClick={() => toggleWorking(sessionId)}
                    >
                      {sessionId && activity[sessionId] ? 'work✓' : 'work'}
                    </button>
                    <button
                      type="button"
                      className="rounded border border-white/15 px-1 hover:bg-white/5"
                      onClick={() => toggleStopped(row.tabId)}
                    >
                      {flat?.tab.resumeState === 'live' ? 'stop' : 'revive'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </TooltipProvider>
  );
}

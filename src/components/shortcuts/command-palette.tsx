'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
} from '@/components/ui/command';
import { shortcutRegistry, formatShortcutKeys } from '@/lib/shortcuts';
import {
  LayoutDashboard,
  LayoutGrid,
  SquareTerminal,
  Settings,
  HelpCircle,
  Server,
  LayoutPanelTop,
  Milestone,
  PenLine,
  Palette,
  Columns2,
  BellRing,
  XCircle,
  Map as MapIcon,
  FolderOpen,
  LogIn,
  History,
  RotateCw,
  RotateCcw,
  type LucideIcon,
} from 'lucide-react';
import {
  requestSessionJump,
  requestLaunch,
  requestOpenProject,
  requestProjectPicker,
  requestAgentComposer,
  RENAME_ACTIVE_EVENT,
  TOGGLE_SPLIT_EVENT,
  JUMP_ATTENTION_EVENT,
  CLOSE_ACTIVE_EVENT,
  REOPEN_CLOSED_EVENT,
  OPEN_ROADMAP_EVENT,
} from '@/components/workspace/session-jump';
import {
  buildSessionRows,
  extractRecentProjects,
} from '@/components/workspace/switcher-rows';
import type {
  SessionRow,
  SessionRowStatus,
  RecentProject,
} from '@/components/workspace/switcher-rows';
import {
  surfacesByTier,
  resolveSurfaceHref,
  type AppSurface,
} from '@/components/nav/surfaces';
import { HarnessGlyph } from '@/components/workspace/harness-icons';
import {
  AttentionMarker,
  SESSION_GLYPH_LABEL,
  SessionStatusGlyph,
} from '@/components/workspace/status-glyphs';
import { HARNESS_META, HARNESS_ORDER } from '@/components/workspace/harnesses';
import {
  AGENT_SOURCE_META,
  AGENT_SOURCE_ORDER,
  type AgentSourceId,
} from '@/components/workspace/agent-sources';
import { listProjects, rebindProjectPath } from '@/lib/projects/registry';
import type { Project } from '@/lib/projects/registry';
import { HUD } from '@/components/hud';
import type { ShortcutKeys } from '@/types/shortcuts';
import type { CommandAltitude } from '@/components/nav/command-altitude';
import type { PtyHarness, ClosedSessionEntry } from '@/types/electron';
import { useShortcutRegistryVersion } from './use-effective-shortcut';
import { useCommandNavigation } from '@/components/nav/command-navigation-provider';
import {
  rankRecents,
  readPaletteUses,
  recordPaletteUse,
} from './palette-recents';

/** Shared live-status language with palette-specific HUD colors. */
const STATUS_META: Record<SessionRowStatus, { label: string; color: string }> =
  {
    'needs-you': { label: 'needs you', color: HUD.amber },
    working: {
      label: SESSION_GLYPH_LABEL.working,
      color: HUD.cyan2,
    },
    done: { label: SESSION_GLYPH_LABEL.done, color: HUD.green },
    fresh: { label: SESSION_GLYPH_LABEL.fresh, color: HUD.idle },
    quiet: { label: SESSION_GLYPH_LABEL.quiet, color: HUD.idle },
    exited: { label: 'exited', color: HUD.textDim },
  };

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenHelpModal: () => void;
}

interface CommandItem {
  id: string;
  label: string;
  value: string;
  shortcut?: ShortcutKeys;
  icon: React.ComponentType<{ className?: string }>;
  onSelect: () => void;
}

/** palette icon per manifest surface — the manifest stays render-free */
const SURFACE_ICONS: Record<AppSurface['id'], LucideIcon> = {
  terminal: SquareTerminal,
  sessions: LayoutPanelTop,
  spatial: MapIcon,
  settings: Settings,
  dashboard: LayoutDashboard,
  board: LayoutGrid,
  fleet: Server,
};

export function CommandPalette({
  open,
  onOpenChange,
  onOpenHelpModal,
}: CommandPaletteProps) {
  const router = useRouter();
  const { navigateCommandSurface, activateCommandAltitude } =
    useCommandNavigation();
  const shortcutVersion = useShortcutRegistryVersion();
  const newProjectShortcut = shortcutRegistry.getEffectiveKeys(
    'workspace-new-project'
  );
  const [search, setSearch] = useState('');
  // live sessions for the switcher (S2) — desktop app only, fetched fresh
  // each time the palette opens
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  // known Projects from the durable registry (S5) — browse/open one even with
  // no live session; fetched fresh each time the palette opens
  const [projects, setProjects] = useState<Project[]>([]);
  // local recency record (D8): Projects from the persisted layout, so a
  // Project with no open tabs — or an unreachable registry — stays reachable
  const [recents, setRecents] = useState<RecentProject[]>([]);
  // the registry read failed (signed out / offline): say so instead of
  // silently rendering an empty group
  const [registryFailed, setRegistryFailed] = useState(false);
  // workspace verbs only make sense where the workspace is (S3): sampled
  // when the palette opens
  const [onWorkspaceRoute, setOnWorkspaceRoute] = useState(false);
  // surface-contextual verbs (D9): sampled when the palette opens
  const [onSpatialRoute, setOnSpatialRoute] = useState(false);
  // frecency-ranked ids for the Recent group (D9)
  const [recentIds, setRecentIds] = useState<string[]>([]);
  // Recently-closed Sessions (D23): soft-closed tabs stay reopenable here
  const [closedSessions, setClosedSessions] = useState<ClosedSessionEntry[]>(
    []
  );
  const inElectron = typeof window !== 'undefined' && !!window.electron?.pty;

  // Reset search AND session rows when closing — stale rows on reopen can
  // list dead sessions or wrong statuses until the refetch lands, and Enter
  // on one would silently do nothing
  useEffect(() => {
    if (!open) {
      setSearch('');
      setSessions([]);
      setProjects([]);
      setRecents([]);
      setClosedSessions([]);
      setRegistryFailed(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setOnWorkspaceRoute(window.location.pathname.startsWith('/workspace'));
    setOnSpatialRoute(window.location.pathname.startsWith('/fleet/spatial'));
    setRecentIds(rankRecents(readPaletteUses(), Date.now()));
    const pty = window.electron?.pty;
    if (!pty) return;
    let cancelled = false;
    void (async () => {
      const [list, layout] = await Promise.all([
        pty.list(),
        window.electron?.workspace?.load() ?? Promise.resolve(null),
      ]);
      if (cancelled) return;
      setSessions(buildSessionRows(list, layout, Date.now()));
      setRecents(extractRecentProjects(layout));
      const closed = (await pty.closedSessions?.()) ?? [];
      if (!cancelled) setClosedSessions(closed.slice(0, 8));
    })();
    // durable Projects (S5) — needs an authed Supabase session; on failure the
    // group falls back to local recents and shows a sign-in row (D8)
    void listProjects()
      .then(p => {
        if (!cancelled) setProjects(p);
      })
      .catch(() => {
        if (!cancelled) setRegistryFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleSelect = useCallback(
    (callback: () => void) => {
      onOpenChange(false);
      // Small delay to let the dialog close animation start
      setTimeout(callback, 50);
    },
    [onOpenChange]
  );

  /** switcher/launch requests land in the workspace: instantly when it is
   *  mounted (live event), or on mount after navigation (pending slot) */
  const inWorkspace = () => window.location.pathname.startsWith('/workspace');
  const openSession = useCallback(
    (id: string) =>
      handleSelect(() => {
        requestSessionJump(id);
        if (!inWorkspace()) navigateCommandSurface('/workspace');
      }),
    [handleSelect, navigateCommandSurface]
  );
  const openAgentComposer = useCallback(
    (source: AgentSourceId) =>
      handleSelect(() => {
        requestAgentComposer(source);
        if (!inWorkspace()) navigateCommandSurface('/workspace');
      }),
    [handleSelect, navigateCommandSurface]
  );
  const launchHarness = useCallback(
    (harness: PtyHarness) =>
      handleSelect(() => {
        requestLaunch(harness);
        if (!inWorkspace()) navigateCommandSurface('/workspace');
      }),
    [handleSelect, navigateCommandSurface]
  );
  /** open a known Project (⌘K Projects): if its directory is missing on this
   *  machine (a synced Project from another machine), prompt to locate it and
   *  re-bind the registry; then the workspace activates it without spawning */
  const openProject = useCallback(
    (p: Project) =>
      handleSelect(async () => {
        let dir = p.root_path;
        if (!dir) return;
        const exists = await window.electron?.dialog?.pathExists?.(dir);
        if (exists === false) {
          const picked = await window.electron?.dialog?.openDirectory();
          if (!picked) return; // cancelled — leave it unavailable this time
          await rebindProjectPath(p.id, picked).catch(() => {});
          dir = picked;
        }
        requestOpenProject(dir);
        if (!inWorkspace()) navigateCommandSurface('/workspace');
      }),
    [handleSelect, navigateCommandSurface]
  );
  /** open a Project known only from the local recency record (registry
   *  unreachable or the row predates it) — same open path, no re-bind step */
  const openRecentProject = useCallback(
    (dir: string) =>
      handleSelect(() => {
        requestOpenProject(dir);
        if (!inWorkspace()) navigateCommandSurface('/workspace');
      }),
    [handleSelect, navigateCommandSurface]
  );
  /** open the Project chooser — the palette twin of ⌘N */
  const addProject = useCallback(
    () =>
      handleSelect(() => {
        requestProjectPicker();
        if (!inWorkspace()) navigateCommandSurface('/workspace');
      }),
    [handleSelect, navigateCommandSurface]
  );

  /** surface-contextual verb (D9): flip the spatial projection in place */
  const toggleProjection = useCallback(
    () =>
      handleSelect(() => {
        const params = new URLSearchParams(window.location.search);
        const next =
          params.get('projection') === 'fixed-angle'
            ? 'top-down'
            : 'fixed-angle';
        params.set('projection', next);
        router.push(`${window.location.pathname}?${params.toString()}`);
      }),
    [handleSelect, router]
  );

  /** workspace verbs (S3): the palette is the discoverable face of the
   *  ⌘-chords — each row fires the same event the chord does */
  const dispatch = useCallback(
    (event: string) =>
      handleSelect(() => window.dispatchEvent(new CustomEvent(event))),
    [handleSelect]
  );
  const workspaceItems = useMemo(() => {
    void shortcutVersion;
    return [
      {
        id: 'ws-rename',
        label: 'Rename the active tab',
        value: 'rename tab title active',
        shortcut: shortcutRegistry.getEffectiveKeys('workspace-rename'),
        icon: PenLine,
        onSelect: () => dispatch(RENAME_ACTIVE_EVENT),
      },
      {
        id: 'ws-color',
        label: 'Change the project color',
        value: 'color project swatch recolor palette hue',
        icon: Palette,
        // the inline rename editor carries the swatch row — same surface
        onSelect: () => dispatch(RENAME_ACTIVE_EVENT),
      },
      {
        id: 'ws-split',
        label: 'Split: pin / unpin the active tab',
        value: 'split pane pin unpin side by side watch',
        shortcut: shortcutRegistry.getEffectiveKeys('workspace-split'),
        icon: Columns2,
        onSelect: () => dispatch(TOGGLE_SPLIT_EVENT),
      },
      {
        id: 'ws-jump',
        label: 'Jump to the session needing you',
        value: 'jump attention needs you blocked waiting',
        shortcut: shortcutRegistry.getEffectiveKeys('workspace-jump-attention'),
        icon: BellRing,
        onSelect: () => dispatch(JUMP_ATTENTION_EVENT),
      },
      {
        id: 'ws-roadmap',
        label: 'Open the Project roadmap',
        value: 'roadmap plan queue milestones next up shipped blocked sessions',
        shortcut: shortcutRegistry.getEffectiveKeys('workspace-roadmap'),
        icon: Milestone,
        onSelect: () => dispatch(OPEN_ROADMAP_EVENT),
      },
      {
        id: 'ws-close',
        label: 'Close the active tab or empty Project',
        value: 'close tab agent empty project kill session end',
        shortcut: shortcutRegistry.getEffectiveKeys('workspace-close-tab'),
        icon: XCircle,
        onSelect: () => dispatch(CLOSE_ACTIVE_EVENT),
      },
    ];
  }, [dispatch, shortcutVersion]);

  // Navigation rows derive from the manifest (ENG-016 D8): the palette, the
  // go-chords, and the header must always agree on names and targets. Legacy
  // surfaces render in their own group at the bottom.
  const surfaceItem = useCallback(
    (s: AppSurface): CommandItem => {
      void shortcutVersion;
      return {
        id: `nav-${s.id}`,
        label: `Go to ${s.name}`,
        value: `go ${s.name} ${s.keywords.join(' ')}`,
        icon: SURFACE_ICONS[s.id],
        shortcut: shortcutRegistry.getEffectiveKeys(
          s.gestureShortcutId ?? s.shortcutId
        ),
        onSelect: () =>
          handleSelect(() => {
            if (s.tier === 'spine') {
              activateCommandAltitude(s.id as CommandAltitude);
            } else {
              navigateCommandSurface(resolveSurfaceHref(s));
            }
          }),
      };
    },
    [
      activateCommandAltitude,
      handleSelect,
      navigateCommandSurface,
      shortcutVersion,
    ]
  );
  const navigationItems = useMemo<CommandItem[]>(
    () =>
      [...surfacesByTier('spine'), ...surfacesByTier('app')].map(surfaceItem),
    [surfaceItem]
  );
  const legacyItems = useMemo<CommandItem[]>(
    () => surfacesByTier('legacy').map(surfaceItem),
    [surfaceItem]
  );
  const actionItems = useMemo<CommandItem[]>(() => {
    void shortcutVersion;
    return [
      {
        id: 'action-help',
        label: 'Keyboard Shortcuts',
        value: 'keyboard shortcuts help keys hotkeys cheat sheet',
        icon: HelpCircle,
        shortcut: shortcutRegistry.getEffectiveKeys('help-modal'),
        onSelect: () => handleSelect(onOpenHelpModal),
      },
    ];
  }, [handleSelect, onOpenHelpModal, shortcutVersion]);

  // Recent group (D9): resolve frecency ids against everything currently
  // offerable. Live sessions are excluded on purpose — the Sessions group
  // already ranks needs-you first.
  interface RecentCandidate {
    label: string;
    icon?: React.ComponentType<{ className?: string }>;
    harness?: PtyHarness;
    color?: string;
    onSelect: () => void;
  }
  const recentRows = useMemo(() => {
    const candidates = new Map<string, RecentCandidate>();
    for (const item of [...navigationItems, ...legacyItems, ...actionItems]) {
      candidates.set(item.id, {
        label: item.label,
        icon: item.icon,
        onSelect: item.onSelect,
      });
    }
    if (inElectron) {
      for (const h of HARNESS_ORDER) {
        candidates.set(`launch:${h}`, {
          label:
            h === 'shell'
              ? 'Open shell in the active Project'
              : `Start Agent with ${HARNESS_META[h].label}`,
          harness: h,
          onSelect: () =>
            h === 'shell' ? launchHarness(h) : openAgentComposer(h),
        });
      }
      for (const p of projects) {
        if (!p.root_path) continue;
        candidates.set(`project:${p.root_path}`, {
          label: p.name,
          color: p.color ?? undefined,
          onSelect: () => openProject(p),
        });
      }
      for (const r of recents) {
        if (candidates.has(`project:${r.dir}`)) continue;
        candidates.set(`project:${r.dir}`, {
          label: r.name,
          color: r.color,
          onSelect: () => openRecentProject(r.dir),
        });
      }
      if (onWorkspaceRoute) {
        for (const w of workspaceItems) {
          candidates.set(w.id, {
            label: w.label,
            icon: w.icon,
            onSelect: w.onSelect,
          });
        }
      }
      if (onSpatialRoute) {
        candidates.set('spatial-projection', {
          label: 'Toggle projection (top-down ↔ angled)',
          icon: RotateCw,
          onSelect: toggleProjection,
        });
      }
    }
    return recentIds.flatMap(id => {
      const c = candidates.get(id);
      return c ? [{ id, ...c }] : [];
    });
  }, [
    navigationItems,
    legacyItems,
    actionItems,
    inElectron,
    projects,
    recents,
    onWorkspaceRoute,
    onSpatialRoute,
    workspaceItems,
    launchHarness,
    openAgentComposer,
    openProject,
    openRecentProject,
    toggleProjection,
    recentIds,
  ]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Type a command or search..."
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {!search && recentRows.length > 0 && (
          <>
            <CommandGroup heading="Recent">
              {recentRows.map(row => (
                <CommandItem
                  key={`recent-use-${row.id}`}
                  value={`recent ${row.id}`}
                  onSelect={() => {
                    recordPaletteUse(row.id);
                    row.onSelect();
                  }}
                >
                  {row.icon ? (
                    <row.icon className="mr-2 h-4 w-4" />
                  ) : row.harness ? (
                    <span
                      className="mr-2 shrink-0"
                      style={{ color: HARNESS_META[row.harness].color }}
                    >
                      <HarnessGlyph harness={row.harness} size={13} />
                    </span>
                  ) : row.color ? (
                    <span
                      className="mr-2 inline-block h-3.5 w-[3px] shrink-0 rounded-full"
                      style={{ background: row.color }}
                    />
                  ) : (
                    <History className="mr-2 h-4 w-4" />
                  )}
                  <span className="truncate">{row.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {inElectron && sessions.length > 0 && (
          <>
            <CommandGroup heading="Sessions">
              {sessions.map(s => {
                const status = STATUS_META[s.status];
                return (
                  <CommandItem
                    key={s.id}
                    value={`${s.searchValue} ${s.id}`}
                    onSelect={() => openSession(s.id)}
                    data-session-id={s.id}
                  >
                    <span
                      className="mr-2 inline-block h-3.5 w-[3px] shrink-0 rounded-full"
                      style={{
                        background: s.color,
                        boxShadow: `0 0 5px ${s.color}`,
                      }}
                    />
                    {s.harness !== 'shell' && (
                      <span
                        className="mr-1.5 shrink-0"
                        style={{ color: s.color }}
                      >
                        <HarnessGlyph harness={s.harness} size={12} />
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate">
                      {s.title}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {s.projectName}
                        {s.roadmapItemId ? ` · ${s.roadmapItemId}` : ''}
                        {s.subtitle ? ` · ${s.subtitle}` : ''}
                      </span>
                    </span>
                    <span
                      className="ml-3 inline-flex shrink-0 items-center gap-1.5 font-mono text-xs"
                      data-session-status={s.status}
                      style={{ color: status.color }}
                    >
                      {s.status === 'needs-you' ? (
                        <AttentionMarker />
                      ) : s.status !== 'exited' ? (
                        <SessionStatusGlyph state={s.status} />
                      ) : null}
                      <span>{status.label}</span>
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {inElectron && (
          <>
            <CommandGroup heading="Start Agent">
              {AGENT_SOURCE_ORDER.map(source => (
                <CommandItem
                  key={`launch-${source}`}
                  value={`start agent ${AGENT_SOURCE_META[source].label} new session task`}
                  onSelect={() => {
                    recordPaletteUse(`launch:${source}`);
                    openAgentComposer(source);
                  }}
                >
                  <span
                    className="mr-2 shrink-0"
                    style={{ color: AGENT_SOURCE_META[source].color }}
                  >
                    <HarnessGlyph harness={source} size={13} />
                  </span>
                  <span>
                    Start Agent with {AGENT_SOURCE_META[source].label}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Tools">
              <CommandItem
                value="open shell terminal active project"
                onSelect={() => launchHarness('shell')}
              >
                <SquareTerminal className="mr-2 h-3.5 w-3.5 shrink-0" />
                <span>Open shell in the active Project</span>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {inElectron && (
          <>
            <CommandGroup heading="Projects">
              {projects
                .filter(p => p.root_path)
                .map(p => (
                  <CommandItem
                    key={`project-${p.id}`}
                    value={`project open ${p.name} ${p.root_path ?? ''}`}
                    onSelect={() => {
                      recordPaletteUse(`project:${p.root_path}`);
                      openProject(p);
                    }}
                  >
                    <span
                      className="mr-2 inline-block h-3.5 w-[3px] shrink-0 rounded-full"
                      style={{ background: p.color ?? HUD.textDim }}
                    />
                    <span className="truncate">{p.name}</span>
                    <span
                      className="ml-auto truncate pl-2 text-[10px]"
                      style={{ color: HUD.textDim }}
                    >
                      {p.root_path}
                    </span>
                  </CommandItem>
                ))}
              {/* local recency fallback (D8): Projects the registry doesn't
                  cover right now — closed tabs, signed out, offline */}
              {recents
                .filter(r => !projects.some(p => p.root_path === r.dir))
                .map(r => (
                  <CommandItem
                    key={`recent-${r.dir}`}
                    value={`project open recent ${r.name} ${r.dir}`}
                    onSelect={() => {
                      recordPaletteUse(`project:${r.dir}`);
                      openRecentProject(r.dir);
                    }}
                  >
                    <span
                      className="mr-2 inline-block h-3.5 w-[3px] shrink-0 rounded-full"
                      style={{ background: r.color ?? HUD.textDim }}
                    />
                    <span className="truncate">{r.name}</span>
                    <span
                      className="ml-auto truncate pl-2 text-[10px]"
                      style={{ color: HUD.textDim }}
                    >
                      {r.dir}
                    </span>
                  </CommandItem>
                ))}
              {registryFailed && (
                <CommandItem
                  value="project sign in sync account"
                  onSelect={() => handleSelect(() => router.push('/sign-in'))}
                >
                  <LogIn className="mr-2 h-3.5 w-3.5 shrink-0" />
                  <span>Sign in to sync Projects across machines</span>
                </CommandItem>
              )}
              <CommandItem
                value="project add new open folder directory browse"
                onSelect={addProject}
              >
                <FolderOpen className="mr-2 h-3.5 w-3.5 shrink-0" />
                <span>Add project…</span>
                {newProjectShortcut && (
                  <CommandShortcut>
                    {formatShortcutKeys(newProjectShortcut)}
                  </CommandShortcut>
                )}
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
          </>
        )}
        {inElectron && onWorkspaceRoute && (
          <>
            <CommandGroup heading="Workspace">
              {workspaceItems.map(item => (
                <CommandItem
                  key={item.id}
                  value={item.value}
                  onSelect={() => {
                    recordPaletteUse(item.id);
                    item.onSelect();
                  }}
                >
                  <item.icon className="mr-2 h-4 w-4" />
                  <span>{item.label}</span>
                  {item.shortcut && (
                    <CommandShortcut>
                      {formatShortcutKeys(item.shortcut)}
                    </CommandShortcut>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}
        {inElectron && onWorkspaceRoute && closedSessions.length > 0 && (
          <>
            <CommandGroup heading="Recently closed">
              {closedSessions.map(entry => (
                <CommandItem
                  key={entry.durableSessionId}
                  value={`reopen closed ${entry.projectName} ${entry.goal ?? ''} ${entry.title} ${entry.harness}`}
                  onSelect={() => {
                    recordPaletteUse('ws-reopen-closed');
                    handleSelect(() =>
                      window.dispatchEvent(
                        new CustomEvent(REOPEN_CLOSED_EVENT, {
                          detail: {
                            durableSessionId: entry.durableSessionId,
                          },
                        })
                      )
                    );
                  }}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  <span>
                    Reopen {entry.projectName} · {entry.goal ?? entry.title}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {inElectron && onSpatialRoute && (
          <>
            <CommandGroup heading="Spatial">
              <CommandItem
                value="spatial toggle projection top-down angled fixed view"
                onSelect={() => {
                  recordPaletteUse('spatial-projection');
                  toggleProjection();
                }}
              >
                <RotateCw className="mr-2 h-4 w-4" />
                <span>Toggle projection (top-down ↔ angled)</span>
                <CommandShortcut>V</CommandShortcut>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading="Navigation">
          {navigationItems.map(item => (
            <CommandItem
              key={item.id}
              value={item.value}
              onSelect={() => {
                recordPaletteUse(item.id);
                item.onSelect();
              }}
            >
              <item.icon className="mr-2 h-4 w-4" />
              <span>{item.label}</span>
              {item.shortcut && (
                <CommandShortcut>
                  {formatShortcutKeys(item.shortcut)}
                </CommandShortcut>
              )}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions">
          {actionItems.map(item => (
            <CommandItem
              key={item.id}
              value={item.value}
              onSelect={() => {
                recordPaletteUse(item.id);
                item.onSelect();
              }}
            >
              <item.icon className="mr-2 h-4 w-4" />
              <span>{item.label}</span>
              {item.shortcut && (
                <CommandShortcut>
                  {formatShortcutKeys(item.shortcut)}
                </CommandShortcut>
              )}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        {/* legacy demo surfaces: reachable, never primary (ENG-016) */}
        <CommandGroup heading="Legacy">
          {legacyItems.map(item => (
            <CommandItem
              key={item.id}
              value={item.value}
              onSelect={() => {
                recordPaletteUse(item.id);
                item.onSelect();
              }}
            >
              <item.icon className="mr-2 h-4 w-4" />
              <span>{item.label}</span>
              {item.shortcut && (
                <CommandShortcut>
                  {formatShortcutKeys(item.shortcut)}
                </CommandShortcut>
              )}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

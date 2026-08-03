'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
  SquareTerminal,
  Settings,
  HelpCircle,
  LayoutPanelTop,
  Milestone,
  PenLine,
  Palette,
  Columns2,
  BellRing,
  XCircle,
  ArrowLeftToLine,
  ArrowRightToLine,
  Map as MapIcon,
  FolderOpen,
  LogIn,
  History,
  RotateCw,
  RotateCcw,
  MessageSquarePlus,
  Bug,
  Lightbulb,
  Gauge,
  Building2,
  Check,
  Cloud,
  Laptop,
  MonitorPlay,
  Waypoints,
  Shapes,
  type LucideIcon,
} from 'lucide-react';
import {
  requestSessionJump,
  requestLaunch,
  requestOpenProject,
  requestProjectPicker,
  requestAgentComposer,
  RENAME_ACTIVE_EVENT,
  EDIT_ACTIVE_PROJECT_EVENT,
  TOGGLE_SPLIT_EVENT,
  JUMP_ATTENTION_EVENT,
  CLOSE_ACTIVE_EVENT,
  MOVE_ACTIVE_PROJECT_EVENT,
  MOVE_ACTIVE_TAB_EVENT,
  REOPEN_CLOSED_EVENT,
  OPEN_ROADMAP_EVENT,
} from '@/components/workspace/session-jump';
import {
  useWorkspaceCommandAvailability,
  type CommandAvailability,
} from '@/components/workspace/workspace-command-availability';
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
import { STATUS_LIGHT_META, StatusLight } from '@/components/status-light';
import { HARNESS_META, HARNESS_ORDER } from '@/components/workspace/harnesses';
import {
  AGENT_SOURCE_META,
  AGENT_SOURCE_ORDER,
  type AgentSourceId,
} from '@/components/workspace/agent-sources';
import { useOptionalProductFeedback } from '@/components/feedback/product-feedback-provider';
import {
  requestQuickFeedback,
  type QuickFeedbackKind,
} from '@/components/feedback/quick-feedback-events';
import { listProjects, rebindProjectPath } from '@/lib/projects/registry';
import type { Project } from '@/lib/projects/registry';
import { useOptionalWorkspaceTenancy } from '@/lib/tenancy/tenancy-provider';
import { DEMO_WORKSPACE_ID } from '@/lib/tenancy/workspace-scope';
import { demoSessionRows } from '@/lib/demo-workspace/model';
import { HUD } from '@/components/hud';
import type { ShortcutKeys } from '@/types/shortcuts';
import {
  fixedFamilyBindings,
  getWorkspaceFixedFamily,
} from '@/lib/shortcuts/fixed-families';
import type { CommandAltitude } from '@/components/nav/command-altitude';
import type { PtyHarness, ClosedSessionEntry } from '@/types/electron';
import { useShortcutRegistryVersion } from './use-effective-shortcut';
import { useCommandNavigation } from '@/components/nav/command-navigation-provider';
import { useAppearance } from '@/components/appearance/appearance-provider';
import {
  BUILT_IN_THEME_IDS,
  ThemePickerCommand,
} from '@/components/appearance/theme-picker-command';
import { selectManualTheme } from '@/app/settings/appearance-settings';
import {
  buildWorkspacePaletteRows,
  type WorkspacePaletteRow,
} from './workspace-palette-rows';
import {
  rankRecents,
  readPaletteUses,
  recordPaletteUse,
} from './palette-recents';

/** Shared live-status language with palette-specific HUD colors. */
const STATUS_META: Record<SessionRowStatus, { label: string; color: string }> =
  {
    fault: { label: 'error', color: STATUS_LIGHT_META.fault.color },
    'needs-you': {
      label: 'needs you',
      color: STATUS_LIGHT_META['needs-you'].color,
    },
    working: {
      label: SESSION_GLYPH_LABEL.working,
      color: STATUS_LIGHT_META.active.color,
    },
    done: {
      label: SESSION_GLYPH_LABEL.done,
      color: STATUS_LIGHT_META.result.color,
    },
    fresh: {
      label: SESSION_GLYPH_LABEL.fresh,
      color: STATUS_LIGHT_META.off.color,
    },
    quiet: {
      label: SESSION_GLYPH_LABEL.quiet,
      color: STATUS_LIGHT_META.off.color,
    },
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
  availability?: CommandAvailability;
  /** Muted trailing note (e.g. `Coming soon` on a preview surface). Rendered
   *  only when there is no shortcut to show. */
  note?: string;
}

// fixed arrangement family (D20): displayed beside the palette rows, not
// rebindable — the workspace key layer resolves the chords, not the registry
const [MOVE_TAB_LEFT_KEYS, MOVE_TAB_RIGHT_KEYS] = fixedFamilyBindings(
  getWorkspaceFixedFamily('fixed-move-tab')
);
const [MOVE_PROJECT_LEFT_KEYS, MOVE_PROJECT_RIGHT_KEYS] = fixedFamilyBindings(
  getWorkspaceFixedFamily('fixed-move-project')
);

const WORKSPACE_PALETTE_ROW_ID = {
  rename: 'ws-rename',
  color: 'ws-color',
  split: 'ws-split',
  jump: 'ws-jump',
  roadmap: 'ws-roadmap',
  moveTabLeft: 'ws-move-left',
  moveTabRight: 'ws-move-right',
  moveProjectLeft: 'ws-move-project-left',
  moveProjectRight: 'ws-move-project-right',
  close: 'ws-close',
} as const;

/** Contract join for fixed families that declare command-palette coverage. */
export const WORKSPACE_PALETTE_ROW_IDS: ReadonlySet<string> = new Set(
  Object.values(WORKSPACE_PALETTE_ROW_ID)
);

/** palette icon per manifest surface — the manifest stays render-free */
const SURFACE_ICONS: Record<AppSurface['id'], LucideIcon> = {
  terminal: SquareTerminal,
  sessions: LayoutPanelTop,
  spatial: MapIcon,
  settings: Settings,
  consumption: Gauge,
  organization: Building2,
  cloud: Cloud,
  coordination: Waypoints,
  'agent-types': Shapes,
};

const WORKSPACE_ICONS = {
  personal: Laptop,
  demo: MonitorPlay,
  organization: Building2,
} as const;

export function CommandPalette({
  open,
  onOpenChange,
  onOpenHelpModal,
}: CommandPaletteProps) {
  const router = useRouter();
  const { navigateCommandSurface, activateCommandAltitude } =
    useCommandNavigation();
  const shortcutVersion = useShortcutRegistryVersion();
  const workspaceAvailability = useWorkspaceCommandAvailability();
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
  const {
    preferences: appearancePreferences,
    resolved: resolvedAppearance,
    previewTheme: previewAppearanceTheme,
    cancelPreview,
    commitPreferences: commitAppearancePreferences,
  } = useAppearance();
  const [paletteMode, setPaletteMode] = useState<'commands' | 'themes'>(
    'commands'
  );
  const [themeValue, setThemeValue] = useState('');
  const [committedThemeId, setCommittedThemeId] = useState('');
  const [themeSaving, setThemeSaving] = useState(false);
  const [themeError, setThemeError] = useState<string | null>(null);
  const previewOwned = useRef(false);
  const inElectron = typeof window !== 'undefined' && !!window.electron?.pty;
  // Demo tenant (ENG-027 W2): the palette lists the demo Workspace's
  // Sessions and drops every verb that reaches Personal truth or a PTY —
  // launching, shells, Projects, reopen. Demo tabs cannot spawn a process.
  const tenancy = useOptionalWorkspaceTenancy();
  const inDemoTenant =
    (tenancy?.hydrated ?? false) &&
    tenancy?.activeWorkspace.id === DEMO_WORKSPACE_ID;
  const personalVerbs = inElectron && !inDemoTenant;
  const workspaceVerbs = inElectron || inDemoTenant;

  // Reset search AND session rows when closing — stale rows on reopen can
  // list dead sessions or wrong statuses until the refetch lands, and Enter
  // on one would silently do nothing
  useEffect(() => {
    if (!open) {
      if (previewOwned.current) {
        previewOwned.current = false;
        cancelPreview();
      }
      setPaletteMode('commands');
      setThemeValue('');
      setCommittedThemeId('');
      setThemeError(null);
      setSearch('');
      setSessions([]);
      setProjects([]);
      setRecents([]);
      setClosedSessions([]);
      setRegistryFailed(false);
    }
  }, [cancelPreview, open]);

  useEffect(
    () => () => {
      if (previewOwned.current) cancelPreview();
    },
    [cancelPreview]
  );

  useEffect(() => {
    if (!open) return;
    setOnWorkspaceRoute(window.location.pathname.startsWith('/workspace'));
    setOnSpatialRoute(window.location.pathname.startsWith('/fleet/spatial'));
    setRecentIds(rankRecents(readPaletteUses(), Date.now()));
    if (inDemoTenant) {
      // demo Sessions through the same row shape; no PTY, no registry
      setSessions(demoSessionRows());
      return;
    }
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
  }, [open, inDemoTenant]);

  const handleSelect = useCallback(
    (callback: () => void) => {
      onOpenChange(false);
      // Small delay to let the dialog close animation start
      setTimeout(callback, 50);
    },
    [onOpenChange]
  );
  const workspaceRows = useMemo(
    () =>
      tenancy?.hydrated
        ? buildWorkspacePaletteRows(
            tenancy.workspaces,
            tenancy.activeWorkspace.id
          )
        : [],
    [tenancy]
  );
  const selectWorkspace = useCallback(
    (row: WorkspacePaletteRow) => {
      if (!tenancy) return;
      handleSelect(() => {
        if (row.action === 'switch') {
          tenancy.switchWorkspace(row.workspace.id);
          return;
        }
        if (row.action === 'open-preview' && row.workspace.href) {
          navigateCommandSurface(row.workspace.href);
        }
      });
    },
    [handleSelect, navigateCommandSurface, tenancy]
  );

  const enterThemePicker = useCallback(() => {
    setPaletteMode('themes');
    setSearch('');
    setThemeError(null);
    setThemeValue(resolvedAppearance.themeId);
    setCommittedThemeId(resolvedAppearance.themeId);
  }, [resolvedAppearance.themeId]);

  const previewTheme = useCallback(
    (themeId: string) => {
      if (!BUILT_IN_THEME_IDS.has(themeId) || themeSaving) return;
      setThemeValue(themeId);
      setThemeError(null);
      previewOwned.current = true;
      previewAppearanceTheme(themeId);
    },
    [previewAppearanceTheme, themeSaving]
  );

  const commitTheme = useCallback(
    async (themeId: string) => {
      if (!BUILT_IN_THEME_IDS.has(themeId) || themeSaving) return;
      setThemeSaving(true);
      setThemeError(null);
      try {
        await commitAppearancePreferences(
          selectManualTheme(appearancePreferences, themeId)
        );
        previewOwned.current = false;
        setPaletteMode('commands');
        onOpenChange(false);
      } catch {
        setThemeError('Theme could not be saved. Try again.');
      } finally {
        setThemeSaving(false);
      }
    },
    [
      appearancePreferences,
      commitAppearancePreferences,
      onOpenChange,
      themeSaving,
    ]
  );

  const handlePaletteOpenChange = useCallback(
    (next: boolean) => {
      if (!next && previewOwned.current) {
        previewOwned.current = false;
        cancelPreview();
      }
      onOpenChange(next);
    },
    [cancelPreview, onOpenChange]
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
  const workspaceItems = useMemo<
    Array<CommandItem & { demoAvailable?: boolean }>
  >(() => {
    void shortcutVersion;
    return [
      {
        id: WORKSPACE_PALETTE_ROW_ID.rename,
        label: 'Rename the active tab',
        value: 'rename tab title active',
        shortcut: shortcutRegistry.getEffectiveKeys('workspace-rename'),
        icon: PenLine,
        availability: workspaceAvailability.commands['rename-tab'],
        onSelect: () => dispatch(RENAME_ACTIVE_EVENT),
      },
      {
        id: WORKSPACE_PALETTE_ROW_ID.color,
        label: 'Rename or recolor the active Project',
        value: 'rename color project swatch recolor palette hue',
        icon: Palette,
        availability: workspaceAvailability.commands['rename-project'],
        // the Project editor owns both its name and identity color
        onSelect: () => dispatch(EDIT_ACTIVE_PROJECT_EVENT),
      },
      {
        id: WORKSPACE_PALETTE_ROW_ID.split,
        label: 'Split: pin / unpin the active tab',
        value: 'split pane pin unpin side by side watch',
        shortcut: shortcutRegistry.getEffectiveKeys('workspace-split'),
        icon: Columns2,
        availability: workspaceAvailability.commands['toggle-split'],
        onSelect: () => dispatch(TOGGLE_SPLIT_EVENT),
      },
      {
        id: WORKSPACE_PALETTE_ROW_ID.jump,
        label: 'Jump to the Session needing you',
        value: 'jump attention needs you blocked waiting',
        shortcut: shortcutRegistry.getEffectiveKeys('workspace-jump-attention'),
        icon: BellRing,
        availability: workspaceAvailability.commands['jump-attention'],
        onSelect: () => dispatch(JUMP_ATTENTION_EVENT),
      },
      {
        id: WORKSPACE_PALETTE_ROW_ID.roadmap,
        label: 'Open the Project roadmap',
        value: 'roadmap plan queue milestones next up shipped blocked sessions',
        shortcut: shortcutRegistry.getEffectiveKeys('workspace-roadmap'),
        icon: Milestone,
        availability: workspaceAvailability.commands['open-roadmap'],
        onSelect: () => dispatch(OPEN_ROADMAP_EVENT),
      },
      {
        id: WORKSPACE_PALETTE_ROW_ID.moveTabLeft,
        label: 'Move tab left',
        value: 'move tab left reorder arrange shift nudge order',
        // fixed arrangement family (D20) — displayed, not rebindable
        shortcut: MOVE_TAB_LEFT_KEYS,
        icon: ArrowLeftToLine,
        availability: workspaceAvailability.commands['move-tab-left'],
        demoAvailable: true,
        onSelect: () =>
          handleSelect(() =>
            window.dispatchEvent(
              new CustomEvent(MOVE_ACTIVE_TAB_EVENT, {
                detail: { delta: -1 },
              })
            )
          ),
      },
      {
        id: WORKSPACE_PALETTE_ROW_ID.moveTabRight,
        label: 'Move tab right',
        value: 'move tab right reorder arrange shift nudge order',
        shortcut: MOVE_TAB_RIGHT_KEYS,
        icon: ArrowRightToLine,
        availability: workspaceAvailability.commands['move-tab-right'],
        demoAvailable: true,
        onSelect: () =>
          handleSelect(() =>
            window.dispatchEvent(
              new CustomEvent(MOVE_ACTIVE_TAB_EVENT, {
                detail: { delta: 1 },
              })
            )
          ),
      },
      {
        id: WORKSPACE_PALETTE_ROW_ID.moveProjectLeft,
        label: 'Move Project left',
        value: 'move project left reorder arrange shift nudge order',
        shortcut: MOVE_PROJECT_LEFT_KEYS,
        icon: ArrowLeftToLine,
        availability: workspaceAvailability.commands['move-project-left'],
        demoAvailable: true,
        onSelect: () =>
          handleSelect(() =>
            window.dispatchEvent(
              new CustomEvent(MOVE_ACTIVE_PROJECT_EVENT, {
                detail: { delta: -1 },
              })
            )
          ),
      },
      {
        id: WORKSPACE_PALETTE_ROW_ID.moveProjectRight,
        label: 'Move Project right',
        value: 'move project right reorder arrange shift nudge order',
        shortcut: MOVE_PROJECT_RIGHT_KEYS,
        icon: ArrowRightToLine,
        availability: workspaceAvailability.commands['move-project-right'],
        demoAvailable: true,
        onSelect: () =>
          handleSelect(() =>
            window.dispatchEvent(
              new CustomEvent(MOVE_ACTIVE_PROJECT_EVENT, {
                detail: { delta: 1 },
              })
            )
          ),
      },
      {
        id: WORKSPACE_PALETTE_ROW_ID.close,
        label: 'Close the active tab or empty Project',
        value: 'close tab agent empty project kill session end',
        shortcut: shortcutRegistry.getEffectiveKeys('workspace-close-tab'),
        icon: XCircle,
        availability: workspaceAvailability.commands['close-tab'],
        onSelect: () => dispatch(CLOSE_ACTIVE_EVENT),
      },
    ];
  }, [dispatch, handleSelect, shortcutVersion, workspaceAvailability]);
  const tenantWorkspaceItems = useMemo(
    () =>
      inDemoTenant
        ? workspaceItems.filter(item => item.demoAvailable)
        : workspaceItems,
    [inDemoTenant, workspaceItems]
  );

  // Navigation rows derive from the manifest (ENG-016 D8): the palette, the
  // go-chords, and the header must always agree on names and targets.
  const surfaceItem = useCallback(
    (s: AppSurface): CommandItem => {
      void shortcutVersion;
      const shortcutId = s.gestureShortcutId ?? s.shortcutId;
      return {
        id: `nav-${s.id}`,
        label: `Go to ${s.name}`,
        // Name first: typing a surface's name must rank its nav row at the
        // top. A value starting with the verb ("go …") loses the prefix
        // match to any item whose value happens to start with the name.
        value: `${s.name} go ${s.keywords.join(' ')}`,
        icon: SURFACE_ICONS[s.id],
        shortcut: shortcutId
          ? shortcutRegistry.getEffectiveKeys(shortcutId)
          : undefined,
        // Preview surfaces navigate for real — the row executes — but say
        // what the reader will find (ENG-026 N0). `announced` never appears
        // here at all: a palette entry that cannot execute is a worse lie
        // than a muted button.
        note: s.readiness === 'preview' ? 'Coming soon' : undefined,
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
      [...surfacesByTier('spine'), ...surfacesByTier('app')]
        // `announced` surfaces have no page behind them and never join ⌘K.
        .filter(s => s.readiness !== 'announced')
        .map(surfaceItem),
    [surfaceItem]
  );
  // Quick feedback (ENG-025 F1): the palette is the discoverable face of
  // ⌘⇧F; each kind-specific verb opens the same capture bar pre-set.
  const feedback = useOptionalProductFeedback();
  const feedbackAuthed = feedback?.isAuthenticated ?? false;
  const actionItems = useMemo<CommandItem[]>(() => {
    void shortcutVersion;
    const feedbackAvailability: CommandAvailability | undefined = feedbackAuthed
      ? undefined
      : { available: false, reason: 'Sign in required' };
    const feedbackVerb = (
      id: string,
      label: string,
      value: string,
      icon: LucideIcon,
      kind: QuickFeedbackKind,
      withShortcut: boolean
    ): CommandItem => ({
      id,
      label,
      value,
      icon,
      shortcut: withShortcut
        ? shortcutRegistry.getEffectiveKeys('quick-feedback')
        : undefined,
      availability: feedbackAvailability,
      onSelect: () => handleSelect(() => requestQuickFeedback(kind)),
    });
    return [
      {
        id: 'action-change-theme',
        label: 'Change theme…',
        value: 'change theme appearance color scheme preset light dark',
        icon: Palette,
        onSelect: enterThemePicker,
      },
      feedbackVerb(
        'action-feedback',
        'Send feedback',
        'send feedback comment note tell us',
        MessageSquarePlus,
        'general',
        true
      ),
      feedbackVerb(
        'action-feedback-bug',
        'Report a bug',
        'report bug broken issue problem wrong crash',
        Bug,
        'bug',
        false
      ),
      feedbackVerb(
        'action-feedback-idea',
        'Suggest an idea',
        'suggest idea feature request enhancement improve wish',
        Lightbulb,
        'idea',
        false
      ),
      {
        id: 'action-help',
        label: 'Keyboard Shortcuts',
        value: 'keyboard shortcuts help keys hotkeys cheat sheet',
        icon: HelpCircle,
        shortcut: shortcutRegistry.getEffectiveKeys('help-modal'),
        onSelect: () => handleSelect(onOpenHelpModal),
      },
    ];
  }, [
    enterThemePicker,
    feedbackAuthed,
    handleSelect,
    onOpenHelpModal,
    shortcutVersion,
  ]);

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
    for (const item of [...navigationItems, ...actionItems]) {
      candidates.set(item.id, {
        label: item.label,
        icon: item.icon,
        onSelect: item.onSelect,
      });
    }
    for (const row of workspaceRows) {
      if (row.action !== 'switch' && row.action !== 'open-preview') continue;
      candidates.set(row.id, {
        label: row.workspace.name,
        icon: WORKSPACE_ICONS[row.workspace.kind],
        onSelect: () => selectWorkspace(row),
      });
    }
    if (inElectron && !inDemoTenant) {
      for (const h of HARNESS_ORDER) {
        if (
          h === 'shell' &&
          !workspaceAvailability.commands['launch-shell'].available
        ) {
          continue;
        }
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
        for (const w of tenantWorkspaceItems) {
          if (w.availability && !w.availability.available) continue;
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
    actionItems,
    workspaceRows,
    selectWorkspace,
    inElectron,
    inDemoTenant,
    projects,
    recents,
    onWorkspaceRoute,
    onSpatialRoute,
    tenantWorkspaceItems,
    launchHarness,
    openAgentComposer,
    openProject,
    openRecentProject,
    toggleProjection,
    recentIds,
    workspaceAvailability,
  ]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={handlePaletteOpenChange}
      commandValue={paletteMode === 'themes' ? themeValue : undefined}
      onCommandValueChange={paletteMode === 'themes' ? previewTheme : undefined}
    >
      {paletteMode === 'themes' ? (
        <ThemePickerCommand
          search={search}
          currentThemeId={committedThemeId}
          busy={themeSaving}
          error={themeError}
          onSearchChange={setSearch}
          onSelect={themeId => void commitTheme(themeId)}
        />
      ) : (
        <>
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

            {workspaceRows.length > 0 && (
              <>
                <CommandGroup heading="Workspaces">
                  {workspaceRows.map(row => {
                    const Icon = WORKSPACE_ICONS[row.workspace.kind];
                    const disabled =
                      row.action === 'current' ||
                      row.action === 'unavailable';
                    return (
                      <CommandItem
                        key={row.id}
                        value={row.value}
                        disabled={disabled}
                        data-palette-workspace-current={
                          row.action === 'current'
                            ? row.workspace.id
                            : undefined
                        }
                        data-palette-workspace-switch={
                          row.action === 'switch'
                            ? row.workspace.id
                            : undefined
                        }
                        data-palette-workspace-preview={
                          row.action === 'open-preview'
                            ? row.workspace.id
                            : undefined
                        }
                        onSelect={() => {
                          recordPaletteUse(row.id);
                          selectWorkspace(row);
                        }}
                      >
                        <Icon className="mr-2 h-4 w-4 shrink-0" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate">{row.workspace.name}</span>
                          {row.workspace.tagline && (
                            <span className="truncate text-chrome-meta text-muted-foreground">
                              {row.workspace.tagline}
                            </span>
                          )}
                        </span>
                        {row.action === 'current' && (
                          <Check
                            aria-hidden
                            className="ml-2 h-3.5 w-3.5 shrink-0 text-primary"
                          />
                        )}
                        {row.note && (
                          <CommandShortcut>{row.note}</CommandShortcut>
                        )}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
                <CommandSeparator />
              </>
            )}

            {(inElectron || inDemoTenant) && sessions.length > 0 && (
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
                          ) : s.status === 'fault' ? (
                            <StatusLight
                              decorative
                              size="compact"
                              state="fault"
                            />
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

            {personalVerbs && (
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
                    value={`open shell terminal active project ${workspaceAvailability.commands['launch-shell'].reason ?? ''}`}
                    onSelect={() => launchHarness('shell')}
                    disabled={
                      !workspaceAvailability.commands['launch-shell'].available
                    }
                    title={
                      workspaceAvailability.commands['launch-shell'].reason ??
                      undefined
                    }
                  >
                    <SquareTerminal className="mr-2 h-3.5 w-3.5 shrink-0" />
                    <span>Open shell in the active Project</span>
                    {!workspaceAvailability.commands['launch-shell']
                      .available && (
                      <CommandShortcut>
                        {workspaceAvailability.commands['launch-shell'].reason}
                      </CommandShortcut>
                    )}
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />
              </>
            )}

            {personalVerbs && (
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
                          className="ml-auto truncate pl-2 text-chrome-micro"
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
                          className="ml-auto truncate pl-2 text-chrome-micro"
                          style={{ color: HUD.textDim }}
                        >
                          {r.dir}
                        </span>
                      </CommandItem>
                    ))}
                  {registryFailed && (
                    <CommandItem
                      value="project sign in sync account"
                      onSelect={() =>
                        handleSelect(() => router.push('/sign-in'))
                      }
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
            {workspaceVerbs &&
              onWorkspaceRoute &&
              tenantWorkspaceItems.length > 0 && (
                <>
                  <CommandGroup heading="Workspace">
                    {tenantWorkspaceItems.map(item => (
                      <CommandItem
                        key={item.id}
                        value={`${item.value} ${item.availability?.reason ?? ''}`}
                        disabled={
                          item.availability
                            ? !item.availability.available
                            : undefined
                        }
                        title={item.availability?.reason ?? undefined}
                        onSelect={() => {
                          recordPaletteUse(item.id);
                          item.onSelect();
                        }}
                      >
                        <item.icon className="mr-2 h-4 w-4" />
                        <span>{item.label}</span>
                        {item.availability && !item.availability.available ? (
                          <CommandShortcut>
                            {item.availability.reason}
                          </CommandShortcut>
                        ) : item.shortcut ? (
                          <CommandShortcut>
                            {formatShortcutKeys(item.shortcut)}
                          </CommandShortcut>
                        ) : null}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  <CommandSeparator />
                </>
              )}
            {personalVerbs && onWorkspaceRoute && closedSessions.length > 0 && (
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
                <CommandGroup heading="Fleet">
                  <CommandItem
                    value="fleet spatial toggle projection top-down angled fixed view"
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
                  {item.shortcut ? (
                    <CommandShortcut>
                      {formatShortcutKeys(item.shortcut)}
                    </CommandShortcut>
                  ) : item.note ? (
                    <CommandShortcut>{item.note}</CommandShortcut>
                  ) : null}
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
          </CommandList>
        </>
      )}
    </CommandDialog>
  );
}

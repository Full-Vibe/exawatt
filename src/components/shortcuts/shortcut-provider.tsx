'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  shortcutRegistry,
  chordEngine,
  defaultShortcuts,
} from '@/lib/shortcuts';
import {
  loadShortcutOverrides,
  saveShortcutOverrides,
} from '@/lib/shortcuts/preference-source';
import { CommandPalette } from './command-palette';
import { ShortcutHelpModal } from './shortcut-help-modal';
import { ChordIndicator } from './chord-indicator';
import type {
  KeyBinding,
  ShortcutContext as ShortcutCtx,
  Shortcut,
} from '@/types/shortcuts';
import { isChord } from '@/types/shortcuts';
import {
  bindingToAccelerator,
  commandVerbForMenuCommand,
  menuCommandShortcutIds,
  menuCommandVerbs,
  FIXED_SESSION_MENU_COMMAND_IDS,
  agentSourceMenuCommandId,
  type WorkspaceContextCommand,
} from '@exawatt/core';
import { AGENT_SOURCE_DECLARATIONS } from '@/generated/agent-source-declarations';
import type { AgentSourceId } from '@/components/workspace/agent-sources';
import {
  APP_SURFACES,
  surfaceForShortcut,
  resolveSurfaceHref,
} from '@/components/nav/surfaces';
import type { CommandAltitude } from '@/components/nav/command-altitude';
import {
  requestLaunch,
  RENAME_ACTIVE_EVENT,
  TOGGLE_SPLIT_EVENT,
  JUMP_ATTENTION_EVENT,
  CLOSE_ACTIVE_EVENT,
  MOVE_ACTIVE_PROJECT_EVENT,
  MOVE_ACTIVE_TAB_EVENT,
  CLOSE_ACTIVE_PROJECT_EVENT,
  REVEAL_ACTIVE_PATH_EVENT,
  OPEN_ROADMAP_EVENT,
  RESUME_ACTIVE_AGENT_EVENT,
  RESUME_PARKED_SCOPE_EVENT,
  requestProjectPicker,
  requestConnectAgentSource,
  requestAgentComposer,
  requestReopenLastClosed,
  LAUNCH_CONFIGURATION_CATALOG_EVENT,
  CLONE_TARGET_CATALOG_EVENT,
} from '@/components/workspace/session-jump';
import type { CloneSessionTarget } from '@/components/workspace/session-clone';
import {
  commandPaletteLaunchConfigurationCatalog,
  type CommandPaletteLaunchConfiguration,
} from './command-palette-launch-configurations';
import type { PtyHarness } from '@/types/electron';
import { requestQuickFeedback } from '@/components/feedback/quick-feedback-events';
import {
  runTopDialogPrimaryAction,
  useDialogPrimaryActionDepth,
} from '@/components/ui/dialog-primary-action';
import { useCommandNavigation } from '@/components/nav/command-navigation-provider';
import { useWorkspaceCommandAvailability } from '@/components/workspace/workspace-command-availability';
import { useOptionalWorkspaceTenancy } from '@/lib/tenancy/tenancy-provider';

/** application-menu command → the registry id whose binding it displays
 *  (D10): rebinding a verb updates the menu's accelerator column. Derived
 *  from the command-verb manifest, which is the same source the native
 *  template builds from. */
const MENU_COMMAND_SHORTCUTS: Record<string, string> = menuCommandShortcutIds();

/** Agent Sources the Session menu can start directly (same contract file the
 *  Electron template reads). */
const AGENT_LAUNCH_MENU_SOURCES = new Map<string, AgentSourceId>(
  AGENT_SOURCE_DECLARATIONS.filter(
    declaration =>
      declaration.harness !== null && declaration.capabilities.interactiveLaunch
  ).map(declaration => [
    agentSourceMenuCommandId(declaration.adapterId),
    declaration.adapterId as AgentSourceId,
  ])
);

/** Menu commands whose enablement follows renderer-published workspace truth:
 *  the manifest's verbs that name an availability, plus the fixed families. */
const WORKSPACE_MENU_AVAILABILITY_COMMANDS: readonly string[] = [
  ...menuCommandVerbs()
    .filter(verb => verb.availability !== undefined)
    .map(verb => verb.menu.commandId),
  ...FIXED_SESSION_MENU_COMMAND_IDS,
];

/** Contract join for manifests that declare native-menu coverage. */
export const WORKSPACE_MENU_AVAILABILITY_COMMAND_IDS: ReadonlySet<string> =
  new Set(WORKSPACE_MENU_AVAILABILITY_COMMANDS);

/**
 * Menu verbs that LAUNCH into the personal workspace — PTY spawns, the
 * Agent composer, Project opening, closed-Session resurrection (ENG-027).
 * One tenant gate at the dispatch point drops them whole while a
 * non-personal Workspace is active, so a Demo-tenant invocation can never
 * store a pending-launch slot that fires against Personal truth after
 * switching back. (`session-jump.ts` fails closed on the slot side too.)
 *
 * Deliberately NOT the whole availability family: the remaining workspace
 * verbs (movement, rename, split, attention) ride the availability
 * snapshot, which the ACTIVE shell publishes as per-tenant truth — the
 * Demo shell executes movement through its own adapter (D44) and resets
 * the snapshot on unmount, so availability itself is their tenant gate.
 */
/**
 * Every menu command id this provider dispatches.
 *
 * The manifest can declare a menu item, the native menu can render it, and the
 * renderer can still have no case for it: dispatch is a switch, and a missing
 * case falls through in silence. That is the FIX-012 defect one rung further
 * out, so each dispatcher publishes what it handles and the command-verb
 * contract joins those sets to the manifest. A verb that grows a menu item
 * without a dispatch now fails a test rather than shipping a menu entry that
 * does nothing.
 *
 * This provider is not the only dispatcher: feedback owns `submit-feedback`
 * and publishes it separately. Launch rows are excluded on purpose, being
 * derived from the Agent Source contract and handled before the switch, so
 * they cannot go missing one at a time.
 */
export const DISPATCHED_MENU_COMMAND_IDS: ReadonlySet<string> = new Set([
  // The menu-command switch.
  'go-terminal',
  'go-sessions',
  'go-spatial',
  'history-back',
  'history-forward',
  'open-settings',
  'command-palette',
  'new-agent',
  'launch-shell',
  'reopen-closed-tab',
  'open-project',
  'connect-agent-source',
  'rename-tab',
  'toggle-split',
  'move-tab-left',
  'move-tab-right',
  'move-project-left',
  'move-project-right',
  'close-tab',
  'close-project',
  'reveal-path',
  'jump-attention',
  'open-roadmap',
  'resume-agent',
  'resume-scope',
  // Handled by the shortcut switch above rather than the menu switch, because
  // the same overlay answers a key and a menu item.
  'help-modal',
]);

export const LIVE_WORKSPACE_MENU_COMMANDS: ReadonlySet<string> = new Set([
  ...menuCommandVerbs()
    .filter(verb => verb.tenantScope === 'personal-workspace')
    .map(verb => verb.menu.commandId),
  ...AGENT_LAUNCH_MENU_SOURCES.keys(),
]);

interface ShortcutContextValue {
  openCommandPalette: () => void;
  openHelpModal: () => void;
  pendingChord: KeyBinding | null;
  setContext: (context: ShortcutCtx, active: boolean) => void;
  saveOverrides: () => Promise<void>;
}

const ShortcutContext = createContext<ShortcutContextValue | null>(null);

export function useShortcuts() {
  const ctx = useContext(ShortcutContext);
  if (!ctx) {
    throw new Error('useShortcuts must be used within ShortcutProvider');
  }
  return ctx;
}

interface ShortcutProviderProps {
  children: React.ReactNode;
}

export function ShortcutProvider({ children }: ShortcutProviderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const {
    navigateCommandSurface,
    activateCommandAltitude,
    navigateBack,
    navigateForward,
  } = useCommandNavigation();

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [helpModalOpen, setHelpModalOpen] = useState(false);
  const [pendingChord, setPendingChord] = useState<KeyBinding | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [launchConfigurations, setLaunchConfigurations] = useState<
    readonly CommandPaletteLaunchConfiguration[] | undefined
  >(undefined);
  const [cloneTargets, setCloneTargets] = useState<
    readonly CloneSessionTarget[]
  >([]);
  const workspaceAvailability = useWorkspaceCommandAvailability();
  const onWorkspaceRoute = pathname?.startsWith('/workspace') ?? false;
  // Tenant scope for the live-workspace verb gate (ENG-027). The pre-hydration
  // default is Personal, matching the provider's own hydration-safe default.
  const tenancy = useOptionalWorkspaceTenancy();
  const personalTenantActive =
    (tenancy?.activeWorkspace.kind ?? 'personal') === 'personal';

  // Track when modals close to prevent Enter key from double-triggering
  const modalClosedAtRef = useRef<number>(0);
  // Open dialogs that declared a primary action (BUG-049). While one is up,
  // `modal-open` is live and ⌘⏎ presses it; with none, the verb is inert.
  const dialogPrimaryActions = useDialogPrimaryActionDepth();

  // Per-device keyboard overrides, read locally (BUG-044). The account, where
  // one exists, only syncs them — so a distribution without one still starts
  // on the operator's real bindings instead of silently reverting to defaults.
  useEffect(() => {
    async function loadPreferences() {
      try {
        shortcutRegistry.loadOverrides(await loadShortcutOverrides());
      } catch (error) {
        console.error('Failed to load keyboard shortcuts:', error);
      }
      setInitialized(true);
    }
    loadPreferences();
  }, []);

  // Subscribe before descendant passive effects publish their initial catalog.
  useLayoutEffect(() => {
    const receiveCatalog = (event: Event) => {
      setLaunchConfigurations(commandPaletteLaunchConfigurationCatalog(event));
    };
    window.addEventListener(LAUNCH_CONFIGURATION_CATALOG_EVENT, receiveCatalog);
    return () =>
      window.removeEventListener(
        LAUNCH_CONFIGURATION_CATALOG_EVENT,
        receiveCatalog
      );
  }, []);

  useLayoutEffect(() => {
    const receiveCloneTargets = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      setCloneTargets(Array.isArray(detail) ? detail : []);
    };
    window.addEventListener(CLONE_TARGET_CATALOG_EVENT, receiveCloneTargets);
    return () =>
      window.removeEventListener(
        CLONE_TARGET_CATALOG_EVENT,
        receiveCloneTargets
      );
  }, []);

  // Create and register default shortcuts with actions
  useEffect(() => {
    const shortcuts: Shortcut[] = defaultShortcuts.map(def => ({
      ...def,
      action: () => {
        // go-chords navigate to their manifest surface — one source of truth
        // for names and targets (ENG-016 D8)
        const surface = surfaceForShortcut(def.id);
        if (surface) {
          if (surface.tier === 'spine') {
            activateCommandAltitude(surface.id as CommandAltitude);
          } else {
            navigateCommandSurface(resolveSurfaceHref(surface));
          }
          return;
        }
        switch (def.id) {
          case 'history-back':
            navigateBack();
            break;
          case 'history-forward':
            navigateForward();
            break;
          case 'command-terminal':
            activateCommandAltitude('terminal');
            break;
          case 'command-sessions':
            activateCommandAltitude('sessions');
            break;
          case 'command-spatial':
            activateCommandAltitude('spatial');
            break;
          case 'command-palette':
            setCommandPaletteOpen(true);
            break;
          // ⌘, is registered natively in the packaged app, so the main
          // process usually gets there first; this keeps the verb live in the
          // browser, where there is no menu bar to catch it.
          case 'open-settings':
            navigateCommandSurface('/settings');
            break;
          case 'quick-feedback':
            requestQuickFeedback();
            break;
          // The open dialog owns its Return (BUG-049). The target is whichever
          // dialog declared a primary action most recently, so one verb serves
          // every dialog and none of them holds its own keydown handler.
          case 'dialog-primary-action':
            runTopDialogPrimaryAction();
            break;
          case 'help-modal':
          case 'help-modal-slash':
            setHelpModalOpen(true);
            break;
        }
      },
    }));

    shortcutRegistry.registerAll(shortcuts);

    return () => {
      shortcuts.forEach(s => shortcutRegistry.unregister(s.id));
    };
  }, [
    activateCommandAltitude,
    navigateBack,
    navigateForward,
    navigateCommandSurface,
    router,
  ]);

  // Application-menu commands (ENG-016 D8): the macOS menu bar mirrors the
  // app's verbs; every command routes through the same actions the keyboard
  // uses, so the menu is a cheat sheet and a mouse path, never a second brain
  useEffect(() => {
    const launch = (harness: PtyHarness) => {
      requestLaunch(harness);
      if (!window.location.pathname.startsWith('/workspace')) {
        navigateCommandSurface('/workspace');
      }
    };
    const dispatch = (event: string) =>
      window.dispatchEvent(new CustomEvent(event));
    return window.electron?.menu?.onCommand(command => {
      // The one tenant gate (ENG-027): live-workspace verbs are inert while
      // a non-personal Workspace is on screen. Navigation verbs stay live.
      if (!personalTenantActive && LIVE_WORKSPACE_MENU_COMMANDS.has(command)) {
        return;
      }
      // App-tier surfaces are addressed from the Go menu as `go-<surface id>`
      // (ENG-026 N1), resolved through the navigation manifest so the menu
      // can never diverge from it. Spine altitudes keep their explicit cases
      // below; `announced` surfaces have no page and never get a menu item.
      if (command.startsWith('go-')) {
        const surface = APP_SURFACES.find(
          s => s.tier === 'app' && `go-${s.id}` === command
        );
        if (surface) {
          navigateCommandSurface(resolveSurfaceHref(surface));
          return;
        }
      }
      // Session-menu launch rows are one row per launchable Agent Source
      // (`contracts/agent-sources.json`), so a new source arrives with its
      // menu item already working instead of waiting for a hand-added case.
      const launchSource = AGENT_LAUNCH_MENU_SOURCES.get(command);
      if (launchSource) {
        requestAgentComposer(launchSource);
        if (!window.location.pathname.startsWith('/workspace')) {
          navigateCommandSurface('/workspace');
        }
        return;
      }
      switch (command) {
        case 'go-terminal':
          activateCommandAltitude('terminal');
          break;
        case 'go-sessions':
          activateCommandAltitude('sessions');
          break;
        case 'go-spatial':
          activateCommandAltitude('spatial');
          break;
        case 'history-back':
          navigateBack();
          break;
        case 'history-forward':
          navigateForward();
          break;
        case 'open-settings':
          router.push('/settings');
          break;
        case 'command-palette':
          setCommandPaletteOpen(true);
          break;
        case 'new-agent':
          requestAgentComposer();
          if (!window.location.pathname.startsWith('/workspace')) {
            navigateCommandSurface('/workspace');
          }
          break;
        case 'launch-shell':
          if (workspaceAvailability.commands['launch-shell'].available) {
            launch('shell');
          }
          break;
        case 'reopen-closed-tab':
          if (workspaceAvailability.commands['reopen-closed-tab'].available) {
            requestReopenLastClosed();
            if (!window.location.pathname.startsWith('/workspace')) {
              navigateCommandSurface('/workspace');
            }
          }
          break;
        case 'open-project':
          requestProjectPicker();
          if (!window.location.pathname.startsWith('/workspace')) {
            navigateCommandSurface('/workspace');
          }
          break;
        case 'connect-agent-source':
          requestConnectAgentSource();
          if (!window.location.pathname.startsWith('/workspace')) {
            navigateCommandSurface('/workspace');
          }
          break;
        case 'rename-tab':
          if (
            onWorkspaceRoute &&
            workspaceAvailability.commands['rename-tab'].available
          ) {
            dispatch(RENAME_ACTIVE_EVENT);
          }
          break;
        case 'toggle-split':
          if (
            onWorkspaceRoute &&
            workspaceAvailability.commands['toggle-split'].available
          ) {
            dispatch(TOGGLE_SPLIT_EVENT);
          }
          break;
        case 'move-tab-left':
        case 'move-tab-right':
          if (
            onWorkspaceRoute &&
            workspaceAvailability.commands[command].available
          ) {
            window.dispatchEvent(
              new CustomEvent(MOVE_ACTIVE_TAB_EVENT, {
                detail: { delta: command === 'move-tab-right' ? 1 : -1 },
              })
            );
          }
          break;
        case 'move-project-left':
        case 'move-project-right':
          if (
            onWorkspaceRoute &&
            workspaceAvailability.commands[command].available
          ) {
            window.dispatchEvent(
              new CustomEvent(MOVE_ACTIVE_PROJECT_EVENT, {
                detail: {
                  delta: command === 'move-project-right' ? 1 : -1,
                },
              })
            );
          }
          break;
        case 'close-tab':
          if (
            onWorkspaceRoute &&
            workspaceAvailability.commands['close-tab'].available
          ) {
            dispatch(CLOSE_ACTIVE_EVENT);
          }
          break;
        case 'close-project':
          if (
            onWorkspaceRoute &&
            workspaceAvailability.commands['close-project'].available
          ) {
            dispatch(CLOSE_ACTIVE_PROJECT_EVENT);
          }
          break;
        case 'reveal-path':
          if (
            onWorkspaceRoute &&
            workspaceAvailability.commands['reveal-path'].available
          ) {
            dispatch(REVEAL_ACTIVE_PATH_EVENT);
          }
          break;
        case 'jump-attention':
          if (
            onWorkspaceRoute &&
            workspaceAvailability.commands['jump-attention'].available
          ) {
            dispatch(JUMP_ATTENTION_EVENT);
          }
          break;
        case 'open-roadmap':
          if (
            onWorkspaceRoute &&
            workspaceAvailability.commands['open-roadmap'].available
          ) {
            dispatch(OPEN_ROADMAP_EVENT);
          }
          break;
        case 'resume-agent':
          if (
            onWorkspaceRoute &&
            workspaceAvailability.commands['resume-agent'].available
          ) {
            dispatch(RESUME_ACTIVE_AGENT_EVENT);
          }
          break;
        case 'resume-scope':
          if (
            onWorkspaceRoute &&
            workspaceAvailability.commands['resume-scope'].available
          ) {
            dispatch(RESUME_PARKED_SCOPE_EVENT);
          }
          break;
      }
    });
  }, [
    activateCommandAltitude,
    navigateBack,
    navigateForward,
    navigateCommandSurface,
    onWorkspaceRoute,
    personalTenantActive,
    router,
    workspaceAvailability,
  ]);

  // Menu accelerator truthfulness (D10): the macOS menus display whatever
  // the registry currently binds — rebinding ⌘E updates the Session menu
  // without a restart. A chord rebind clears the column instead of lying.
  useEffect(() => {
    const sync = () => {
      const api = window.electron?.menu?.syncAccelerators;
      if (!api) return;
      const map: Record<string, string> = {};
      for (const [command, id] of Object.entries(MENU_COMMAND_SHORTCUTS)) {
        const keys = shortcutRegistry.getEffectiveKeys(id);
        const acc = keys && !isChord(keys) ? bindingToAccelerator(keys) : null;
        map[command] = acc ?? '';
      }
      // before the defaults register, everything is empty — don't blank the
      // menus during that window
      if (Object.values(map).every(v => v === '')) return;
      void api(map);
    };
    sync();
    return shortcutRegistry.subscribe(sync);
  }, []);

  useEffect(() => {
    const api = window.electron?.menu?.syncAvailability;
    if (!api) return;
    const commands = workspaceAvailability.commands;
    const availability: Record<string, boolean> = {};
    for (const command of WORKSPACE_MENU_AVAILABILITY_COMMANDS) {
      // The manifest names the truth each verb reads; a fixed family's menu
      // id IS its availability key.
      const key = (commandVerbForMenuCommand(command)?.availability ??
        command) as WorkspaceContextCommand;
      // Launch verbs carry the tenant gate into the menu itself: enabled-
      // but-inert would be a lie, so a non-personal tenant greys them. Every
      // other verb acts on what is on screen, so the route is its gate.
      const scope = LIVE_WORKSPACE_MENU_COMMANDS.has(command)
        ? personalTenantActive
        : onWorkspaceRoute;
      availability[command] = scope && (commands[key]?.available ?? false);
    }
    void api(availability);
  }, [onWorkspaceRoute, personalTenantActive, workspaceAvailability]);

  // Determine current contexts based on route
  useEffect(() => {
    const contexts: ShortcutCtx[] = [];

    if (commandPaletteOpen) contexts.push('command-palette');
    if (commandPaletteOpen || helpModalOpen || dialogPrimaryActions > 0) {
      contexts.push('modal-open');
    }

    shortcutRegistry.setContexts(contexts);
  }, [commandPaletteOpen, dialogPrimaryActions, helpModalOpen]);

  // Global keyboard listener
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Let command palette handle its own input
      if (commandPaletteOpen) return;

      // The help modal owns the keyboard while open (D9): `g d` behind the
      // cheat-sheet must not navigate. Radix handles Escape itself.
      if (helpModalOpen) return;

      // Prevent double-triggering when a modal just closed (e.g., Enter in command palette)
      if (Date.now() - modalClosedAtRef.current < 100) return;

      chordEngine.processKeyEvent(event);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [commandPaletteOpen, helpModalOpen]);

  // Wrapper to track when command palette closes
  const handleCommandPaletteChange = useCallback((open: boolean) => {
    setCommandPaletteOpen(open);
    if (!open) {
      modalClosedAtRef.current = Date.now();
    }
  }, []);

  // Wrapper to track when help modal closes
  const handleHelpModalChange = useCallback((open: boolean) => {
    setHelpModalOpen(open);
    if (!open) {
      modalClosedAtRef.current = Date.now();
    }
  }, []);

  // Subscribe to chord state
  useEffect(() => {
    return chordEngine.subscribe(setPendingChord);
  }, []);

  const setContext = useCallback((context: ShortcutCtx, active: boolean) => {
    if (active) {
      shortcutRegistry.addContext(context);
    } else {
      shortcutRegistry.removeContext(context);
    }
  }, []);

  const saveOverrides = useCallback(async () => {
    await saveShortcutOverrides(shortcutRegistry.getOverrides());
  }, []);

  const handleOpenHelpModal = useCallback(() => {
    setHelpModalOpen(true);
  }, []);

  const value = useMemo(
    () => ({
      openCommandPalette: () => setCommandPaletteOpen(true),
      openHelpModal: handleOpenHelpModal,
      pendingChord,
      setContext,
      saveOverrides,
    }),
    [pendingChord, setContext, saveOverrides, handleOpenHelpModal]
  );

  return (
    <ShortcutContext.Provider value={value}>
      {children}
      {/* Only render shortcuts UI after initialized */}
      {initialized && (
        <>
          <CommandPalette
            open={commandPaletteOpen}
            onOpenChange={handleCommandPaletteChange}
            onOpenHelpModal={handleOpenHelpModal}
            launchConfigurations={launchConfigurations}
            cloneTargets={cloneTargets}
          />
          <ShortcutHelpModal
            open={helpModalOpen}
            onOpenChange={handleHelpModalChange}
          />
          <ChordIndicator pending={pendingChord} />
        </>
      )}
    </ShortcutContext.Provider>
  );
}

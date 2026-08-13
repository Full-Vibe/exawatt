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
  getKeyboardShortcuts,
  updateKeyboardShortcuts,
} from '@/app/actions/preferences';
import { CommandPalette } from './command-palette';
import { ShortcutHelpModal } from './shortcut-help-modal';
import { ChordIndicator } from './chord-indicator';
import type {
  KeyBinding,
  ShortcutContext as ShortcutCtx,
  Shortcut,
} from '@/types/shortcuts';
import { isChord } from '@/types/shortcuts';
import { bindingToAccelerator } from '@/lib/shortcuts/accelerator';
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
  requestProjectPicker,
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
import { useCommandNavigation } from '@/components/nav/command-navigation-provider';
import { useWorkspaceCommandAvailability } from '@/components/workspace/workspace-command-availability';
import { useOptionalWorkspaceTenancy } from '@/lib/tenancy/tenancy-provider';

/** application-menu command → the registry id whose binding it displays
 *  (D10): rebinding a verb updates the menu's accelerator column */
const MENU_COMMAND_SHORTCUTS: Record<string, string> = {
  'command-palette': 'command-palette',
  'go-terminal': 'command-terminal',
  'go-sessions': 'command-sessions',
  'go-spatial': 'command-spatial',
  'history-back': 'history-back',
  'history-forward': 'history-forward',
  'open-project': 'workspace-new-project',
  'new-agent': 'workspace-new-agent',
  'launch-shell': 'workspace-new-shell',
  'reopen-closed-tab': 'workspace-reopen-closed-tab',
  'rename-tab': 'workspace-rename',
  'toggle-split': 'workspace-split',
  'close-tab': 'workspace-close-tab',
  'jump-attention': 'workspace-jump-attention',
};

const WORKSPACE_MENU_AVAILABILITY_COMMANDS = [
  'launch-shell',
  'reopen-closed-tab',
  'rename-tab',
  'toggle-split',
  'move-tab-left',
  'move-tab-right',
  'move-project-left',
  'move-project-right',
  'close-tab',
  'jump-attention',
] as const;

/** Contract join for fixed families that declare native-menu coverage. */
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
export const LIVE_WORKSPACE_MENU_COMMANDS: ReadonlySet<string> = new Set([
  'new-agent',
  'launch-claude',
  'launch-codex',
  'launch-opencode',
  'launch-grok',
  'open-project',
  'launch-shell',
  'reopen-closed-tab',
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

  // Load user preferences on mount
  useEffect(() => {
    async function loadPreferences() {
      try {
        const overrides = await getKeyboardShortcuts();
        shortcutRegistry.loadOverrides(overrides);
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
          case 'quick-feedback':
            requestQuickFeedback();
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
        case 'launch-claude':
          requestAgentComposer('claude');
          if (!window.location.pathname.startsWith('/workspace')) {
            navigateCommandSurface('/workspace');
          }
          break;
        case 'launch-codex':
          requestAgentComposer('codex');
          if (!window.location.pathname.startsWith('/workspace')) {
            navigateCommandSurface('/workspace');
          }
          break;
        case 'launch-opencode':
          requestAgentComposer('opencode');
          if (!window.location.pathname.startsWith('/workspace')) {
            navigateCommandSurface('/workspace');
          }
          break;
        case 'launch-grok':
          requestAgentComposer('grok');
          if (!window.location.pathname.startsWith('/workspace')) {
            navigateCommandSurface('/workspace');
          }
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
        case 'jump-attention':
          if (
            onWorkspaceRoute &&
            workspaceAvailability.commands['jump-attention'].available
          ) {
            dispatch(JUMP_ATTENTION_EVENT);
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
    const availability: Record<
      (typeof WORKSPACE_MENU_AVAILABILITY_COMMANDS)[number],
      boolean
    > = {
      // Launch verbs carry the tenant gate into the menu itself: enabled-
      // but-inert would be a lie, so a non-personal tenant greys them.
      'launch-shell':
        personalTenantActive && commands['launch-shell'].available,
      'reopen-closed-tab':
        personalTenantActive && commands['reopen-closed-tab'].available,
      'rename-tab': onWorkspaceRoute && commands['rename-tab'].available,
      'toggle-split': onWorkspaceRoute && commands['toggle-split'].available,
      'move-tab-left': onWorkspaceRoute && commands['move-tab-left'].available,
      'move-tab-right':
        onWorkspaceRoute && commands['move-tab-right'].available,
      'move-project-left':
        onWorkspaceRoute && commands['move-project-left'].available,
      'move-project-right':
        onWorkspaceRoute && commands['move-project-right'].available,
      'close-tab': onWorkspaceRoute && commands['close-tab'].available,
      'jump-attention':
        onWorkspaceRoute && commands['jump-attention'].available,
    };
    void api(availability);
  }, [onWorkspaceRoute, personalTenantActive, workspaceAvailability]);

  // Determine current contexts based on route
  useEffect(() => {
    const contexts: ShortcutCtx[] = [];

    if (commandPaletteOpen) contexts.push('command-palette');
    if (commandPaletteOpen || helpModalOpen) contexts.push('modal-open');

    shortcutRegistry.setContexts(contexts);
  }, [commandPaletteOpen, helpModalOpen]);

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
    const overrides = shortcutRegistry.getOverrides();
    await updateKeyboardShortcuts(overrides);
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

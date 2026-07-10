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
  PenLine,
  Palette,
  Columns2,
  BellRing,
  XCircle,
  Map as MapIcon,
} from 'lucide-react';
import {
  requestSessionJump,
  requestIgnite,
  RENAME_ACTIVE_EVENT,
  TOGGLE_SPLIT_EVENT,
  JUMP_ATTENTION_EVENT,
  CLOSE_ACTIVE_EVENT,
  OPEN_OVERVIEW_EVENT,
} from '@/components/workspace/session-jump';
import { buildSessionRows } from '@/components/workspace/switcher-rows';
import type {
  SessionRow,
  SessionRowStatus,
} from '@/components/workspace/switcher-rows';
import { HarnessGlyph } from '@/components/workspace/harness-icons';
import { HARNESS_META, HARNESS_ORDER } from '@/components/workspace/harnesses';
import { HUD } from '@/components/hud';
import type { ShortcutKeys } from '@/types/shortcuts';
import type { PtyHarness } from '@/types/electron';

/** live status shown on switcher rows — one word, normal case (no all-caps) */
const STATUS_META: Record<SessionRowStatus, { label: string; color: string }> =
  {
    'needs-you': { label: 'needs you', color: HUD.amber },
    working: { label: 'working', color: HUD.green },
    idle: { label: 'idle', color: HUD.textDim },
    exited: { label: 'exited', color: HUD.red },
  };

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenHelpModal: () => void;
}

interface CommandItem {
  id: string;
  label: string;
  shortcut?: ShortcutKeys;
  icon: React.ComponentType<{ className?: string }>;
  onSelect: () => void;
  keywords?: string[];
}

export function CommandPalette({
  open,
  onOpenChange,
  onOpenHelpModal,
}: CommandPaletteProps) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  // live sessions for the switcher (S2) — desktop app only, fetched fresh
  // each time the palette opens
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  // workspace verbs only make sense where the workspace is (S3): sampled
  // when the palette opens
  const [onWorkspaceRoute, setOnWorkspaceRoute] = useState(false);
  const inElectron = typeof window !== 'undefined' && !!window.electron?.pty;

  // Reset search AND session rows when closing — stale rows on reopen can
  // list dead sessions or wrong statuses until the refetch lands, and Enter
  // on one would silently do nothing
  useEffect(() => {
    if (!open) {
      setSearch('');
      setSessions([]);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setOnWorkspaceRoute(window.location.pathname.startsWith('/workspace'));
    const pty = window.electron?.pty;
    if (!pty) return;
    let cancelled = false;
    void (async () => {
      const [list, layout] = await Promise.all([
        pty.list(),
        window.electron?.workspace?.load() ?? Promise.resolve(null),
      ]);
      if (!cancelled) setSessions(buildSessionRows(list, layout, Date.now()));
    })();
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

  /** switcher/ignite requests land in the workspace: instantly when it is
   *  mounted (live event), or on mount after navigation (pending slot) */
  const inWorkspace = () => window.location.pathname.startsWith('/workspace');
  const openSession = useCallback(
    (id: string) =>
      handleSelect(() => {
        requestSessionJump(id);
        if (!inWorkspace()) router.push('/workspace');
      }),
    [handleSelect, router]
  );
  const igniteHarness = useCallback(
    (harness: PtyHarness) =>
      handleSelect(() => {
        requestIgnite(harness);
        if (!inWorkspace()) router.push('/workspace');
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
  const workspaceItems = useMemo(
    () => [
      {
        id: 'ws-overview',
        label: 'Overview of all sessions',
        value: 'overview all sessions expose grid tiles',
        keys: '⌘O',
        icon: LayoutPanelTop,
        onSelect: () => dispatch(OPEN_OVERVIEW_EVENT),
      },
      {
        id: 'ws-rename',
        label: 'Rename the active tab',
        value: 'rename tab title active',
        keys: '⌘E',
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
        keys: '⌘D',
        icon: Columns2,
        onSelect: () => dispatch(TOGGLE_SPLIT_EVENT),
      },
      {
        id: 'ws-jump',
        label: 'Jump to the session needing you',
        value: 'jump attention needs you blocked waiting',
        keys: '⌘J',
        icon: BellRing,
        onSelect: () => dispatch(JUMP_ATTENTION_EVENT),
      },
      {
        id: 'ws-close',
        label: 'Close the active tab',
        value: 'close tab kill session end',
        keys: '⌘W',
        icon: XCircle,
        onSelect: () => dispatch(CLOSE_ACTIVE_EVENT),
      },
      {
        id: 'ws-map',
        label: 'Zoom out to Spatial Command',
        value: 'map spatial altitude fleet world zoom out switch',
        keys: '⌘⇧M',
        icon: MapIcon,
        onSelect: () => handleSelect(() => router.push('/fleet/spatial')),
      },
    ],
    [dispatch, handleSelect, router]
  );

  // Build command items
  const items = useMemo<CommandItem[]>(() => {
    return [
      {
        id: 'nav-dashboard',
        label: 'Go to Dashboard',
        icon: LayoutDashboard,
        shortcut: shortcutRegistry.getEffectiveKeys('go-dashboard'),
        onSelect: () => handleSelect(() => router.push('/dashboard')),
        keywords: ['home', 'overview', 'metrics'],
      },
      {
        id: 'nav-board',
        label: 'Go to Board',
        icon: LayoutGrid,
        shortcut: shortcutRegistry.getEffectiveKeys('go-board'),
        onSelect: () => handleSelect(() => router.push('/board')),
        keywords: ['kanban', 'tasks', 'swimlane'],
      },
      {
        id: 'nav-workspace',
        label: 'Go to Workspace',
        icon: SquareTerminal,
        shortcut: shortcutRegistry.getEffectiveKeys('go-workspace'),
        onSelect: () => handleSelect(() => router.push('/workspace')),
        keywords: ['terminal', 'agents', 'sessions', 'ignite'],
      },
      {
        id: 'nav-fleet',
        label: 'Go to Fleet',
        icon: Server,
        shortcut: shortcutRegistry.getEffectiveKeys('go-fleet'),
        onSelect: () => handleSelect(() => router.push('/fleet')),
        keywords: ['agents', 'bots', 'ai'],
      },
      {
        id: 'nav-settings',
        label: 'Go to Settings',
        icon: Settings,
        shortcut: shortcutRegistry.getEffectiveKeys('go-settings'),
        onSelect: () => handleSelect(() => router.push('/settings')),
        keywords: ['preferences', 'config', 'customize'],
      },
      {
        id: 'action-help',
        label: 'Keyboard Shortcuts',
        icon: HelpCircle,
        shortcut: shortcutRegistry.getEffectiveKeys('help-modal'),
        onSelect: () => handleSelect(onOpenHelpModal),
        keywords: ['help', 'keys', 'hotkeys'],
      },
    ];
  }, [router, handleSelect, onOpenHelpModal]);

  // Group items
  const navigationItems = items.filter(i => i.id.startsWith('nav-'));
  const actionItems = items.filter(i => i.id.startsWith('action-'));

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Type a command or search..."
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

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
                  >
                    <span
                      className="mr-2 inline-block h-2 w-2 shrink-0 rotate-45"
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
                        {s.subtitle ? ` · ${s.subtitle}` : ''}
                      </span>
                    </span>
                    <span
                      className="ml-3 shrink-0 font-mono text-xs"
                      data-session-status={s.status}
                      style={{ color: status.color }}
                    >
                      {status.label}
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
            <CommandGroup heading="Launch">
              {HARNESS_ORDER.map(h => (
                <CommandItem
                  key={`launch-${h}`}
                  value={`launch ignite ${HARNESS_META[h].label} new session agent`}
                  onSelect={() => igniteHarness(h)}
                >
                  {h === 'shell' ? (
                    <SquareTerminal className="mr-2 h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <span
                      className="mr-2 shrink-0"
                      style={{ color: HARNESS_META[h].color }}
                    >
                      <HarnessGlyph harness={h} size={13} />
                    </span>
                  )}
                  <span>
                    New {HARNESS_META[h].label} session in the active project
                  </span>
                </CommandItem>
              ))}
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
                  onSelect={item.onSelect}
                >
                  <item.icon className="mr-2 h-4 w-4" />
                  <span>{item.label}</span>
                  {item.keys && <CommandShortcut>{item.keys}</CommandShortcut>}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading="Navigation">
          {navigationItems.map(item => (
            <CommandItem key={item.id} onSelect={item.onSelect}>
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
            <CommandItem key={item.id} onSelect={item.onSelect}>
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

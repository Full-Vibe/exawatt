'use client';

import { useState, useCallback, useEffect, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ShortcutBadge } from '@/components/shortcuts';
import { ComingSoonMarker } from '@/components/readiness';
import {
  shortcutRegistry,
  formatShortcutKeys,
  reservedShortcutFamily,
  validateShortcutBinding,
  type ShortcutPlatform,
} from '@/lib/shortcuts';
import {
  updateKeyboardShortcuts,
  resetKeyboardShortcuts,
} from '@/app/actions/preferences';
import {
  ConversationPrivacySettings,
  GoalVisualSettings,
  NotificationsSettings,
  PermissionsExplainer,
} from './notifications-settings';
import { eventToBinding } from '@/lib/shortcuts/format';
import {
  effectiveSystemHotkeys,
  findSystemShortcutConflict,
  type SymbolicHotkeysPlist,
  type SystemHotkey,
} from '@/lib/shortcuts/system-shortcuts';
import type {
  ShortcutCategory,
  ShortcutKeys,
  KeyBinding,
} from '@/types/shortcuts';
import {
  AlertCircle,
  Blocks,
  RotateCcw,
  Settings2,
  SlidersHorizontal,
  TriangleAlert,
} from 'lucide-react';
import { AgentSourcesSettings } from './agent-sources-settings';

type SettingsSection = 'agent-sources' | 'preferences';

function SettingsNavigation({
  active,
  onChange,
}: {
  active: SettingsSection;
  onChange: (section: SettingsSection) => void;
}) {
  const items = [
    {
      id: 'agent-sources' as const,
      label: 'Agent Sources',
      icon: Settings2,
    },
    {
      id: 'preferences' as const,
      label: 'Preferences',
      icon: SlidersHorizontal,
    },
  ];
  return (
    <aside className="exa-material-chrome border-b border-[var(--settings-line)] px-3 py-3 lg:border-r lg:border-b-0 lg:py-5">
      <p className="mb-2 hidden px-3 font-ui text-chrome-label font-medium text-[var(--settings-faint)] lg:block">
        Settings
      </p>
      <nav
        aria-label="Settings"
        className="flex gap-1 overflow-x-auto lg:flex-col"
      >
        {items.map(item => {
          const selected = item.id === active;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              aria-current={selected ? 'page' : undefined}
              className="flex min-h-11 shrink-0 items-center gap-2.5 rounded-lg border px-3 text-left font-ui text-sm outline-none transition-[background-color,border-color,color] focus-visible:ring-2 focus-visible:ring-[var(--settings-teal)] lg:w-full"
              style={{
                color: selected
                  ? 'var(--settings-text)'
                  : 'var(--settings-dim)',
                background: selected
                  ? 'var(--settings-teal-wash)'
                  : 'transparent',
                borderColor: selected
                  ? 'color-mix(in srgb, var(--settings-teal) 20%, transparent)'
                  : 'transparent',
              }}
            >
              <Icon
                aria-hidden
                size={17}
                style={{
                  color: selected ? 'var(--settings-teal)' : 'inherit',
                }}
              />
              <span>{item.label}</span>
            </button>
          );
        })}
        <div className="flex min-h-11 shrink-0 items-center gap-2.5 px-3 font-ui text-sm text-[var(--settings-faint)] lg:w-full">
          <Blocks aria-hidden size={17} />
          <span>Context &amp; Tools</span>
          <ComingSoonMarker className="ml-auto" />
        </div>
      </nav>
    </aside>
  );
}

const CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  workspace: 'Workspace',
  navigation: 'Navigation',
  actions: 'Actions',
  view: 'View',
  help: 'Help',
};

const CATEGORY_ORDER: ShortcutCategory[] = [
  'workspace',
  'navigation',
  'actions',
  'view',
  'help',
];

// Stable getter functions for useSyncExternalStore
const getSnapshot = () => shortcutRegistry.getByCategory();
const getServerSnapshot = () => shortcutRegistry.getByCategory();

function currentShortcutPlatform(): ShortcutPlatform {
  const electronPlatform = window.electron?.platform;
  if (
    electronPlatform === 'darwin' ||
    electronPlatform === 'win32' ||
    electronPlatform === 'linux'
  ) {
    return electronPlatform;
  }
  if (/Mac|iPhone|iPad/.test(navigator.userAgent)) return 'darwin';
  if (/Windows/.test(navigator.userAgent)) return 'win32';
  if (/Linux/.test(navigator.userAgent)) return 'linux';
  return 'other';
}

interface SystemHotkeyTable {
  hotkeys: SystemHotkey[];
  /** true = computed from this machine's real prefs (Electron); false =
   *  Apple-defaults fallback only (web — cannot verify, warn don't block) */
  verified: boolean;
}

export function SettingsClient() {
  const [activeSection, setActiveSection] =
    useState<SettingsSection>('agent-sources');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [recordedKeys, setRecordedKeys] = useState<KeyBinding[]>([]);
  const [bindingError, setBindingError] = useState<string | null>(null);
  const [bindingWarning, setBindingWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [systemTable, setSystemTable] = useState<SystemHotkeyTable | null>(
    null
  );

  // macOS system-shortcut truth (D19 amendment): read the machine's actual
  // symbolic-hotkey prefs so a combo the user freed in System Settings is
  // bindable here, and a combo the system really owns explains itself.
  useEffect(() => {
    if (currentShortcutPlatform() !== 'darwin') {
      setSystemTable({ hotkeys: [], verified: true });
      return;
    }
    let cancelled = false;
    const read = window.electron?.shortcuts?.systemHotkeys;
    if (!read) {
      setSystemTable({
        hotkeys: effectiveSystemHotkeys(null),
        verified: false,
      });
      return;
    }
    read()
      .then(plist => {
        if (cancelled) return;
        setSystemTable(
          plist === null
            ? { hotkeys: effectiveSystemHotkeys(null), verified: false }
            : {
                hotkeys: effectiveSystemHotkeys(plist as SymbolicHotkeysPlist),
                verified: true,
              }
        );
      })
      .catch(() => {
        if (cancelled) return;
        setSystemTable({
          hotkeys: effectiveSystemHotkeys(null),
          verified: false,
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const systemConflictFor = useCallback(
    (keys: ShortcutKeys): { error: string | null; warning: string | null } => {
      const table = systemTable ?? {
        hotkeys: effectiveSystemHotkeys(null),
        verified: false,
      };
      const conflict = findSystemShortcutConflict(keys, table.hotkeys, {
        verified: table.verified,
      });
      if (!conflict) return { error: null, warning: null };
      return conflict.verified
        ? { error: conflict.message, warning: null }
        : { error: null, warning: conflict.message };
    },
    [systemTable]
  );

  const subscribe = useCallback((callback: () => void) => {
    return shortcutRegistry.subscribe(callback);
  }, []);

  // Subscribe to registry changes
  const shortcuts = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );

  const startEditing = useCallback((shortcutId: string) => {
    setEditingId(shortcutId);
    setRecordedKeys([]);
    setBindingError(null);
    setBindingWarning(null);
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      // Ignore modifier-only presses
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) {
        return;
      }

      const reservation = reservedShortcutFamily(event.nativeEvent);
      if (reservation) {
        setRecordedKeys([]);
        setBindingError(reservation);
        setBindingWarning(null);
        return;
      }

      const binding = eventToBinding(event.nativeEvent);
      const shortcut = editingId ? shortcutRegistry.get(editingId) : undefined;
      const nextKeys = (() => {
        if (shortcut?.bindingPolicy === 'universal-command') return [binding];
        // If we already have 2 keys (a chord), start over
        if (recordedKeys.length >= 2) {
          return [binding];
        }
        return [...recordedKeys, binding];
      })();
      setRecordedKeys(nextKeys);

      const nextBinding: ShortcutKeys =
        nextKeys.length === 2 ? [nextKeys[0], nextKeys[1]] : nextKeys[0];
      const policyError = shortcut
        ? validateShortcutBinding(
            shortcut,
            nextBinding,
            currentShortcutPlatform()
          )
        : null;
      const system = systemConflictFor(nextBinding);
      setBindingError(policyError ?? system.error);
      setBindingWarning(system.warning);
    },
    [editingId, recordedKeys, systemConflictFor]
  );

  const saveShortcut = useCallback(async () => {
    if (!editingId || recordedKeys.length === 0) return;

    const newKeys: ShortcutKeys =
      recordedKeys.length === 2
        ? [recordedKeys[0], recordedKeys[1]]
        : recordedKeys[0];

    const shortcut = shortcutRegistry.get(editingId);
    const policyError = shortcut
      ? validateShortcutBinding(shortcut, newKeys, currentShortcutPlatform())
      : null;
    if (policyError) {
      setBindingError(policyError);
      return;
    }

    // A combo the SYSTEM verifiably owns can never reach the app — refuse
    // with the actionable message; an unverified (web) hit only warns.
    const system = systemConflictFor(newKeys);
    if (system.error) {
      setBindingError(system.error);
      return;
    }

    // Check for conflicts
    const conflict = shortcutRegistry.findConflict(newKeys, editingId);
    if (conflict) {
      setBindingError(
        `Conflicts with "${conflict.label}" (${formatShortcutKeys(shortcutRegistry.getEffectiveKeys(conflict.id)!)})`
      );
      return;
    }

    setSaving(true);
    try {
      shortcutRegistry.setOverride(editingId, newKeys);
      const overrides = shortcutRegistry.getOverrides();
      await updateKeyboardShortcuts(overrides);
      setEditingId(null);
      setRecordedKeys([]);
    } catch (error) {
      console.error('Failed to save shortcut:', error);
    } finally {
      setSaving(false);
    }
  }, [editingId, recordedKeys, systemConflictFor]);

  const resetToDefault = useCallback(async (shortcutId: string) => {
    shortcutRegistry.removeOverride(shortcutId);
    const overrides = shortcutRegistry.getOverrides();
    await updateKeyboardShortcuts(overrides);
  }, []);

  const resetAllToDefaults = useCallback(async () => {
    setSaving(true);
    try {
      shortcutRegistry.resetAllOverrides();
      await resetKeyboardShortcuts();
    } catch (error) {
      console.error('Failed to reset shortcuts:', error);
    } finally {
      setSaving(false);
    }
  }, []);

  const categories = CATEGORY_ORDER.filter(
    cat => shortcuts[cat] && shortcuts[cat].length > 0
  );
  const editingShortcut = editingId
    ? shortcutRegistry.get(editingId)
    : undefined;
  const editingUniversal =
    editingShortcut?.bindingPolicy === 'universal-command';

  return (
    <main
      data-settings-shell
      className="min-h-[calc(100vh-3.75rem)] bg-[var(--settings-page)] text-[var(--settings-text)]"
    >
      <h1 className="sr-only">Settings</h1>
      <div className="grid min-h-[calc(100vh-3.75rem)] grid-cols-1 lg:grid-cols-[190px_minmax(0,1fr)]">
        <SettingsNavigation
          active={activeSection}
          onChange={setActiveSection}
        />
        {activeSection === 'agent-sources' ? (
          <AgentSourcesSettings />
        ) : (
          <section
            aria-labelledby="preferences-heading"
            className="min-w-0 bg-[var(--settings-page)] px-4 py-6 sm:px-7 lg:px-9"
          >
            <div className="mx-auto max-w-4xl">
              <div className="mb-7 border-b border-[var(--settings-line)] pb-5">
                <h2
                  id="preferences-heading"
                  className="font-display text-display font-semibold tracking-[-0.02em]"
                >
                  Preferences
                </h2>
                <p className="mt-1 font-ui text-chrome-title text-[var(--settings-dim)]">
                  Personal controls for visuals, notifications, privacy, and
                  keyboard behavior.
                </p>
              </div>

              <GoalVisualSettings />
              <NotificationsSettings />
              <ConversationPrivacySettings />
              <PermissionsExplainer />

              <Card className="border-[var(--settings-line)] bg-[var(--settings-panel)] shadow-none">
                <CardHeader className="flex flex-row items-start justify-between gap-4 border-b border-[var(--settings-line)] px-5 py-4">
                  <div>
                    <CardTitle className="font-display text-reading text-[var(--settings-text)]">
                      Keyboard shortcuts
                    </CardTitle>
                    <CardDescription className="mt-1 font-ui text-chrome-label leading-5 text-[var(--settings-dim)]">
                      Click a shortcut to customize it. Press one or two keys to
                      set a new binding.
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={resetAllToDefaults}
                    disabled={saving}
                  >
                    <RotateCcw className="mr-1.5 h-4 w-4" />
                    Reset All
                  </Button>
                </CardHeader>
                <CardContent className="px-5 py-5">
                  <div className="space-y-6">
                    {categories.map(category => (
                      <div key={category}>
                        <h3 className="mb-2 font-mono text-chrome-meta font-semibold uppercase tracking-[0.1em] text-[var(--settings-faint)]">
                          {CATEGORY_LABELS[category]}
                        </h3>
                        <div className="divide-y divide-[var(--settings-line)] border-y border-[var(--settings-line)]">
                          {shortcuts[category].map(shortcut => {
                            const effectiveKeys =
                              shortcutRegistry.getEffectiveKeys(shortcut.id);
                            const hasOverride = shortcutRegistry.hasOverride(
                              shortcut.id
                            );

                            if (!effectiveKeys) return null;

                            return (
                              <div
                                key={shortcut.id}
                                className="group flex min-h-11 items-center justify-between px-2 py-2 transition-colors hover:bg-[var(--settings-hover)]"
                              >
                                <div className="flex items-center gap-3">
                                  <span className="font-ui text-chrome-title text-[var(--settings-soft)]">
                                    {shortcut.label}
                                  </span>
                                  {hasOverride && (
                                    <span className="text-xs text-muted-foreground">
                                      (customized)
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  {hasOverride && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="opacity-0 group-hover:opacity-100 transition-opacity h-7 px-2"
                                      onClick={() =>
                                        resetToDefault(shortcut.id)
                                      }
                                    >
                                      Reset
                                    </Button>
                                  )}
                                  <button
                                    onClick={() => startEditing(shortcut.id)}
                                    className="cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded"
                                  >
                                    <ShortcutBadge
                                      keys={effectiveKeys}
                                      size="md"
                                    />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>
        )}
      </div>

      {/* Edit Shortcut Dialog */}
      <Dialog open={!!editingId} onOpenChange={() => setEditingId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Shortcut</DialogTitle>
            <DialogDescription>
              {editingUniversal
                ? 'Press one key combination containing ⌘. This command must work from Terminal and text fields.'
                : 'Press one key for a simple shortcut, or two keys for a chord sequence (like G then D).'}
            </DialogDescription>
          </DialogHeader>

          <div
            data-shortcut-capture
            className="flex items-center justify-center p-8 border-2 border-dashed rounded-lg focus:outline-none focus:border-primary"
            tabIndex={0}
            onKeyDown={handleKeyDown}
          >
            {recordedKeys.length === 0 ? (
              <span className="text-muted-foreground">
                Press a key or key combination...
              </span>
            ) : (
              <div className="flex items-center gap-2">
                {recordedKeys.map((key, i) => (
                  <ShortcutBadge key={i} keys={key} size="md" />
                ))}
                {recordedKeys.length === 1 && !editingUniversal && (
                  <span className="text-sm text-muted-foreground ml-2">
                    Press another key for a chord, or save
                  </span>
                )}
              </div>
            )}
          </div>

          {bindingError && (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="h-4 w-4" />
              {bindingError}
            </div>
          )}
          {!bindingError && bindingWarning && (
            <div
              data-binding-warning
              className="flex items-start gap-2 text-sm text-[var(--exa-hud-amber)]"
            >
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              {bindingWarning}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingId(null)}>
              Cancel
            </Button>
            <Button
              onClick={saveShortcut}
              disabled={recordedKeys.length === 0 || !!bindingError || saving}
            >
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

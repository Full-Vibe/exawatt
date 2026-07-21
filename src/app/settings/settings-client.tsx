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
import {
  shortcutRegistry,
  formatShortcutKeys,
  reservedShortcutFamily,
  validateShortcutBinding,
  type ShortcutPlatform,
} from '@/lib/shortcuts';
import { updateKeyboardShortcuts, resetKeyboardShortcuts } from '@/app/actions/preferences';
import {
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
import type { ShortcutCategory, ShortcutKeys, KeyBinding } from '@/types/shortcuts';
import { RotateCcw, AlertCircle, TriangleAlert } from 'lucide-react';

const CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  workspace: 'Terminal Workspace',
  navigation: 'Navigation',
  actions: 'Actions',
  selection: 'Selection',
  view: 'View',
  help: 'Help',
};

const CATEGORY_ORDER: ShortcutCategory[] = [
  'workspace',
  'navigation',
  'actions',
  'selection',
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
                hotkeys: effectiveSystemHotkeys(
                  plist as SymbolicHotkeysPlist
                ),
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
  const shortcuts = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

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
      ? validateShortcutBinding(
          shortcut,
          newKeys,
          currentShortcutPlatform()
        )
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
    (cat) => shortcuts[cat] && shortcuts[cat].length > 0
  );
  const editingShortcut = editingId
    ? shortcutRegistry.get(editingId)
    : undefined;
  const editingUniversal =
    editingShortcut?.bindingPolicy === 'universal-command';

  return (
    <div className="container mx-auto py-6 px-4 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Customize your Exawatt experience</p>
      </div>

      <NotificationsSettings />
      <PermissionsExplainer />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Keyboard Shortcuts</CardTitle>
            <CardDescription>
              Click a shortcut to customize it. Press one or two keys to set a
              new binding.
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
        <CardContent>
          <div className="space-y-6">
            {categories.map((category) => (
              <div key={category}>
                <h3 className="text-sm font-semibold text-muted-foreground mb-3">
                  {CATEGORY_LABELS[category]}
                </h3>
                <div className="space-y-2">
                  {shortcuts[category].map((shortcut) => {
                    const effectiveKeys = shortcutRegistry.getEffectiveKeys(
                      shortcut.id
                    );
                    const hasOverride = shortcutRegistry.hasOverride(shortcut.id);

                    if (!effectiveKeys) return null;

                    return (
                      <div
                        key={shortcut.id}
                        className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted/50 transition-colors group"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-sm">{shortcut.label}</span>
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
                              onClick={() => resetToDefault(shortcut.id)}
                            >
                              Reset
                            </Button>
                          )}
                          <button
                            onClick={() => startEditing(shortcut.id)}
                            className="cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded"
                          >
                            <ShortcutBadge keys={effectiveKeys} size="md" />
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
              className="flex items-start gap-2 text-sm text-amber-500"
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
    </div>
  );
}

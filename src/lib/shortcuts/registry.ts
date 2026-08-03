import type {
  Shortcut,
  ShortcutOverride,
  ShortcutContext,
  ShortcutKeys,
  ShortcutCategory,
  KeyBinding,
} from '@/types/shortcuts';
import { isChord, bindingsMatch } from '@/types/shortcuts';

type Listener = () => void;

class ShortcutRegistry {
  private shortcuts: Map<string, Shortcut> = new Map();
  private overrides: Map<string, ShortcutOverride> = new Map();
  private activeContexts: Set<ShortcutContext> = new Set(['global']);
  private listeners: Set<Listener> = new Set();

  // Cached snapshot for useSyncExternalStore
  private _byCategoryCache: Record<ShortcutCategory, Shortcut[]> | null = null;
  private _version = 0;

  /** Register a shortcut */
  register(shortcut: Shortcut): void {
    this.shortcuts.set(shortcut.id, shortcut);
    this.notifyListeners();
  }

  /** Register multiple shortcuts */
  registerAll(shortcuts: Shortcut[]): void {
    shortcuts.forEach((s) => this.shortcuts.set(s.id, s));
    this.notifyListeners();
  }

  /** Unregister a shortcut */
  unregister(id: string): void {
    this.shortcuts.delete(id);
    this.notifyListeners();
  }

  /** Get a shortcut by ID */
  get(id: string): Shortcut | undefined {
    return this.shortcuts.get(id);
  }

  /** Get all registered shortcuts */
  getAll(): Shortcut[] {
    return Array.from(this.shortcuts.values());
  }

  /** Get effective keys for a shortcut (with overrides applied) */
  getEffectiveKeys(id: string): ShortcutKeys | undefined {
    const override = this.overrides.get(id);
    if (override) return override.keys;
    return this.shortcuts.get(id)?.keys;
  }

  /** Get all shortcuts for current active contexts */
  getActiveShortcuts(): Shortcut[] {
    return Array.from(this.shortcuts.values()).filter(
      (s) =>
        s.contexts.some((ctx) => this.activeContexts.has(ctx)) &&
        s.enabled !== false
    );
  }

  /** Find shortcut matching a key binding in current context */
  findByKey(binding: KeyBinding, chordPrefix?: KeyBinding): Shortcut | undefined {
    const activeShortcuts = this.getActiveShortcuts();

    for (const shortcut of activeShortcuts) {
      const keys = this.getEffectiveKeys(shortcut.id);
      if (!keys) continue;

      if (isChord(keys)) {
        // Chord sequence - need prefix to match
        if (
          chordPrefix &&
          bindingsMatch(keys[0], chordPrefix) &&
          bindingsMatch(keys[1], binding)
        ) {
          return shortcut;
        }
      } else {
        // Single key - only match if no chord prefix
        if (!chordPrefix && bindingsMatch(keys, binding)) {
          return shortcut;
        }
      }
    }
    return undefined;
  }

  /** Check if a key could start a chord */
  isChordStart(binding: KeyBinding): boolean {
    const activeShortcuts = this.getActiveShortcuts();
    return activeShortcuts.some((s) => {
      const keys = this.getEffectiveKeys(s.id);
      if (keys && isChord(keys)) {
        return bindingsMatch(keys[0], binding);
      }
      return false;
    });
  }

  /** Set active contexts (replaces all except 'global') */
  setContexts(contexts: ShortcutContext[]): void {
    this.activeContexts = new Set(['global', ...contexts]);
    this.notifyListeners();
  }

  /** Add a context */
  addContext(context: ShortcutContext): void {
    this.activeContexts.add(context);
    this.notifyListeners();
  }

  /** Remove a context */
  removeContext(context: ShortcutContext): void {
    if (context !== 'global') {
      this.activeContexts.delete(context);
      this.notifyListeners();
    }
  }

  /** Get current active contexts */
  getActiveContexts(): ShortcutContext[] {
    return Array.from(this.activeContexts);
  }

  /** Load overrides from server */
  loadOverrides(overrides: ShortcutOverride[]): void {
    this.overrides.clear();
    overrides.forEach((o) => this.overrides.set(o.shortcutId, o));
    this.notifyListeners();
  }

  /** Set a user override */
  setOverride(shortcutId: string, keys: ShortcutKeys): void {
    this.overrides.set(shortcutId, { shortcutId, keys });
    this.notifyListeners();
  }

  /** Remove a user override (revert to default) */
  removeOverride(shortcutId: string): void {
    this.overrides.delete(shortcutId);
    this.notifyListeners();
  }

  /** Get all overrides */
  getOverrides(): ShortcutOverride[] {
    return Array.from(this.overrides.values());
  }

  /** Reset all overrides */
  resetAllOverrides(): void {
    this.overrides.clear();
    this.notifyListeners();
  }

  /** Check if a shortcut has been customized */
  hasOverride(shortcutId: string): boolean {
    return this.overrides.has(shortcutId);
  }

  /** Check for conflicts with a proposed key binding */
  findConflict(
    keys: ShortcutKeys,
    excludeId?: string
  ): Shortcut | undefined {
    for (const shortcut of this.shortcuts.values()) {
      if (excludeId && shortcut.id === excludeId) continue;

      const effectiveKeys = this.getEffectiveKeys(shortcut.id);
      if (!effectiveKeys) continue;

      // Check if keys match
      if (this.keysMatch(keys, effectiveKeys)) {
        return shortcut;
      }
    }
    return undefined;
  }

  /** Check if two ShortcutKeys match */
  private keysMatch(a: ShortcutKeys, b: ShortcutKeys): boolean {
    if (isChord(a) && isChord(b)) {
      return bindingsMatch(a[0], b[0]) && bindingsMatch(a[1], b[1]);
    }
    if (!isChord(a) && !isChord(b)) {
      return bindingsMatch(a, b);
    }
    return false;
  }

  /** Get all shortcuts grouped by category (cached for useSyncExternalStore) */
  getByCategory(): Record<ShortcutCategory, Shortcut[]> {
    if (this._byCategoryCache) {
      return this._byCategoryCache;
    }

    const result: Record<ShortcutCategory, Shortcut[]> = {
      workspace: [],
      navigation: [],
      actions: [],
      view: [],
      help: [],
    };

    for (const shortcut of this.shortcuts.values()) {
      result[shortcut.category].push(shortcut);
    }

    this._byCategoryCache = result;
    return result;
  }

  /** Subscribe to changes */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Get version for useSyncExternalStore snapshot comparison */
  getVersion(): number {
    return this._version;
  }

  private notifyListeners(): void {
    this._byCategoryCache = null; // Invalidate cache
    this._version++; // Increment version for snapshot comparison
    this.listeners.forEach((l) => l());
  }
}

// Singleton instance
export const shortcutRegistry = new ShortcutRegistry();

import type { KeyBinding, ChordState } from '@/types/shortcuts';
import { shortcutRegistry } from './registry';
import { eventToBinding } from './format';

const CHORD_TIMEOUT_MS = 500;

type ChordListener = (pending: KeyBinding | null) => void;

/** Text fields own ordinary typing and Option-modified character entry. Global
 *  command modifiers remain available so an operator can leave search with
 *  Cmd+Shift+M or open Cmd+K/Cmd+/ without first moving focus. */
export function shouldIgnoreShortcutEvent(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;

  if (target.closest('[cmdk-input]')) return true;

  const tagName = target.tagName.toLowerCase();
  const editable =
    tagName === 'input' || tagName === 'textarea' || target.isContentEditable;
  return editable && !event.metaKey && !event.ctrlKey;
}

class ChordEngine {
  private state: ChordState = {
    pending: null,
    timestamp: 0,
  };
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private listeners: Set<ChordListener> = new Set();

  /** Process a key event, returns true if handled */
  processKeyEvent(event: KeyboardEvent): boolean {
    // Another handler (e.g. the workspace capture layer for ⌘1/⌘2/⌘3)
    // already consumed this keystroke — don't fire the action twice
    if (event.defaultPrevented) return false;
    // Skip if in input/textarea/contenteditable
    if (shouldIgnoreShortcutEvent(event)) return false;

    const binding = eventToBinding(event);

    // Check for chord completion
    if (this.state.pending) {
      const shortcut = shortcutRegistry.findByKey(binding, this.state.pending);
      if (shortcut) {
        event.preventDefault();
        this.clearPending();
        shortcut.action();
        return true;
      }
      // Chord didn't match, clear and try as new chord start or single key
      this.clearPending();
    }

    // Check for single-key shortcut
    const singleShortcut = shortcutRegistry.findByKey(binding);
    if (singleShortcut) {
      event.preventDefault();
      singleShortcut.action();
      return true;
    }

    // Check if this could be a chord start
    if (shortcutRegistry.isChordStart(binding)) {
      event.preventDefault();
      this.setPending(binding);
      return true;
    }

    return false;
  }

  /** Get the current pending chord key */
  getPending(): KeyBinding | null {
    return this.state.pending;
  }

  /** Clear any pending chord */
  clear(): void {
    this.clearPending();
  }

  /** Subscribe to chord state changes */
  subscribe(listener: ChordListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setPending(binding: KeyBinding): void {
    this.clearPending();
    this.state = {
      pending: binding,
      timestamp: Date.now(),
    };
    this.timeoutId = setTimeout(() => {
      this.clearPending();
    }, CHORD_TIMEOUT_MS);
    this.notifyListeners();
  }

  private clearPending(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    if (this.state.pending) {
      this.state = { pending: null, timestamp: 0 };
      this.notifyListeners();
    }
  }

  private notifyListeners(): void {
    const pending = this.state.pending;
    this.listeners.forEach((l) => l(pending));
  }
}

// Singleton instance
export const chordEngine = new ChordEngine();

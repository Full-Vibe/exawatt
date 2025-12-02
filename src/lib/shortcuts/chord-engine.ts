import type { KeyBinding, ChordState } from '@/types/shortcuts';
import { shortcutRegistry } from './registry';
import { eventToBinding } from './format';

const CHORD_TIMEOUT_MS = 500;

type ChordListener = (pending: KeyBinding | null) => void;

class ChordEngine {
  private state: ChordState = {
    pending: null,
    timestamp: 0,
  };
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private listeners: Set<ChordListener> = new Set();

  /** Process a key event, returns true if handled */
  processKeyEvent(event: KeyboardEvent): boolean {
    // Skip if in input/textarea/contenteditable
    if (this.shouldIgnoreEvent(event)) return false;

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

  private shouldIgnoreEvent(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement;
    const tagName = target.tagName.toLowerCase();

    // Ignore if typing in input, textarea, or contenteditable
    if (tagName === 'input' || tagName === 'textarea') return true;
    if (target.isContentEditable) return true;

    // Ignore if inside command palette input
    if (target.closest('[cmdk-input]')) return true;

    return false;
  }

  private notifyListeners(): void {
    const pending = this.state.pending;
    this.listeners.forEach((l) => l(pending));
  }
}

// Singleton instance
export const chordEngine = new ChordEngine();

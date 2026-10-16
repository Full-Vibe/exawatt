/**
 * The recipient's terminal, as the keystroke door sees it (ENG-029 C4).
 *
 * Two facts the door needs that only the byte stream knows: whether the TUI
 * has bracketed paste switched on (`ESC[?2004h` / `ESC[?2004l`, tracked as
 * the output flows, so a long Session whose scrollback dropped the switch
 * still answers), and when the TUI has finished answering a paste, so Enter
 * arrives as a separate write after it (B0: a burst ending in `\r` is read
 * as a newline inside the paste). The wait ends on the effect — output, then
 * quiet — and a bound keeps a TUI that never echoes from holding a message.
 */
import type { TerminalDoor } from './transports/types';

const ENABLE = '\x1b[?2004h';
const DISABLE = '\x1b[?2004l';
/** Enough of the previous chunk to find a switch split across two. */
const CARRY = ENABLE.length - 1;

interface TerminalSessions {
  on(event: 'data', listener: (id: string, data: string) => void): unknown;
  removeListener(
    event: 'data',
    listener: (id: string, data: string) => void
  ): unknown;
  /** False when the Session is gone or has exited: nothing was written. */
  write(id: string, data: string): boolean;
}

interface TerminalDoorOptions {
  /** Quiet after the echo that counts as "answered". */
  quietMs?: number;
  /** The longest a paste waits for its echo. */
  maxMs?: number;
  /** Marks the Session as given work when Enter is pressed. */
  engage?(id: string): void;
}

interface TerminalDoors {
  doorFor(ptyId: string): TerminalDoor;
  /** True once the program has switched bracketed paste on: its input is
   *  drawn. Every measured agent TUI does so the moment it can take input. */
  isUp(ptyId: string): boolean;
  /** Called once per Session, when it comes up. */
  onUp(listener: (ptyId: string) => void): () => void;
  dispose(): void;
}

export function createTerminalDoors(
  sessions: TerminalSessions,
  options: TerminalDoorOptions = {}
): TerminalDoors {
  const quietMs = options.quietMs ?? 150;
  const maxMs = options.maxMs ?? 1_500;
  const paste = new Map<string, boolean>();
  const carry = new Map<string, string>();
  const waiters = new Map<string, Set<() => void>>();
  const up = new Set<string>();
  const upListeners = new Set<(ptyId: string) => void>();
  const onData = (id: string, data: string) => {
    const text = (carry.get(id) ?? '') + data;
    const on = text.lastIndexOf(ENABLE);
    const off = text.lastIndexOf(DISABLE);
    if (on >= 0 || off >= 0) paste.set(id, on > off);
    if (on >= 0 && !up.has(id)) {
      up.add(id);
      for (const listener of upListeners) listener(id);
    }
    carry.set(id, text.slice(-CARRY));
    for (const notify of waiters.get(id) ?? []) notify();
  };
  sessions.on('data', onData);

  const settled = (ptyId: string) =>
    new Promise<void>(resolve => {
      let quiet: ReturnType<typeof setTimeout> | null = null;
      const done = () => {
        if (quiet) clearTimeout(quiet);
        clearTimeout(bound);
        waiters.get(ptyId)?.delete(notify);
        resolve();
      };
      const notify = () => {
        if (quiet) clearTimeout(quiet);
        quiet = setTimeout(done, quietMs);
      };
      const bound = setTimeout(done, maxMs);
      const set = waiters.get(ptyId) ?? new Set();
      set.add(notify);
      waiters.set(ptyId, set);
    });

  return {
    isUp: ptyId => up.has(ptyId),
    onUp(listener) {
      upListeners.add(listener);
      return () => upListeners.delete(listener);
    },
    doorFor(ptyId) {
      // The waiter is armed BEFORE the write, so an echo that arrives
      // synchronously with it is still seen.
      let answered: Promise<void> | null = null;
      return {
        bracketedPaste: () => paste.get(ptyId) ?? false,
        write(data) {
          answered = settled(ptyId);
          return sessions.write(ptyId, data);
        },
        settled: () => answered ?? Promise.resolve(),
        submit() {
          if (!sessions.write(ptyId, '\r')) return false;
          options.engage?.(ptyId);
          return true;
        },
      };
    },
    dispose() {
      sessions.removeListener('data', onData);
      for (const set of waiters.values()) for (const notify of set) notify();
      waiters.clear();
      upListeners.clear();
    },
  };
}

/**
 * Cross-surface workspace requests (ENG-015 S2): the ⌘K palette (mounted at
 * the app root) asks the workspace to activate a session or launch a
 * harness. Two delivery paths cover both mount states:
 *   - live: a window event, handled immediately if the workspace is mounted
 *   - pending: a module-level slot, consumed when the workspace mounts
 *     (palette → router.push('/workspace') → mount → consume)
 * Handlers consume the pending slot when they act on the live event, so a
 * request is never applied twice.
 */
import type { PtyHarness } from '@/types/electron';

export const SESSION_JUMP_EVENT = 'exawatt:open-session';
export const LAUNCH_EVENT = 'exawatt:launch';
/** tab-strip listens: open the inline rename editor for the active tab */
export const RENAME_ACTIVE_EVENT = 'exawatt:rename-active';
/** the active terminal pane refocuses itself (rename editors steal focus —
 *  the keyboard flow must land back in the terminal) */
export const FOCUS_ACTIVE_TERMINAL_EVENT = 'exawatt:focus-active-terminal';
/** palette → workspace verbs (S3): only offered while ON /workspace, so
 *  they are plain live events — no pending slots needed */
export const TOGGLE_SPLIT_EVENT = 'exawatt:toggle-split';
export const JUMP_ATTENTION_EVENT = 'exawatt:jump-attention';
export const CLOSE_ACTIVE_EVENT = 'exawatt:close-active-tab';
export const OPEN_OVERVIEW_EVENT = 'exawatt:open-overview';

/** a pending request older than this is abandoned, not replayed — a slot
 *  that survived an unmount must not yank the workspace around minutes
 *  later on an unrelated visit */
const PENDING_TTL_MS = 15_000;

interface Pending<T> {
  value: T;
  at: number;
}

let pendingSession: Pending<string> | null = null;
let pendingLaunch: Pending<PtyHarness> | null = null;

function take<T>(slot: Pending<T> | null): T | null {
  if (!slot) return null;
  return Date.now() - slot.at <= PENDING_TTL_MS ? slot.value : null;
}

export function requestSessionJump(sessionId: string): void {
  pendingSession = { value: sessionId, at: Date.now() };
  window.dispatchEvent(
    new CustomEvent(SESSION_JUMP_EVENT, { detail: sessionId })
  );
}

export function requestLaunch(harness: PtyHarness): void {
  pendingLaunch = { value: harness, at: Date.now() };
  window.dispatchEvent(new CustomEvent(LAUNCH_EVENT, { detail: harness }));
}

export function consumePendingSessionJump(): string | null {
  const p = take(pendingSession);
  pendingSession = null;
  return p;
}

export function consumePendingLaunch(): PtyHarness | null {
  const p = take(pendingLaunch);
  pendingLaunch = null;
  return p;
}

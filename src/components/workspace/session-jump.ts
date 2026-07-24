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
import type { AgentSourceId } from './agent-sources';

export const SESSION_JUMP_EVENT = 'exawatt:open-session';
export const LAUNCH_EVENT = 'exawatt:launch';
/** Open a known Project by directory, resolving it without creating a PTY. */
export const OPEN_PROJECT_EVENT = 'exawatt:open-project';
export const OPEN_PROJECT_PICKER_EVENT = 'exawatt:open-project-picker';
export const FOCUS_AGENT_COMPOSER_EVENT = 'exawatt:focus-agent-composer';
/** tab-strip listens: open the inline rename editor for the active tab */
export const RENAME_ACTIVE_EVENT = 'exawatt:rename-active';
/** Open the active Project's combined rename/color editor. */
export const EDIT_ACTIVE_PROJECT_EVENT = 'exawatt:edit-active-project';
/** the active terminal pane refocuses itself (rename editors steal focus —
 *  the keyboard flow must land back in the terminal) */
export const FOCUS_ACTIVE_TERMINAL_EVENT = 'exawatt:focus-active-terminal';
/** palette → workspace verbs (S3): only offered while ON /workspace, so
 *  they are plain live events — no pending slots needed */
export const TOGGLE_SPLIT_EVENT = 'exawatt:toggle-split';
export const JUMP_ATTENTION_EVENT = 'exawatt:jump-attention';
export const CLOSE_ACTIVE_EVENT = 'exawatt:close-active-tab';
/** palette → workspace: resurrect a Recently-closed Session (D23);
 *  detail = { durableSessionId } */
export const REOPEN_CLOSED_EVENT = 'exawatt:reopen-closed-session';
/** native menu → workspace: reopen the ledger's newest recoverable Session */
export const REOPEN_LAST_CLOSED_EVENT = 'exawatt:reopen-last-closed-session';
export const OPEN_OVERVIEW_EVENT = 'exawatt:open-overview';
/** palette/menu → summon the Project roadmap at the Sessions altitude (S12) */
export const OPEN_ROADMAP_EVENT = 'exawatt:open-roadmap';

/** a pending request older than this is abandoned, not replayed — a slot
 *  that survived an unmount must not yank the workspace around minutes
 *  later on an unrelated visit */
const PENDING_TTL_MS = 15_000;
const AGENT_COMPOSER_TTL_MS = 5 * 60_000;

interface Pending<T> {
  value: T;
  at: number;
}

let pendingSession: Pending<string> | null = null;
let pendingLaunch: Pending<PtyHarness> | null = null;
let pendingOpenProject: Pending<string> | null = null;
let pendingProjectPicker: Pending<true> | null = null;
let pendingAgentComposer: Pending<AgentSourceId | null> | null = null;
let pendingReopenLastClosed: Pending<true> | null = null;

function take<T>(slot: Pending<T> | null): T | null {
  if (!slot) return null;
  return Date.now() - slot.at <= PENDING_TTL_MS ? slot.value : null;
}

export function requestReopenLastClosed(): void {
  pendingReopenLastClosed = { value: true, at: Date.now() };
  window.dispatchEvent(new CustomEvent(REOPEN_LAST_CLOSED_EVENT));
}

export function consumePendingReopenLastClosed(): boolean {
  const pending = take(pendingReopenLastClosed);
  pendingReopenLastClosed = null;
  return pending === true;
}

/** back/forward (D27): select a workspace TAB by identity — works for
 *  stopped tabs and drafts, which have no live session id */
export const TAB_SELECT_EVENT = 'exawatt:select-tab';
let pendingTabSelect: Pending<{ dir: string; tabId: string }> | null = null;
export function requestTabSelect(dir: string, tabId: string): void {
  pendingTabSelect = { value: { dir, tabId }, at: Date.now() };
  window.dispatchEvent(
    new CustomEvent(TAB_SELECT_EVENT, { detail: { dir, tabId } })
  );
}
export function consumePendingTabSelect(): {
  dir: string;
  tabId: string;
} | null {
  const value = take(pendingTabSelect);
  pendingTabSelect = null;
  return value;
}
export function hasPendingTabSelect(): boolean {
  return take(pendingTabSelect) !== null;
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

export function requestOpenProject(dir: string): void {
  pendingOpenProject = { value: dir, at: Date.now() };
  window.dispatchEvent(new CustomEvent(OPEN_PROJECT_EVENT, { detail: dir }));
}

export function consumePendingOpenProject(): string | null {
  const p = take(pendingOpenProject);
  pendingOpenProject = null;
  return p;
}

export function requestProjectPicker(): void {
  pendingProjectPicker = { value: true, at: Date.now() };
  window.dispatchEvent(new CustomEvent(OPEN_PROJECT_PICKER_EVENT));
}

export function consumePendingProjectPicker(): boolean {
  const pending = take(pendingProjectPicker);
  pendingProjectPicker = null;
  return pending === true;
}

export function requestAgentComposer(
  source: AgentSourceId | null = null
): void {
  pendingAgentComposer = { value: source, at: Date.now() };
  window.dispatchEvent(
    new CustomEvent(FOCUS_AGENT_COMPOSER_EVENT, { detail: source })
  );
}

export function consumePendingAgentComposer():
  | AgentSourceId
  | null
  | undefined {
  if (!pendingAgentComposer) return undefined;
  const slot = pendingAgentComposer;
  pendingAgentComposer = null;
  return Date.now() - slot.at <= AGENT_COMPOSER_TTL_MS ? slot.value : undefined;
}

export function hasPendingAgentComposer(): boolean {
  return (
    !!pendingAgentComposer &&
    Date.now() - pendingAgentComposer.at <= AGENT_COMPOSER_TTL_MS
  );
}

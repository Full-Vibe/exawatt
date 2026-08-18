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
import { personalTenantActive } from '@/lib/tenancy/active-tenant';
import type { AgentSourceId } from './agent-sources';
import type { CloneSessionTarget } from './session-clone';

/**
 * Exact composer selection carried across route changes. This intentionally
 * lives beside the request boundary instead of persistence: callers can focus
 * the composer with either a durable configuration identity, a complete
 * snapshot, or both. Source-only requests remain valid for native menu and
 * legacy shortcut callers.
 */
export type AgentComposerConfigurationSnapshot =
  | {
      kind: 'agent';
      source: AgentSourceId;
      model: string | null;
      effort: string | null;
      agentTypeId?: string | null;
    }
  | { kind: 'shell' };

export interface AgentComposerConfigurationRequest {
  configurationId?: string;
  configuration?: AgentComposerConfigurationSnapshot;
}

export type AgentComposerRequest =
  | AgentSourceId
  | AgentComposerConfigurationRequest
  | null;

export const SESSION_JUMP_EVENT = 'exawatt:open-session';
export const LAUNCH_EVENT = 'exawatt:launch';
/** Open a known Project by directory, resolving it without creating a PTY. */
export const OPEN_PROJECT_EVENT = 'exawatt:open-project';
export const OPEN_PROJECT_PICKER_EVENT = 'exawatt:open-project-picker';
/**
 * ENG-010 C2. Connect lives on the ⌘N chooser as a peer route, so entering it
 * from the File menu opens the chooser already on that route rather than
 * opening a second door to the same place.
 */
export const OPEN_CONNECT_SOURCE_EVENT = 'exawatt:open-connect-source';
export const FOCUS_AGENT_COMPOSER_EVENT = 'exawatt:focus-agent-composer';
/** Active Project publishes the exact frozen ribbon catalog to global command
 * surfaces. Empty detail clears stale rows when the composer unmounts. */
export const LAUNCH_CONFIGURATION_CATALOG_EVENT =
  'exawatt:launch-configuration-catalog';
export const CLONE_TARGET_CATALOG_EVENT = 'exawatt:clone-target-catalog';
export const CLONE_ACTIVE_AGENT_EVENT = 'exawatt:clone-active-agent';
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
/** palette → workspace: relaunch recovery (D36/D47). Two scopes only —
 *  the selected Agent, and the recovery bar's own default scope. Semantics
 *  stay entirely in the workspace: these events carry no identity, so a row
 *  can never ask for a resume the bar would not perform. */
export const RESUME_ACTIVE_AGENT_EVENT = 'exawatt:resume-active-agent';
export const RESUME_PARKED_SCOPE_EVENT = 'exawatt:resume-parked-scope';
export const CLOSE_ACTIVE_EVENT = 'exawatt:close-active-tab';
/** palette/menu → workspace: close the ACTIVE Project, Sessions and all. The
 *  workspace owns the consequence: with tabs open it raises the same
 *  confirmation the strip's Close project raises, so no entry point can make
 *  an Agent lose its turn without being asked (FIX-011). */
export const CLOSE_ACTIVE_PROJECT_EVENT = 'exawatt:close-active-project';
/** palette/menu → workspace: reveal the active Session's working directory in
 *  Finder, falling back to the active Project's own directory. Carries no
 *  path: only the workspace knows which one is selected, and a path on the
 *  wire would let a stale row open a directory the operator left behind. */
export const REVEAL_ACTIVE_PATH_EVENT = 'exawatt:reveal-active-path';
/** palette/menu → workspace: nudge the active tab within its Project
 *  (the ⌘⌥[/⌘⌥] fixed family, D20); detail = { delta: 1 | -1 } */
export const MOVE_ACTIVE_TAB_EVENT = 'exawatt:move-active-tab';
/** palette/menu → workspace: nudge the active Project in the ribbon
 *  (the ⌘⌥⇧[/⌘⌥⇧] fixed family, D20); detail = { delta: 1 | -1 } */
export const MOVE_ACTIVE_PROJECT_EVENT = 'exawatt:move-active-project';
/** palette → workspace: resurrect a Recently-closed Session (D23);
 *  detail = { durableSessionId } */
export const REOPEN_CLOSED_EVENT = 'exawatt:reopen-closed-session';
/** native menu → workspace: reopen the ledger's newest recoverable Session */
export const REOPEN_LAST_CLOSED_EVENT = 'exawatt:reopen-last-closed-session';
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
let pendingConnectSource: Pending<true> | null = null;
let pendingAgentComposer: Pending<AgentComposerRequest> | null = null;
let pendingReopenLastClosed: Pending<true> | null = null;

function take<T>(slot: Pending<T> | null): T | null {
  if (!slot) return null;
  return Date.now() - slot.at <= PENDING_TTL_MS ? slot.value : null;
}

/**
 * Launch-family guard (ENG-027): verbs that open or spawn something in the
 * PERSONAL workspace are inert while any other tenant is on screen. Without
 * this, a verb invoked inside the Demo tenant stores a pending slot that
 * fires a shell/composer/reopen against Personal local truth after the next
 * switch back. One gate here covers every dispatch path (native menu, ⌘K,
 * future callers) — request functions fail closed, not per-call-site.
 */
function launchVerbsAvailable(): boolean {
  return personalTenantActive();
}

export function requestReopenLastClosed(): void {
  if (!launchVerbsAvailable()) return;
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
export function requestSessionJump(sessionId: string): void {
  pendingSession = { value: sessionId, at: Date.now() };
  window.dispatchEvent(
    new CustomEvent(SESSION_JUMP_EVENT, { detail: sessionId })
  );
}

export function requestLaunch(harness: PtyHarness): void {
  if (!launchVerbsAvailable()) return;
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
  if (!launchVerbsAvailable()) return;
  pendingOpenProject = { value: dir, at: Date.now() };
  window.dispatchEvent(new CustomEvent(OPEN_PROJECT_EVENT, { detail: dir }));
}

export function consumePendingOpenProject(): string | null {
  const p = take(pendingOpenProject);
  pendingOpenProject = null;
  return p;
}

export function requestProjectPicker(): void {
  if (!launchVerbsAvailable()) return;
  pendingProjectPicker = { value: true, at: Date.now() };
  window.dispatchEvent(new CustomEvent(OPEN_PROJECT_PICKER_EVENT));
}

export function consumePendingProjectPicker(): boolean {
  const pending = take(pendingProjectPicker);
  pendingProjectPicker = null;
  return pending === true;
}

export function requestConnectAgentSource(): void {
  if (!launchVerbsAvailable()) return;
  pendingConnectSource = { value: true, at: Date.now() };
  window.dispatchEvent(new CustomEvent(OPEN_CONNECT_SOURCE_EVENT));
}

export function consumePendingConnectAgentSource(): boolean {
  const pending = take(pendingConnectSource);
  pendingConnectSource = null;
  return pending === true;
}

export function requestAgentComposer(
  request: AgentComposerRequest = null
): void {
  if (!launchVerbsAvailable()) return;
  pendingAgentComposer = { value: request, at: Date.now() };
  window.dispatchEvent(
    new CustomEvent(FOCUS_AGENT_COMPOSER_EVENT, { detail: request })
  );
}

export function requestCloneActiveAgent(target: CloneSessionTarget): void {
  if (!launchVerbsAvailable()) return;
  window.dispatchEvent(
    new CustomEvent(CLONE_ACTIVE_AGENT_EVENT, { detail: target })
  );
}

export function consumePendingAgentComposerRequest():
  | AgentComposerRequest
  | undefined {
  if (!pendingAgentComposer) return undefined;
  const slot = pendingAgentComposer;
  pendingAgentComposer = null;
  return Date.now() - slot.at <= AGENT_COMPOSER_TTL_MS ? slot.value : undefined;
}

/** Source-only compatibility for existing callers while they migrate. */
export function consumePendingAgentComposer():
  | AgentSourceId
  | null
  | undefined {
  return consumePendingAgentComposerRequest() as
    | AgentSourceId
    | null
    | undefined;
}

export function hasPendingAgentComposer(): boolean {
  return (
    !!pendingAgentComposer &&
    Date.now() - pendingAgentComposer.at <= AGENT_COMPOSER_TTL_MS
  );
}

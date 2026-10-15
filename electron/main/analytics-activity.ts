import {
  isAgentHarness,
  isAgentPermissionMode,
  type AgentHarness,
  type PtyHarness,
} from '@exawatt/core';
import { isAnalyticsId } from '@exawatt/core/desktop-bridge';
import { queueMainAnalyticsEvent } from './analytics-bridge';
import { claimWebLink, takeFirstAgentLaunch } from './analytics-identity';

/**
 * ENG-047 — the Agent activity and the web-to-app link, as main sees them.
 *
 * Main owns the processes, so it is the one place that knows an Agent
 * started (`pty:create` accepted it) and ended (its process exited). Each
 * fact is queued on the analytics bridge and leaves, if at all, through the
 * renderer's allowlisted path: the installation stream for `agent_launched`,
 * a signed-in account's stream for both (decision `0053`). A Shell is not an
 * Agent and is never counted. Nothing here reads a task, a path, or output.
 */

export interface AgentActivityDependencies {
  firstAgentLaunch: () => boolean;
  claimWebLink: () => boolean;
  queue: typeof queueMainAnalyticsEvent;
}

const DEFAULTS: AgentActivityDependencies = {
  firstAgentLaunch: takeFirstAgentLaunch,
  claimWebLink,
  queue: queueMainAnalyticsEvent,
};

/** Session id → harness, for Agents that have not finished yet. */
const live = new Map<string, AgentHarness>();

/** After `pty:create` accepted a launch. */
export function recordAgentLaunched(
  session: { id: string; harness: PtyHarness },
  options: { permissionMode?: unknown },
  deps: AgentActivityDependencies = DEFAULTS
): void {
  const { harness } = session;
  if (!isAgentHarness(harness)) return;
  try {
    live.set(session.id, harness);
    deps.queue({
      name: 'agent_launched',
      harness,
      permissionMode: isAgentPermissionMode(options.permissionMode)
        ? options.permissionMode
        : null,
      firstForInstall: deps.firstAgentLaunch(),
    });
  } catch {
    // Analytics never propagate a failure into a launch.
  }
}

/** When a process main started exits. Shells and unknown ids are ignored. */
export function recordAgentFinished(
  sessionId: string,
  deps: AgentActivityDependencies = DEFAULTS
): void {
  const harness = live.get(sessionId);
  if (!harness) return;
  live.delete(sessionId);
  deps.queue({ name: 'agent_finished', harness });
}

/**
 * `exawatt://welcome?w=<web id>` (ENG-047 F2): the download page's "Open
 * Exawatt". A well-formed id asks for the alias the first time only, and
 * never while opted out; a repeat, a malformed id, or no id records nothing.
 */
export function recordWebLink(
  webId: unknown,
  deps: AgentActivityDependencies = DEFAULTS
): boolean {
  if (!isAnalyticsId(webId)) return false;
  if (!deps.claimWebLink()) return false;
  deps.queue({ name: 'web_alias', webId });
  return true;
}

/** Test seam. */
export function __resetAgentActivityForTests(): void {
  live.clear();
}

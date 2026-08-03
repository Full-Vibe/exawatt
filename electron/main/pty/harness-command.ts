import path from 'path';
import type { AgentPermissionMode } from './session-manager';
import type { AgentHarness } from './harness-types';
import { harnessDescriptor } from './harness-registry';

const SAFE_SESSION_ID = /^[a-zA-Z0-9_-]{8,128}$/;
const AGENT_PERMISSION_MODES = new Set<AgentPermissionMode>([
  'prompt',
  'auto',
  'unrestricted',
]);

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/** Optional launch wiring that is not part of the Agent request itself.
 *  An options bag rather than yet another positional: this is the seam future
 *  source-side plumbing extends. */
export interface HarnessLaunchWiring {
  /** Settings document subscribing this launch to the harness event channel
   *  (ENG-023). Absent for sources with no push mechanism. */
  eventChannelSettingsPath?: string;
  /** Collision-resistant source-agent identity for per-launch config. */
  launchAgentName?: string;
}

export function buildHarnessCommand(
  harness: AgentHarness,
  harnessSessionId: string | null,
  resume: boolean,
  executable?: string,
  initialPrompt?: string,
  permissionMode: AgentPermissionMode = 'unrestricted',
  model?: string,
  effort?: string,
  wiring: HarnessLaunchWiring = {}
): string {
  if (harnessSessionId && !SAFE_SESSION_ID.test(harnessSessionId)) {
    throw new Error('Invalid harness session ID');
  }
  if (executable && !executable.startsWith('/')) {
    throw new Error('Harness executable override must be absolute');
  }
  const prompt = initialPrompt?.trim() ?? '';
  if (prompt.includes('\0') || prompt.length > 8_000) {
    throw new Error('Initial task is invalid or too long');
  }
  if (resume && prompt) {
    throw new Error('An initial task cannot be supplied when resuming');
  }
  if (!AGENT_PERMISSION_MODES.has(permissionMode)) {
    throw new Error('Invalid Agent permission mode');
  }
  const selectedModel = model?.trim() ?? '';
  if (
    selectedModel &&
    (selectedModel.length > 512 ||
      /[\s\u0000-\u001f\u007f]/.test(selectedModel))
  ) {
    throw new Error('Invalid Agent model');
  }
  const selectedEffort = effort?.trim() ?? '';
  if (
    selectedEffort &&
    (selectedEffort.length > 32 || !/^[a-z][a-z0-9_-]*$/.test(selectedEffort))
  ) {
    throw new Error('Invalid Agent effort');
  }
  if (selectedEffort && selectedEffort !== 'auto' && !selectedModel) {
    throw new Error('Agent effort requires a selected model');
  }
  const settingsPath = wiring.eventChannelSettingsPath;
  if (settingsPath && !path.isAbsolute(settingsPath)) {
    throw new Error('Event channel settings path must be absolute');
  }
  const descriptor = harnessDescriptor(harness);
  const command = executable ? shellQuote(executable) : descriptor.id;
  const launchAgentName = wiring.launchAgentName?.trim() ?? '';
  if (
    launchAgentName &&
    !/^exawatt-[a-z0-9][a-z0-9-]{7,100}$/.test(launchAgentName)
  ) {
    throw new Error('Invalid harness launch agent name');
  }
  if (descriptor.launchAgent && !launchAgentName) {
    throw new Error('Harness launch agent name is required');
  }
  const configuredCommand = descriptor.launchAgent
    ? descriptor.launchAgent.invocation(
        command,
        launchAgentName,
        descriptor.launchAgent.configuration(
          launchAgentName,
          permissionMode,
          selectedModel || null,
          selectedEffort && selectedEffort !== 'auto' ? selectedEffort : null
        )
      )
    : command;
  const permissionInvocation = [
    configuredCommand,
    descriptor.permissionFlags(permissionMode),
  ]
    .filter(Boolean)
    .join(' ');
  // Subscribe BEFORE the Agent-shaped flags so the launch reads as
  // "this harness, wired to Exawatt, then asked to do X".
  const baseInvocation =
    settingsPath && descriptor.eventChannel
      ? descriptor.eventChannel.invocation(permissionInvocation, settingsPath)
      : permissionInvocation;
  const modelInvocation =
    selectedModel && !descriptor.launchAgent
      ? descriptor.modelInvocation(baseInvocation, shellQuote(selectedModel))
      : baseInvocation;
  const invocation =
    selectedEffort && selectedEffort !== 'auto' && !descriptor.launchAgent
      ? descriptor.effortInvocation(modelInvocation, selectedEffort)
      : modelInvocation;
  if (resume) {
    if (!harnessSessionId)
      throw new Error('Exact session ID required to resume');
    return descriptor.resumeInvocation(invocation, harnessSessionId);
  }
  const fresh = descriptor.freshInvocation(invocation, harnessSessionId);
  return prompt
    ? descriptor.initialTaskInvocation(fresh, shellQuote(prompt))
    : fresh;
}

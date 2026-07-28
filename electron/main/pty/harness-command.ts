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
  const settingsPath = wiring.eventChannelSettingsPath;
  if (settingsPath && !path.isAbsolute(settingsPath)) {
    throw new Error('Event channel settings path must be absolute');
  }
  const descriptor = harnessDescriptor(harness);
  const command = executable ? shellQuote(executable) : descriptor.id;
  const permissionInvocation = `${command} ${descriptor.permissionFlags(permissionMode)}`;
  // Subscribe BEFORE the Agent-shaped flags so the launch reads as
  // "this harness, wired to Exawatt, then asked to do X".
  const baseInvocation =
    settingsPath && descriptor.eventChannelInvocation
      ? descriptor.eventChannelInvocation(permissionInvocation, settingsPath)
      : permissionInvocation;
  const modelInvocation = selectedModel
    ? descriptor.modelInvocation(baseInvocation, shellQuote(selectedModel))
    : baseInvocation;
  const invocation =
    selectedEffort && selectedEffort !== 'auto'
      ? descriptor.effortInvocation(modelInvocation, selectedEffort)
      : modelInvocation;
  if (resume) {
    if (!harnessSessionId)
      throw new Error('Exact session ID required to resume');
    return descriptor.resumeInvocation(invocation, harnessSessionId);
  }
  const fresh = descriptor.freshInvocation(invocation, harnessSessionId);
  return prompt ? `${fresh} ${shellQuote(prompt)}` : fresh;
}

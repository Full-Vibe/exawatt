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

export function buildHarnessCommand(
  harness: AgentHarness,
  harnessSessionId: string | null,
  resume: boolean,
  executable?: string,
  initialPrompt?: string,
  permissionMode: AgentPermissionMode = 'unrestricted',
  model?: string
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
  const descriptor = harnessDescriptor(harness);
  const command = executable ? shellQuote(executable) : descriptor.id;
  const baseInvocation = `${command} ${descriptor.permissionFlags(permissionMode)}`;
  const invocation = selectedModel
    ? descriptor.modelInvocation(baseInvocation, shellQuote(selectedModel))
    : baseInvocation;
  if (resume) {
    if (!harnessSessionId)
      throw new Error('Exact session ID required to resume');
    return descriptor.resumeInvocation(invocation, harnessSessionId);
  }
  const fresh = descriptor.freshInvocation(invocation, harnessSessionId);
  return prompt ? `${fresh} ${shellQuote(prompt)}` : fresh;
}

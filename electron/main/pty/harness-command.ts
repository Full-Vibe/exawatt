import type { AgentPermissionMode, PtyHarness } from './session-manager';

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
  harness: Exclude<PtyHarness, 'shell'>,
  harnessSessionId: string | null,
  resume: boolean,
  executable?: string,
  initialPrompt?: string,
  permissionMode: AgentPermissionMode = 'unrestricted'
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
  const command = executable ? shellQuote(executable) : harness;
  const permissionFlags =
    harness === 'claude'
      ? permissionMode === 'prompt'
        ? '--permission-mode default'
        : permissionMode === 'auto'
          ? '--permission-mode auto'
          : '--dangerously-skip-permissions'
      : permissionMode === 'prompt'
        ? '--sandbox workspace-write --ask-for-approval on-request'
        : permissionMode === 'auto'
          ? `--sandbox workspace-write --ask-for-approval on-request -c ${shellQuote(
              'approvals_reviewer="auto_review"'
            )}`
          : '--dangerously-bypass-approvals-and-sandbox';
  const invocation = `${command} ${permissionFlags}`;
  if (resume) {
    if (!harnessSessionId)
      throw new Error('Exact session ID required to resume');
    return harness === 'claude'
      ? `${invocation} --resume ${harnessSessionId}`
      : `${invocation} resume ${harnessSessionId}`;
  }
  const fresh =
    harness === 'claude' && harnessSessionId
      ? `${invocation} --session-id ${harnessSessionId}`
      : invocation;
  return prompt ? `${fresh} ${shellQuote(prompt)}` : fresh;
}

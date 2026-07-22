import type { AgentHarness, AgentPermissionMode } from './harness-types';

interface HarnessLaunchDescriptor {
  id: AgentHarness;
  /** Some CLIs require Exawatt to allocate identity before a fresh launch. */
  allocatesFreshSessionId: boolean;
  permissionFlags: (mode: AgentPermissionMode) => string;
  modelInvocation: (invocation: string, quotedModel: string) => string;
  resumeInvocation: (invocation: string, sessionId: string) => string;
  freshInvocation: (invocation: string, sessionId: string | null) => string;
}

const workspaceReviewFlags = (mode: AgentPermissionMode): string =>
  mode === 'prompt'
    ? '--sandbox workspace-write --ask-for-approval on-request'
    : mode === 'auto'
      ? `--sandbox workspace-write --ask-for-approval on-request -c 'approvals_reviewer="auto_review"'`
      : '--dangerously-bypass-approvals-and-sandbox';

const descriptors = {
  claude: {
    id: 'claude',
    allocatesFreshSessionId: true,
    permissionFlags: mode =>
      mode === 'prompt'
        ? '--permission-mode default'
        : mode === 'auto'
          ? '--permission-mode auto'
          : '--dangerously-skip-permissions',
    modelInvocation: (invocation, quotedModel) =>
      `${invocation} --model ${quotedModel}`,
    resumeInvocation: (invocation, sessionId) =>
      `${invocation} --resume ${sessionId}`,
    freshInvocation: (invocation, sessionId) =>
      sessionId ? `${invocation} --session-id ${sessionId}` : invocation,
  },
  codex: {
    id: 'codex',
    allocatesFreshSessionId: false,
    permissionFlags: workspaceReviewFlags,
    modelInvocation: (invocation, quotedModel) =>
      `${invocation} --model ${quotedModel}`,
    resumeInvocation: (invocation, sessionId) =>
      `${invocation} resume ${sessionId}`,
    freshInvocation: invocation => invocation,
  },
} satisfies Record<AgentHarness, HarnessLaunchDescriptor>;

export function harnessDescriptor(
  harness: AgentHarness
): HarnessLaunchDescriptor {
  return descriptors[harness];
}

import type { AgentHarness, AgentPermissionMode } from './harness-types';

/**
 * Whether a source reports the work it delegates, and how (ENG-023).
 *
 * `observable: false` is a real answer, not a zero. A Codex Session has no
 * delegated share to show — which is a different fact from "it delegated
 * nothing" — and every surface must render that as absent rather than as an
 * empty count or a broken affordance.
 */
export type DelegationCapability =
  | { observable: true; mechanism: 'settings-hooks' }
  | { observable: false; reason: string };

interface HarnessLaunchDescriptor {
  id: AgentHarness;
  /** Some CLIs require Exawatt to allocate identity before a fresh launch. */
  allocatesFreshSessionId: boolean;
  delegation: DelegationCapability;
  /** Subscribe this launch to Exawatt's harness event channel. Omitted by
   *  sources with no push mechanism, which simply launch unsubscribed. */
  eventChannelInvocation?: (invocation: string, settingsPath: string) => string;
  permissionFlags: (mode: AgentPermissionMode) => string;
  modelInvocation: (invocation: string, quotedModel: string) => string;
  effortInvocation: (invocation: string, effort: string) => string;
  resumeInvocation: (invocation: string, sessionId: string) => string;
  freshInvocation: (invocation: string, sessionId: string | null) => string;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
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
    // Verified 2026-07-27: hooks supplied this way MERGE with the user's own
    // project and local hooks instead of replacing them, and nothing under
    // the user's harness configuration is written.
    delegation: { observable: true, mechanism: 'settings-hooks' },
    eventChannelInvocation: (invocation, settingsPath) =>
      `${invocation} --settings ${shellQuote(settingsPath)}`,
    permissionFlags: mode =>
      mode === 'prompt'
        ? '--permission-mode default'
        : mode === 'auto'
          ? '--permission-mode auto'
          : '--dangerously-skip-permissions',
    modelInvocation: (invocation, quotedModel) =>
      `${invocation} --model ${quotedModel}`,
    effortInvocation: (invocation, effort) =>
      `${invocation} --effort ${shellQuote(effort)}`,
    resumeInvocation: (invocation, sessionId) =>
      `${invocation} --resume ${sessionId}`,
    freshInvocation: (invocation, sessionId) =>
      sessionId ? `${invocation} --session-id ${sessionId}` : invocation,
  },
  codex: {
    id: 'codex',
    allocatesFreshSessionId: false,
    // Codex has no Agent/Task tool, and ENG-008 E0 measured zero delegated
    // records across its whole local corpus. Its hooks are also trust-gated
    // (`trusted_hash` in config.toml), so Exawatt must not inject silently
    // even once there is something to report.
    delegation: {
      observable: false,
      reason: 'Codex does not report delegated work',
    },
    permissionFlags: workspaceReviewFlags,
    modelInvocation: (invocation, quotedModel) =>
      `${invocation} --model ${quotedModel}`,
    effortInvocation: (invocation, effort) =>
      `${invocation} -c ${shellQuote(`model_reasoning_effort="${effort}"`)}`,
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

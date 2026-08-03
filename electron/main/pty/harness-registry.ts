import type { AgentHarness, AgentPermissionMode } from './harness-types';
import type { AgentSourceDeclaration } from '@exawatt/core';
import { agentSourceDeclaration } from './generated-agent-source-declarations';
import type { HarnessEventNormalizer } from '../harness-events/channel';
import {
  claudeHookEvent,
  claudeHookSettings,
} from '../harness-events/claude-hooks';

/**
 * How a source is wired to Exawatt's harness event channel (ENG-023).
 *
 * Kept together so a source cannot declare half of a mechanism: the document
 * Exawatt writes, the flag that makes the harness read it, and the parser for
 * what comes back are one decision. A second push source supplies its OWN
 * normalizer here rather than inheriting whichever one a call site happened to
 * hardcode.
 */
export interface HarnessEventChannelBinding {
  /** Build the settings document Exawatt writes for one launch. */
  settings: (port: number, token: string) => string;
  /** Point the launch at that document. */
  invocation: (invocation: string, settingsPath: string) => string;
  /** Translate this source's payloads into the shared event vocabulary. */
  normalize: HarnessEventNormalizer;
}

/** A uniquely named source agent carrying one launch's model and policy. */
export interface HarnessLaunchAgentBinding {
  configuration: (
    name: string,
    mode: AgentPermissionMode,
    model: string | null,
    effort: string | null
  ) => string;
  invocation: (
    invocation: string,
    name: string,
    configuration: string
  ) => string;
}

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

export interface HarnessLaunchDescriptor {
  id: AgentHarness;
  /** Stable operator-facing source metadata. Renderer code receives this
   * through the normalized source registry; it must not grow a second copy. */
  source: AgentSourceDeclaration & {
    executable: string;
    versionArgs: readonly string[];
    authStatusArgs: readonly string[];
    authLoginArgs: readonly string[];
    authOwner: string;
  };
  /** Some CLIs require Exawatt to allocate identity before a fresh launch. */
  allocatesFreshSessionId: boolean;
  delegation: DelegationCapability;
  /** Subscribe this launch to Exawatt's harness event channel. Omitted by
   *  sources with no push mechanism, which simply launch unsubscribed. */
  eventChannel?: HarnessEventChannelBinding;
  launchAgent?: HarnessLaunchAgentBinding;
  permissionFlags: (mode: AgentPermissionMode) => string;
  modelInvocation: (invocation: string, quotedModel: string) => string;
  effortInvocation: (invocation: string, effort: string) => string;
  initialTaskInvocation: (invocation: string, quotedTask: string) => string;
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

function opencodePermission(mode: AgentPermissionMode): Record<string, string> {
  if (mode === 'prompt') {
    // OpenCode uses the LAST matching ordered rule. Wildcard first, then the
    // read-only exceptions, makes this launch agent ask for everything else.
    return {
      '*': 'ask',
      read: 'allow',
      glob: 'allow',
      grep: 'allow',
      list: 'allow',
      question: 'allow',
      todowrite: 'allow',
      skill: 'allow',
      plan_enter: 'allow',
      plan_exit: 'allow',
    };
  }
  if (mode === 'auto') {
    return {
      '*': 'allow',
      external_directory: 'ask',
      doom_loop: 'ask',
    };
  }
  return { '*': 'allow' };
}

function opencodeLaunchAgentConfiguration(
  name: string,
  mode: AgentPermissionMode,
  model: string | null,
  effort: string | null
): string {
  return JSON.stringify({
    agent: {
      [name]: {
        mode: 'primary',
        ...(model ? { model } : {}),
        ...(model && effort ? { variant: effort } : {}),
        permission: opencodePermission(mode),
      },
    },
  });
}

const descriptors = {
  claude: {
    id: 'claude',
    source: {
      ...agentSourceDeclaration('claude'),
      executable: 'claude',
      versionArgs: ['--version'],
      authStatusArgs: ['auth', 'status', '--json'],
      authLoginArgs: ['auth', 'login'],
      authOwner: 'Claude Code',
    },
    allocatesFreshSessionId: true,
    // Verified 2026-07-27: hooks supplied this way MERGE with the user's own
    // project and local hooks instead of replacing them, and nothing under
    // the user's harness configuration is written.
    delegation: { observable: true, mechanism: 'settings-hooks' },
    eventChannel: {
      settings: claudeHookSettings,
      invocation: (invocation, settingsPath) =>
        `${invocation} --settings ${shellQuote(settingsPath)}`,
      normalize: claudeHookEvent,
    },
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
    initialTaskInvocation: (invocation, quotedTask) =>
      `${invocation} ${quotedTask}`,
    resumeInvocation: (invocation, sessionId) =>
      `${invocation} --resume ${sessionId}`,
    freshInvocation: (invocation, sessionId) =>
      sessionId ? `${invocation} --session-id ${sessionId}` : invocation,
  },
  codex: {
    id: 'codex',
    source: {
      ...agentSourceDeclaration('codex'),
      executable: 'codex',
      versionArgs: ['--version'],
      authStatusArgs: ['login', 'status'],
      authLoginArgs: ['login'],
      authOwner: 'Codex',
    },
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
    initialTaskInvocation: (invocation, quotedTask) =>
      `${invocation} ${quotedTask}`,
    resumeInvocation: (invocation, sessionId) =>
      `${invocation} resume ${sessionId}`,
    freshInvocation: invocation => invocation,
  },
  opencode: {
    id: 'opencode',
    source: {
      ...agentSourceDeclaration('opencode'),
      executable: 'opencode',
      versionArgs: ['--version'],
      authStatusArgs: ['auth', 'list'],
      authLoginArgs: ['auth', 'login'],
      authOwner: 'OpenCode',
    },
    // OpenCode creates the source identity only when the first turn is
    // submitted. SessionManager captures it from `session list --format json`
    // and thereafter resumes only with the exact `-s` identity.
    allocatesFreshSessionId: false,
    delegation: {
      observable: false,
      reason: 'OpenCode PTY does not report delegated work',
    },
    launchAgent: {
      configuration: opencodeLaunchAgentConfiguration,
      invocation: (invocation, name, configuration) =>
        `sh -c ${shellQuote(
          `if [ -n "\${OPENCODE_CONFIG_CONTENT-}" ]; then printf '%s\\n' '[exawatt] OpenCode launch cannot replace an existing OPENCODE_CONFIG_CONTENT value.' >&2; exit 78; fi; configuration=$1; shift; export OPENCODE_CONFIG_CONTENT="$configuration"; exec "$@"`
        )} sh ${shellQuote(configuration)} ${invocation} --agent ${shellQuote(name)}`,
    },
    permissionFlags: () => '',
    modelInvocation: (invocation, quotedModel) =>
      `${invocation} -m ${quotedModel}`,
    // Model and variant live on the unique launch agent. The 1.3.4 root TUI
    // accepts --agent but not the headless-only --variant argv flag.
    effortInvocation: invocation => invocation,
    initialTaskInvocation: (invocation, quotedTask) =>
      `${invocation} --prompt ${quotedTask}`,
    resumeInvocation: (invocation, sessionId) =>
      `${invocation} -s ${sessionId}`,
    freshInvocation: invocation => invocation,
  },
} satisfies Record<AgentHarness, HarnessLaunchDescriptor>;

export function harnessDescriptor(
  harness: AgentHarness
): HarnessLaunchDescriptor {
  return descriptors[harness];
}

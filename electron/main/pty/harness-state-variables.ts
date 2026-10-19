import type { AgentHarness } from './harness-types';

/**
 * The variables each harness reads to find its own state or choose its
 * model, as that harness documents them. One declaration, read by two
 * owners that must never disagree:
 *
 * - the login-environment resolver (`harness-homes.ts`) asks the operator's
 *   login shell for exactly these, because a Finder-launched app inherits
 *   none of them (BUG-297);
 * - the app-node test setup (`vitest.setup.app-node.ts`) clears every one,
 *   so no test reads the operator's real harness state (BUG-298).
 *
 * Exhaustive over `AgentHarness`: a new harness fails type-check here until
 * it says which variables point at its state, and a variable added here is
 * resolved and made hermetic in the same edit.
 *
 * Leaf module on purpose (type-only imports): the test setup loads it before
 * every test file's mocks are registered.
 */
const HARNESS_STATE_VARIABLES = {
  claude: [
    'CLAUDE_CONFIG_DIR',
    'ANTHROPIC_MODEL',
    'ANTHROPIC_CUSTOM_MODEL_OPTION',
    'ANTHROPIC_CUSTOM_MODEL_OPTION_NAME',
    'ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION',
    'CLAUDE_CODE_EFFORT_LEVEL',
  ],
  codex: ['CODEX_HOME'],
  opencode: [
    'XDG_CONFIG_HOME',
    'OPENCODE_CONFIG',
    'OPENCODE_CONFIG_DIR',
    'OPENCODE_CONFIG_CONTENT',
  ],
  grok: ['GROK_HOME'],
  qwen: ['QWEN_HOME', 'QWEN_RUNTIME_DIR'],
  antigravity: [],
} as const satisfies Record<AgentHarness, readonly string[]>;

/**
 * Every variable the login-environment resolver reads: `HOME`, which every
 * harness resolves its default home from, and each harness's own.
 */
export const LOGIN_ENVIRONMENT_KEYS: readonly string[] = [
  ...new Set(['HOME', ...Object.values(HARNESS_STATE_VARIABLES).flat()]),
];

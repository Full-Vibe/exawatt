/** Built-in Agent Source identities. New sources register their launch,
 * conversation, and renderer capabilities at explicit boundaries rather than
 * growing conditionals throughout the application. */
export const BUILT_IN_AGENT_HARNESSES = ['claude', 'codex'] as const;
export type AgentHarness = (typeof BUILT_IN_AGENT_HARNESSES)[number];
export type PtyHarness = 'shell' | AgentHarness;
export type AgentPermissionMode = 'prompt' | 'auto' | 'unrestricted';

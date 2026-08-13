/**
 * Harness registry for the Agent Terminal Workspace (ENG-002).
 *
 * PTY presentation metadata shared by live Session chrome. Agent Sources use
 * the capability registry in agent-sources.ts; shell remains a Project tool.
 * Main-process command resolution lives in electron/main/pty/session-manager.ts.
 */
import type { PtyHarness } from '@/types/electron';
import { AGENT_SOURCE_META } from './agent-sources';

export interface HarnessMeta {
  /** tab title + picker label */
  label: string;
  /** status-diamond + accent color */
  color: string;
  /** legacy compact caption retained for Session chrome */
  launch: string;
}

export const HARNESS_META: Record<PtyHarness, HarnessMeta> = {
  // brand colors: Anthropic terracotta / OpenAI neutral-on-dark.
  // "+" prefix: the button CREATES a new session — "launch" language in
  // tooltips/palette ("launch" was internal shorthand, unclear to users;
  // operator, dogfood round 4)
  claude: { ...AGENT_SOURCE_META.claude, launch: '+ Claude Code' },
  codex: { ...AGENT_SOURCE_META.codex, launch: '+ Codex' },
  opencode: { ...AGENT_SOURCE_META.opencode, launch: '+ OpenCode' },
  grok: { ...AGENT_SOURCE_META.grok, launch: '+ Grok Build' },
  // Source identity is a brand/data channel and stays stable across themes.
  shell: { label: 'Shell', color: '#6A7585', launch: '+ Shell' },
};

/** derived from the registry — declaration order IS display order */
export const HARNESS_ORDER = Object.keys(HARNESS_META) as PtyHarness[];

/** Is this title just the harness's own name (never renamed by the operator)?
 *  The harness glyph already carries source identity, so a default title is
 *  pure redundancy once a goal subtitle exists (operator, D18 follow-up) —
 *  chrome hides it then. Tolerates the raw harness id ('codex') that older
 *  persisted tabs carried as their fallback title. */
export function isDefaultHarnessTitle(
  harness: PtyHarness,
  title: string
): boolean {
  const normalized = title.trim().toLowerCase();
  return (
    normalized === HARNESS_META[harness].label.toLowerCase() ||
    normalized === harness
  );
}

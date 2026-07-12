/**
 * Harness registry for the Agent Terminal Workspace (ENG-002).
 *
 * PTY presentation metadata shared by live Session chrome. Agent Sources use
 * the capability registry in agent-sources.ts; shell remains a Project tool.
 * Main-process command resolution lives in electron/main/pty/session-manager.ts.
 */
import { HUD } from '@/components/hud';
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
  shell: { label: 'Shell', color: HUD.idle, launch: '+ Shell' },
};

/** derived from the registry — declaration order IS display order */
export const HARNESS_ORDER = Object.keys(HARNESS_META) as PtyHarness[];

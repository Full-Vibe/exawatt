/**
 * Harness registry for the Agent Terminal Workspace (ENG-002).
 *
 * A harness is what an operator IGNITES — the product gesture is agent-first
 * (decision 0005), so this is the single place a new harness type (OpenClaw,
 * custom CLIs, ...) gets registered for the workspace UI. The main-process
 * command resolution lives in electron/main/pty/session-manager.ts.
 */
import { HUD } from '@/components/hud';
import type { PtyHarness } from '@/types/electron';

export interface HarnessMeta {
  /** tab title + picker label */
  label: string;
  /** status-diamond + accent color */
  color: string;
  /** ignite button caption */
  ignite: string;
}

export const HARNESS_META: Record<PtyHarness, HarnessMeta> = {
  // brand colors: Anthropic terracotta / OpenAI neutral-on-dark
  claude: { label: 'Claude Code', color: '#D97757', ignite: 'Claude Code' },
  codex: { label: 'Codex', color: '#ECECEC', ignite: 'Codex' },
  shell: { label: 'Shell', color: HUD.idle, ignite: '+ Shell' },
};

/** derived from the registry — declaration order IS display order */
export const HARNESS_ORDER = Object.keys(HARNESS_META) as PtyHarness[];

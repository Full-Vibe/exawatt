/**
 * Harness registry for the Agent Terminal Workspace (ENG-002).
 *
 * PTY presentation metadata shared by live Session chrome. Agent Sources use
 * the capability registry in agent-sources.ts; shell remains a Project tool.
 * Main-process command resolution lives in electron/main/pty/session-manager.ts.
 */
import { WORKSPACE_HUD } from './workspace-theme';
import { AGENT_SOURCE_META, mapAgentSources } from './agent-sources';
import { isPtyHarness, type PtyHarness } from '@exawatt/core';

export interface HarnessMeta {
  /** tab title + picker label */
  label: string;
  /** status-diamond + accent color */
  color: string;
  /** legacy compact caption retained for Session chrome */
  launch: string;
}

export const HARNESS_META: Record<PtyHarness, HarnessMeta> = {
  // "+" prefix: the button CREATES a new session — "launch" language in
  // tooltips/palette ("launch" was internal shorthand, unclear to users;
  // operator, dogfood round 4)
  ...mapAgentSources(source => {
    const meta = AGENT_SOURCE_META[source];
    return { ...meta, launch: `+ ${meta.label}` };
  }),
  // Source identity is a brand/data channel and stays stable across themes.
  shell: { label: 'Shell', color: '#6A7585', launch: '+ Shell' },
};

/** derived from the registry — declaration order IS display order */
export const HARNESS_ORDER = Object.keys(HARNESS_META) as PtyHarness[];

/** Saved source identity outlives the set of executables this build knows.
 * Presentation is total; only `harness !== null` admits a local runtime verb. */
export function sessionSource(source: string): {
  id: string;
  harness: PtyHarness | null;
  label: string;
  color: string;
  unavailableReason: string | null;
} {
  if (isPtyHarness(source)) {
    return {
      id: source,
      harness: source,
      ...HARNESS_META[source],
      unavailableReason: null,
    };
  }
  return {
    id: source,
    harness: null,
    label: source,
    color: WORKSPACE_HUD.textDim,
    unavailableReason: `This version of Exawatt does not support ${source}. Your Session is kept; source actions are unavailable.`,
  };
}

/** A draft's explicit source choice is part of its saved work, even though
 * its not-yet-launched tab still carries the placeholder harness. */
export function sessionTabSource(tab: {
  harness: string;
  lifecycle: string;
  draftSource?: string | null;
}) {
  return sessionSource(
    tab.lifecycle === 'draft' && tab.draftSource ? tab.draftSource : tab.harness
  );
}

/** Is this title just the harness's own name (never renamed by the operator)?
 *  The harness glyph already carries source identity, so a default title is
 *  pure redundancy once a goal subtitle exists (operator, D18 follow-up) —
 *  chrome hides it then. Tolerates the raw harness id ('codex') that older
 *  persisted tabs carried as their fallback title. */
export function isDefaultHarnessTitle(harness: string, title: string): boolean {
  const normalized = title.trim().toLowerCase();
  return (
    normalized === sessionSource(harness).label.toLowerCase() ||
    normalized === harness
  );
}

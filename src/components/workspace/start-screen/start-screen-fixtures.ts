/**
 * Test fixtures for the Start screen (ENG-046): suggestions in the shape
 * `projects:suggestions` answers, and launch registries whose sources are in
 * the states a first run meets. Built from the real fallback registry so a
 * fixture source can never carry a field the boundary does not.
 */
import type {
  AgentSourceRegistrySnapshot,
  AgentSourceState,
} from '@exawatt/core';
import type {
  HarnessProjectSuggestion,
  HarnessStoreRead,
  ProjectSuggestionHarness,
} from '@exawatt/core/desktop-bridge';
import { fallbackAgentSourceRegistry } from '../agent-sources';

export const FIXTURE_NOW = 1_800_000_000_000;
const DAY = 86_400_000;

export function suggestionFixture(
  name: string,
  harnesses: ProjectSuggestionHarness[],
  daysAgo: number | null
): HarnessProjectSuggestion {
  const path = `/Users/operator/Code/${name}`;
  const at = daysAgo === null ? null : FIXTURE_NOW - daysAgo * DAY;
  return {
    path,
    commonDir: `${path}/.git`,
    name,
    harnesses,
    lastActivityAt: at,
    recent: at !== null && daysAgo! <= 30,
    evidence: harnesses.map(harness => ({
      harness,
      store:
        harness === 'claude'
          ? 'claude-code-transcripts'
          : harness === 'codex'
            ? 'codex-sessions'
            : 'antigravity-conversations',
      directory: path,
      observedAt: at,
      label: null,
    })),
  };
}

export function storeReads(
  overrides: Partial<
    Record<HarnessStoreRead['store'], Partial<HarnessStoreRead>>
  > = {}
): HarnessStoreRead[] {
  const base: HarnessStoreRead[] = [
    {
      harness: 'claude',
      store: 'claude-code-config',
      status: 'read',
      entries: 3,
    },
    {
      harness: 'claude',
      store: 'claude-code-transcripts',
      status: 'read',
      entries: 3,
    },
    { harness: 'codex', store: 'codex-config', status: 'read', entries: 2 },
    { harness: 'codex', store: 'codex-sessions', status: 'read', entries: 2 },
    {
      harness: 'antigravity',
      store: 'antigravity-projects',
      status: 'missing',
      entries: 0,
    },
    {
      harness: 'antigravity',
      store: 'antigravity-conversations',
      status: 'missing',
      entries: 0,
    },
  ];
  return base.map(read => ({ ...read, ...overrides[read.store] }));
}

/** The launch registry with each named harness in the given state; every
 *  other local source not installed. */
export function registryWith(
  states: Partial<Record<string, AgentSourceState>>
): AgentSourceRegistrySnapshot {
  const fallback = fallbackAgentSourceRegistry('launch');
  return {
    ...fallback,
    sources: fallback.sources.map(source => {
      const state =
        (source.harness && states[source.harness]) || 'not-installed';
      return {
        ...source,
        state,
        stateLabel: state,
        launchable: state !== 'not-installed',
        configured: state !== 'not-installed',
        actions: {
          ...source.actions,
          recheck: true,
          authenticate: state === 'action-required',
          installGuide: state === 'not-installed',
        },
      };
    }),
  };
}

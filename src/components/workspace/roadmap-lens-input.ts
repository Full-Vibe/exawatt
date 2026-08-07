/**
 * The workspace's side of the roadmap-lens join (ENG-015 S6, ENG-017).
 *
 * Two surfaces feed `useProjectRoadmap` the same projection of a Project's
 * live tabs — the Terminal altitude (rail + context-bar chip) and the Team
 * altitude (the docked rail beside the grid). Both used to inline the same
 * ~25-line block, and the copies had already drifted syntactically the way
 * copies do: one wrapped `sessionTurnFacts` in a memoized helper, the other
 * spread the sources inline. Same shape as BUG-009's two attention
 * predicates — two consumers restating a contract nobody had written down —
 * so the contract now lives here and both call it.
 *
 * Eligibility rides D51's one rule: a Session is projected exactly when a
 * surface would paint it, via `paintsAttention` for the needs-you bit.
 *
 * Pure; no hooks. Callers memoize with their own dependency lists.
 */
import type { SessionLink } from '@exawatt/core';
import type { RoadmapSessionDescriptor } from '@/components/roadmap/use-project-roadmap';
import {
  paintsAttention,
  sessionLensTurnState,
  sessionTurnFacts,
  type SessionAttentionSignal,
  type SessionTurnSources,
} from './session-status';
import { tabIsLive, type WorkspaceTab } from './use-workspace-state';

export function projectRoadmapSessions(
  tabs: readonly WorkspaceTab[] | undefined,
  attention: Readonly<Record<string, SessionAttentionSignal>>,
  sources: SessionTurnSources
): RoadmapSessionDescriptor[] {
  return (tabs ?? [])
    .filter(t => t.sessionId && tabIsLive(t))
    .map(t => ({
      sessionId: t.sessionId as string,
      tabId: t.id,
      title: t.title,
      harness: t.harness,
      cwd: t.cwd,
      contextSummary: sources.summaries[t.durableSessionId] ?? null,
      initialTask: t.initialTask,
      needsAttention: paintsAttention(
        { sessionId: t.sessionId, live: tabIsLive(t) },
        attention
      ),
      startedAt: t.startedAt ?? null,
      turnState: sessionLensTurnState({
        facts: sessionTurnFacts(t, sources),
        attention: attention[t.sessionId as string],
      }),
    }));
}

/** Declared-at-launch links (S4): machine-local tab annotations that
 *  override inference; a declared id the roadmap no longer contains falls
 *  to the unmapped shelf, never silently back to inference. */
export function projectDeclaredLinks(
  tabs: readonly WorkspaceTab[] | undefined,
  projectDir: string
): SessionLink[] {
  return (tabs ?? [])
    .filter(t => t.roadmapItemId && t.sessionId && tabIsLive(t))
    .map(t => ({
      sessionId: t.sessionId as string,
      tabId: t.id,
      projectDir,
      itemId: t.roadmapItemId as string,
      method: 'declared' as const,
      confidence: 'high' as const,
      evidence: [{ kind: 'declared' as const, excerpt: 'declared at launch' }],
      evaluatedAt: 0,
    }));
}

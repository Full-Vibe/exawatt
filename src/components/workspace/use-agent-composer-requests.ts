'use client';

import { useEffect, useEffectEvent } from 'react';
import { isAgentSourceId } from './agent-sources';
import {
  claimPendingAgentComposer,
  FOCUS_AGENT_COMPOSER_EVENT,
  type AgentComposerRequest,
} from './session-jump';
import {
  projectRootPath,
  type Project,
  type WorkspaceDraftPatch,
} from './workspace-state/workspace-model';

/**
 * Answers New Agent requests (⌘N, the palette, the Fleet board's ghost slot)
 * in the workspace. Each request is acted on once: a live request when its
 * event arrives, and a request that arrived before the workspace mounted
 * once the layout has loaded. Both claim the request itself, so neither a
 * re-render nor a remount of the workspace answers it again, and the
 * Project chooser opens once per request instead of reopening for as long
 * as the request stays pending (BUG-327).
 */
export function useAgentComposerRequests({
  enabled,
  ready,
  projects,
  activeProject,
  createDraftTab,
  summonProjectOpener,
}: {
  enabled: boolean;
  /** The persisted layout has loaded, so "no active Project" is a fact. */
  ready: boolean;
  projects: readonly Project[];
  activeProject: Project | null | undefined;
  createDraftTab: (dir?: string, seed?: WorkspaceDraftPatch) => string | null;
  summonProjectOpener: () => void;
}): void {
  // A request bound to a Project opens its draft THERE: the same draft tab
  // and composer ⌘T opens, in the Project the operator pointed at.
  const openBoundDraft = (dir: string) => {
    const project = projects.find(candidate => candidate.dir === dir);
    if (!project || projectRootPath(project) === null) {
      summonProjectOpener();
      return;
    }
    if (!createDraftTab(project.dir)) summonProjectOpener();
  };

  const onRequest = useEffectEvent((request: AgentComposerRequest) => {
    if (request && typeof request === 'object' && request.projectDir) {
      openBoundDraft(request.projectDir);
      return;
    }
    if (!activeProject || projectRootPath(activeProject) === null) {
      summonProjectOpener();
      return;
    }
    // the summon IS a new tab now (D24): the draft pane hosts the composer,
    // and a palette source override rides ON the draft
    createDraftTab(
      undefined,
      typeof request === 'string' && isAgentSourceId(request)
        ? { draftSource: request, draftTouched: true }
        : undefined
    );
  });

  // The request usually arrives from another route, before this workspace
  // has mounted: it waits in the pending slot until the layout is loaded.
  // The composer the draft hosts consumes it for its source and focus.
  const onPendingAtMount = useEffectEvent(() => {
    const claim = claimPendingAgentComposer();
    if (!claim) return;
    const { request } = claim;
    if (request && typeof request === 'object' && request.projectDir) {
      openBoundDraft(request.projectDir);
    } else if (!activeProject) {
      summonProjectOpener();
    }
  });
  useEffect(() => {
    if (!enabled || !ready) return;
    onPendingAtMount();
  }, [enabled, ready]);

  useEffect(() => {
    if (!enabled) return;
    const listener = (event: Event) => {
      // The event IS the pending request; claim it so a later mount of the
      // workspace does not answer it a second time.
      claimPendingAgentComposer();
      onRequest((event as CustomEvent<AgentComposerRequest>).detail ?? null);
    };
    window.addEventListener(FOCUS_AGENT_COMPOSER_EVENT, listener);
    return () =>
      window.removeEventListener(FOCUS_AGENT_COMPOSER_EVENT, listener);
  }, [enabled]);
}

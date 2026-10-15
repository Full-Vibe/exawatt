'use client';

import { useCallback, useMemo, useState } from 'react';
import type { ProjectCatalogEntry } from '@exawatt/core';
import {
  selectSpatialGhostSlots,
  type SpatialBoardGhostSlot,
  type SpatialBoardLayout,
} from '@exawatt/ui-model';
import { requestAgentComposer } from '@/components/workspace/session-jump';
import { rememberSpatialReturn } from '@/components/nav/spatial-return';

/**
 * What activating a ghost does, decided from the facts the board has
 * (ENG-004 V4.2). Exactly one answer per ghost, so the notice a ghost raises
 * and the composer it opens can never disagree.
 */
export type GhostActivation =
  | { kind: 'compose'; projectDir: string }
  | { kind: 'unavailable'; reason: string };

export function ghostActivation(facts: {
  zoneLabel: string;
  project: ProjectCatalogEntry | undefined;
  isDemo: boolean;
  canLaunch: boolean;
}): GhostActivation {
  if (facts.isDemo) {
    return { kind: 'unavailable', reason: 'Demo cannot start Agents.' };
  }
  if (!facts.canLaunch) {
    return {
      kind: 'unavailable',
      reason: 'Open the desktop app to start Agents.',
    };
  }
  // A folderless Project offers the ghost and says what is missing; the
  // folder-dependent verb itself stays absent (concepts.md).
  if (!facts.project || typeof facts.project.rootPath !== 'string') {
    return {
      kind: 'unavailable',
      reason: `${facts.zoneLabel} has no folder on this Mac, so Agents cannot start here.`,
    };
  }
  return { kind: 'compose', projectDir: facts.project.id };
}

/**
 * Ghost slots for the Fleet board: the allocation, the in-flight record, and
 * the one activation path. Starting an Agent goes through THE composer (the
 * workspace's draft tab and `AgentLauncher`), opened in the ghost's Project
 * through the existing pending-slot request; the board never launches.
 */
export function useGhostSlots({
  layout,
  projects,
  isDemo,
  openWorkspace,
}: {
  layout: SpatialBoardLayout;
  projects: readonly ProjectCatalogEntry[];
  isDemo: boolean;
  openWorkspace: () => void;
}) {
  // Zone id -> its population when the operator asked. The launch is in
  // flight until the Project grows past it; the reserved ghost then becomes
  // the Agent that arrived.
  const [launches, setLaunches] = useState<ReadonlyMap<string, number>>(
    () => new Map()
  );
  const pendingZoneIds = useMemo(() => {
    const pending = new Set<string>();
    for (const zone of layout.zones) {
      const asked = launches.get(zone.id);
      if (asked !== undefined && zone.agentCount <= asked) pending.add(zone.id);
    }
    return pending;
  }, [launches, layout.zones]);
  const ghostSlots = useMemo(
    () => selectSpatialGhostSlots(layout, { pendingZoneIds }),
    [layout, pendingZoneIds]
  );
  const [notice, setNotice] = useState<string | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);
  const projectsByZone = useMemo(
    () => new Map(projects.map(project => [`project:${project.id}`, project])),
    [projects]
  );

  const activateGhost = useCallback(
    (ghost: SpatialBoardGhostSlot) => {
      const zone = layout.zones.find(entry => entry.id === ghost.zoneId);
      const activation = ghostActivation({
        zoneLabel: zone?.label ?? 'This Project',
        project: projectsByZone.get(ghost.zoneId),
        isDemo,
        canLaunch:
          typeof window !== 'undefined' && Boolean(window.electron?.pty),
      });
      if (activation.kind === 'unavailable') {
        setNotice(activation.reason);
        return;
      }
      setNotice(null);
      setLaunches(previous =>
        new Map(previous).set(ghost.zoneId, zone?.agentCount ?? 0)
      );
      rememberSpatialReturn(
        `${window.location.pathname}${window.location.search}`
      );
      requestAgentComposer({ projectDir: activation.projectDir });
      openWorkspace();
    },
    [isDemo, layout.zones, openWorkspace, projectsByZone]
  );

  return { ghostSlots, activateGhost, notice, clearNotice };
}

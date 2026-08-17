/**
 * End-to-end attention-scope contract (BUG-026).
 *
 * The per-module unit tests all passed while the product lied, because the
 * lie lived BETWEEN them: roadmap attention was derived from ONE Project's
 * lens, PTY attention covered the fleet, and the merge handed both to the tab
 * strip, the Project dots and the ⌘J queue as if the map were complete. So
 * this file wires the real fleet producer to the real eligibility rule over
 * two Projects and asserts on the only thing that matters — what the operator
 * sees, and what ⌘J will visit.
 *
 * The governing invariant, stated once: **where the operator is standing may
 * change what they are LOOKING at, never what is true.** Every case below
 * evaluates the fleet from both Projects and requires them to agree.
 */
import { describe, expect, it } from 'vitest';
import { parseRoadmap } from '@exawatt/core';
import {
  deriveFleetRoadmapBlocked,
  pinRoadmapBlockedSince,
  type RoadmapAttentionProject,
} from '@exawatt/ui-model';
import { projectRoadmapAttentionSessions } from './roadmap-lens-input';
import {
  attentionJumpQueue,
  fleetAttention,
  mergeFleetAttention,
  paintsAttention,
  type SessionAttentionSignal,
} from './session-status';
import { tabIsLive, type Project, type WorkspaceTab } from './use-workspace-state';

const A = '/work/alpha';
const B = '/work/bravo';

const ALPHA_ROADMAP = `## Now

### A-1 Fine

Status: now
`;
const BRAVO_ROADMAP = `## Now

### B-1 Waiting on a decision

Status: blocked
`;

function tab(over: Partial<WorkspaceTab>): WorkspaceTab {
  return {
    id: 't',
    durableSessionId: 'd',
    sessionId: 's',
    harness: 'claude',
    title: 'Agent',
    titleKind: 'default',
    cwd: A,
    resumeState: 'live',
    lifecycle: 'running',
    exitCode: null,
    harnessSessionId: null,
    initialTask: null,
    startedAt: 10,
    roadmapItemId: null,
    ...over,
  } as WorkspaceTab;
}

const alpha: Project = {
  dir: A,
  name: 'alpha',
  color: '#19E6FF',
  activeTabId: 'ta',
  tabs: [tab({ id: 'ta', durableSessionId: 'da', sessionId: 'sa', cwd: A })],
};
const bravo: Project = {
  dir: B,
  name: 'bravo',
  color: '#FF3B8B',
  activeTabId: 'tb',
  tabs: [
    tab({
      id: 'tb',
      durableSessionId: 'db',
      sessionId: 'sb',
      cwd: B,
      roadmapItemId: 'B-1',
    }),
  ],
};
const FLEET = [alpha, bravo];

/** The real workspace wiring, minus React: every open Project's roadmap, the
 *  fleet producer, and the merge the strip and ⌘J read. */
function workspace(
  pins: ReadonlyMap<string, number> = new Map(),
  now = 1000,
  pty: Record<string, SessionAttentionSignal> = {}
) {
  const projects = FLEET.map<RoadmapAttentionProject>(project => ({
    dir: project.dir,
    read: {
      status: 'ok',
      doc: parseRoadmap(project.dir === A ? ALPHA_ROADMAP : BRAVO_ROADMAP, {
        projectDir: project.dir,
        file: 'roadmap.md',
      }),
    },
    sessions: projectRoadmapAttentionSessions(project.tabs, {}),
  }));
  const fleet = deriveFleetRoadmapBlocked(projects);
  const pinned = pinRoadmapBlockedSince(pins, fleet, now);
  const signals: Record<string, SessionAttentionSignal> = {};
  for (const entry of fleet.blocked) {
    signals[entry.sessionId] = {
      kind: 'roadmap-blocked',
      since: pinned.get(entry.sessionId) as number,
    };
  }
  const attention = mergeFleetAttention(
    fleetAttention('pty', pty),
    fleetAttention('roadmap', signals)
  );
  const candidates = FLEET.flatMap(project =>
    project.tabs.map(t => ({ sessionId: t.sessionId, live: tabIsLive(t) }))
  );
  return {
    pins: pinned,
    attention,
    /** what the strip and the Project dot paint */
    paints: (sessionId: string) =>
      paintsAttention({ sessionId, live: true }, attention),
    /** where ⌘J goes from the Session the operator is standing on */
    jumpFrom: (activeSessionId: string) =>
      attentionJumpQueue(candidates, attention, activeSessionId),
  };
}

describe('roadmap attention is a fleet fact (BUG-026)', () => {
  it('paints a blocked Session in a Project the operator is NOT in', () => {
    // Standing in alpha. Bravo's Session is blocked on B-1.
    const standingInAlpha = workspace();
    expect(standingInAlpha.paints('sb')).toBe(true);
    expect(standingInAlpha.jumpFrom('sa')).toEqual(['sb']);
  });

  it('gives the same answer from either Project', () => {
    const fromAlpha = workspace();
    const fromBravo = workspace();
    expect(fromAlpha.paints('sb')).toBe(fromBravo.paints('sb'));
    expect(fromAlpha.paints('sa')).toBe(false);
    // ⌘J excludes only where you are standing; the target set is identical.
    expect(fromAlpha.jumpFrom('sa')).toEqual(['sb']);
    expect(fromBravo.jumpFrom('sb')).toEqual([]);
  });

  it('keeps `since` across a Project round trip, so oldest-first holds', () => {
    const first = workspace(new Map(), 1_000);
    expect(first.attention.sb.since).toBe(1_000);
    // leave for bravo, come back much later
    const away = workspace(first.pins, 5_000);
    const back = workspace(away.pins, 9_000);
    expect(back.attention.sb.since).toBe(1_000);
    // an older PTY bell elsewhere therefore still wins the walk order
    const withBell = workspace(back.pins, 9_000, {
      sa: { kind: 'bell', since: 500 },
    });
    expect(withBell.jumpFrom(null as unknown as string)).toEqual(['sa', 'sb']);
  });

  it('still merges independent producers without masking either', () => {
    // A quiet harness result on the blocked Session must not clear the gate.
    const both = workspace(new Map(), 1_000, {
      sb: { kind: 'turn-end', since: 2_000 },
    });
    expect(both.paints('sb')).toBe(true);
    expect(both.attention.sb.kind).toBe('roadmap-blocked');
  });
});

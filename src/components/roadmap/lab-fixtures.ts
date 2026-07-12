/**
 * Roadmap lab fixtures (ENG-017 S10, also used to iterate S6/S7 visuals).
 *
 * Each state is authored as MARKDOWN and pushed through the real parser +
 * lens builder, so the lab exercises the exact pipeline the rail uses —
 * only the file read and the live sessions are mocked. Adding a state is
 * adding a markdown string.
 */
import { parseRoadmap } from '@exawatt/core';
import type { SessionLink } from '@exawatt/core';
import {
  buildRoadmapLens,
  type RoadmapLensSessionInput,
  type RoadmapLensView,
} from '@exawatt/ui-model';

export interface RoadmapLabState {
  key: string;
  label: string;
  /** one line on what this state demonstrates */
  blurb: string;
  view: RoadmapLensView;
}

const DIR = '/fixtures/lab';
const FILE = 'docs/engineering/roadmap.md';

function session(
  n: number,
  title: string,
  harness = 'claude',
  needsAttention = false
): RoadmapLensSessionInput {
  return {
    sessionId: `lab-s${n}`,
    tabId: `lab-tab-${n}`,
    title,
    harness,
    needsAttention,
  };
}

function link(
  n: number,
  itemId: string,
  method: SessionLink['method'] = 'declared',
  confidence: SessionLink['confidence'] = 'high'
): SessionLink {
  return {
    sessionId: `lab-s${n}`,
    tabId: `lab-tab-${n}`,
    projectDir: DIR,
    itemId,
    method,
    confidence,
    evidence:
      method === 'declared'
        ? [{ kind: 'declared', excerpt: 'declared at launch' }]
        : [{ kind: 'branch-name', excerpt: `worktree-${itemId.toLowerCase()}` }],
    evaluatedAt: 0,
  };
}

function lens(
  markdown: string,
  sessions: RoadmapLensSessionInput[] = [],
  links: SessionLink[] = []
): RoadmapLensView {
  const doc = parseRoadmap(markdown, { projectDir: DIR, file: FILE });
  return buildRoadmapLens({
    read: { status: 'ok', doc, mtimeMs: Date.now() - 4 * 60_000 },
    sessions,
    links,
  });
}

const item = (
  id: string,
  title: string,
  status: string,
  body = ''
) => `### ${id} ${title}\n\nStatus: ${status}\n${body}\n`;

const MID_FLIGHT = `## Shipped

${item('APP-001', 'Repo consolidation', 'shipped')}
${item('APP-002', 'Terminal workspace parity', 'shipped', `
Milestones:

- W1 PTY foundation (landed)
- W2 Workspace parity (landed)
`)}
${item('APP-014', 'Signed updates', 'shipped')}

## Now

${item('APP-018', 'Durable, resumable sessions', 'active-build', `
Scope:

- detachable session backend surviving app restart
- crash-safe scrollback persisted to disk
- harness-aware resume after unavoidable death

Exit criteria:

- four same-project tabs resume the exact four saved conversations

Milestones:

- D1 Session host process (landed)
- D2 Reattach on launch (landed)
- D3 Crash-safe scrollback (landed)
- D4 Harness-aware resume
- D5 Graceful reboot story

Project doc:

- docs/engineering/projects/durable-sessions.md
`)}
${item('APP-003', 'Unified agent source adapters', 'active-build', `
Milestones:

- A1 Adapter boundary (landed)
- A2 Claude Code adapter
- A3 Codex adapter
`)}

## Next

${item('APP-005', 'Initiative primitive', 'next')}
${item('APP-006', 'Decision model', 'next')}

## Later

${item('APP-007', 'Context signals', 'later')}
${item('APP-010', 'Remote gateway on VPS', 'later')}
${item('APP-011', 'Multi-source fleet', 'later')}

## Parked

${item('APP-004', 'Spatial operations board', 'parked')}
`;

const BLOCKED = `## Shipped

${item('APP-001', 'Repo consolidation', 'shipped')}

## Now

${item('APP-018', 'Durable, resumable sessions', 'blocked — needs the operator to approve the PTY host entitlement', `
Milestones:

- D1 Session host process (landed)
- D2 Reattach on launch
`)}
${item('APP-003', 'Unified agent source adapters', 'active-build')}

## Next

${item('APP-005', 'Initiative primitive', 'next')}
`;

const STARVING = `## Shipped

${item('APP-001', 'Repo consolidation', 'shipped')}
${item('APP-002', 'Terminal workspace parity', 'shipped')}
${item('APP-018', 'Durable, resumable sessions', 'shipped')}
${item('APP-003', 'Unified agent source adapters', 'shipped')}
${item('APP-005', 'Initiative primitive', 'shipped')}
${item('APP-006', 'Decision model', 'shipped')}
`;

const HUGE = `## Shipped

${Array.from({ length: 9 }, (_, i) =>
  item(`BIG-${100 + i}`, `Shipped slice ${i + 1}`, 'shipped')
).join('\n')}

## Now

${item('BIG-201', 'The current push', 'active-build', `
Milestones:

- M1 First slice (landed)
- M2 Second slice
- M3 Third slice
`)}

## Next

${Array.from({ length: 7 }, (_, i) =>
  item(`BIG-${300 + i}`, `Queued piece ${i + 1}`, 'next')
).join('\n')}

## Later

${Array.from({ length: 14 }, (_, i) =>
  item(`BIG-${400 + i}`, `Someday item ${i + 1}`, 'later')
).join('\n')}
`;

const WARNINGS = `## Now

${item('APP-018', 'Durable, resumable sessions', 'wip-ish', `
Milestones:

- D1 Session host process (landed)
- D2 Reattach on launch
`)}

stray prose the parser cannot claim for any item
another unrecognized line

## Next

${item('APP-005', 'Initiative primitive', 'next')}
${item('APP-005', 'Duplicate id on purpose', 'next')}
`;

const FRESH = `## Now

${item('NEW-001', 'First real milestone', 'active-build')}

## Next

${item('NEW-002', 'Second step', 'next')}
${item('NEW-003', 'Third step', 'next')}
`;

export const ROADMAP_LAB_STATES: RoadmapLabState[] = [
  {
    key: 'mid-flight',
    label: 'Mid-flight',
    blurb: 'healthy project: shipped history, two active items, queue depth',
    view: lens(
      MID_FLIGHT,
      [
        session(1, 'Claude Code — session host'),
        session(2, 'Claude Code — scrollback', 'claude'),
        session(3, 'Codex — adapter boundary', 'codex'),
        session(4, 'Shell', 'shell'),
      ],
      [
        link(1, 'APP-018'),
        link(2, 'APP-018', 'inferred', 'medium'),
        link(3, 'APP-003', 'inferred', 'high'),
      ]
    ),
  },
  {
    key: 'blocked',
    label: 'Blocked',
    blurb: 'the now station is blocked with an agent attached — loudest state',
    view: lens(
      BLOCKED,
      [session(1, 'Claude Code — PTY host', 'claude', true), session(2, 'Shell', 'shell')],
      [link(1, 'APP-018')]
    ),
  },
  {
    key: 'starving',
    label: 'Starving',
    blurb: 'queue empty while agents run — the "no food" moment',
    view: lens(STARVING, [
      session(1, 'Claude Code — idle', 'claude'),
      session(2, 'Codex — idle', 'codex'),
    ]),
  },
  {
    key: 'huge',
    label: 'Huge queue',
    blurb: '31 items — strip node compression and rail density',
    view: lens(HUGE, [session(1, 'Claude Code', 'claude')], [link(1, 'BIG-201')]),
  },
  {
    key: 'warnings',
    label: 'Parse trouble',
    blurb: 'unknown status token, unclaimed lines, duplicate id — honesty UI',
    view: lens(WARNINGS, [session(1, 'Claude Code', 'claude')], [link(1, 'APP-018')]),
  },
  {
    key: 'fresh',
    label: 'Fresh project',
    blurb: 'nothing shipped yet, small queue',
    view: lens(FRESH),
  },
  {
    key: 'none',
    label: 'No roadmap',
    blurb: 'discovery found nothing — convention pointer state',
    view: buildRoadmapLens({
      read: {
        status: 'none',
        checked: ['ROADMAP.md', 'docs/engineering/roadmap.md', 'docs/ROADMAP.md', 'roadmap.md'],
      },
      sessions: [session(1, 'Shell', 'shell')],
    }),
  },
  {
    key: 'error',
    label: 'Read error',
    blurb: 'the file exists but cannot be read',
    view: buildRoadmapLens({
      read: { status: 'error', error: 'EACCES: permission denied, open roadmap.md' },
    }),
  },
];

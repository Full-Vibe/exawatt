/**
 * Authored fixtures for the Start screen study (ENG-046 O0).
 *
 * Every project name and path here is invented, per the public-safe fixture
 * rule. Source labels, colours and the composer's engine order come from the
 * real declarations, so a card can never name a source the product does not
 * know. The Demo rows are the real Voltaic fixture from `@exawatt/core`.
 */
import {
  DEMO_BASE_AGENTS,
  DEMO_PROJECTS,
  type AgentSourceAdapterId,
  type AgentStatus,
} from '@exawatt/core';
import {
  AGENT_SOURCE_META,
  AGENT_SOURCE_ORDER,
  type AgentSourceId,
} from '@/components/workspace/agent-sources';

/** Fixed clock, so every relative time and screenshot is deterministic. */
export const STUDY_NOW = 1_800_000_000_000;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** ENG-046: activity older than this sits behind "Show older". */
const RECENT_WINDOW_MS = 30 * DAY;

export type StartState =
  | 'no-harness'
  | 'signed-out'
  | 'ready-projects'
  | 'ready-empty'
  | 'demo';

export const START_STATES: readonly {
  id: StartState;
  label: string;
  /** What the state proves; workbench prose, beside the frame. */
  note: string;
}[] = [
  {
    id: 'no-harness',
    label: 'No harness',
    note: 'Nothing installed. Every card carries its install guide; a folder can still be opened; the Demo is one click away.',
  },
  {
    id: 'signed-out',
    label: 'Installed, signed out',
    note: 'Antigravity is installed and Google is not signed in. One next step, Recheck beside it, and the terms line from decision 0051.',
  },
  {
    id: 'ready-projects',
    label: 'Ready, projects found',
    note: 'Claude Code, Codex and Gemini are ready. The harness stores suggest projects, most recent first, with the harness that last touched each. Click a row to see the hand-off.',
  },
  {
    id: 'ready-empty',
    label: 'Ready, no projects',
    note: 'Harnesses ready and no store suggests anything, so the Projects section asks for a folder with the chooser’s three routes.',
  },
  {
    id: 'demo',
    label: 'Demo',
    note: 'The Try the Demo row switched: the Demo Workspace’s ribbon and stage over the Voltaic fixture, with the way back.',
  },
];

type SourceCardState = 'ready' | 'action-required' | 'not-installed';

type NextStepKind = 'sign-in' | 'install-guide' | 'recheck';

export interface StartSourceCard {
  id: AgentSourceId;
  label: string;
  connectionName: string;
  color: string;
  state: SourceCardState;
  stateLabel: string;
  /** Exactly one per card. */
  nextStep: { kind: NextStepKind; label: string };
  /** Recheck beside the next step, as Settings shows it; absent when the
   *  next step IS Recheck. */
  recheck: boolean;
  /** Decision 0051's one line, Gemini only. */
  disclosure?: { text: string; linkLabel: string; href: string };
  /** When this source was last observed; absent before any probe answered. */
  checkedAt?: number;
}

const GEMINI_DISCLOSURE = {
  text: 'Google’s consumer terms do not cover third-party launchers. Exawatt runs your own agy and your own sign-in.',
  linkLabel: 'Google’s FAQ',
  href: 'https://antigravity.google/docs/faq',
} as const;

function sourceFace(id: AgentSourceId): {
  label: string;
  connectionName: string;
  color: string;
} {
  const meta = AGENT_SOURCE_META[id];
  // ENG-003 S5.3.1: the Google source reads "Gemini" with "Antigravity CLI"
  // beneath it everywhere a source is named. Not landed in production yet;
  // the study shows the decided face.
  if (id === 'antigravity') {
    return {
      label: 'Gemini',
      connectionName: 'Antigravity CLI',
      color: meta.color,
    };
  }
  return { label: meta.label, connectionName: 'Local CLI', color: meta.color };
}

function readyCard(id: AgentSourceId, checkedAgo: number): StartSourceCard {
  return {
    id,
    ...sourceFace(id),
    state: 'ready',
    stateLabel: 'Ready',
    nextStep: { kind: 'recheck', label: 'Recheck' },
    recheck: false,
    checkedAt: STUDY_NOW - checkedAgo,
  };
}

function notInstalledCard(id: AgentSourceId): StartSourceCard {
  return {
    id,
    ...sourceFace(id),
    state: 'not-installed',
    stateLabel: 'Not installed',
    nextStep: { kind: 'install-guide', label: 'Install guide' },
    recheck: true,
  };
}

function geminiSignedOutCard(checkedAgo: number): StartSourceCard {
  return {
    id: 'antigravity',
    ...sourceFace('antigravity'),
    state: 'action-required',
    stateLabel: 'Action required',
    nextStep: { kind: 'sign-in', label: 'Sign in to Google in Antigravity' },
    recheck: true,
    disclosure: GEMINI_DISCLOSURE,
    checkedAt: STUDY_NOW - checkedAgo,
  };
}

function geminiReadyCard(checkedAgo: number): StartSourceCard {
  return {
    ...readyCard('antigravity', checkedAgo),
    disclosure: GEMINI_DISCLOSURE,
  };
}

/** The cards for a state, in the composer's engine order. */
export function sourceCardsFor(state: StartState): StartSourceCard[] {
  return AGENT_SOURCE_ORDER.map(id => {
    if (state === 'no-harness') return notInstalledCard(id);
    if (state === 'signed-out') {
      return id === 'antigravity'
        ? geminiSignedOutCard(4 * MINUTE)
        : notInstalledCard(id);
    }
    // ready-projects, ready-empty, demo: three ready, three not installed
    if (id === 'claude') return readyCard(id, 2 * MINUTE);
    if (id === 'codex') return readyCard(id, 2 * MINUTE);
    if (id === 'antigravity') return geminiReadyCard(3 * MINUTE);
    return notInstalledCard(id);
  });
}

export interface ProjectSuggestion {
  name: string;
  path: string;
  /** Every harness whose store knows this folder; first is the suggesting
   *  harness the composer recommends. */
  harnesses: readonly AgentSourceId[];
  lastActivityAt: number;
}

/** Invented. Ranked by last activity across all stores, as O1 ranks. */
export const PROJECT_SUGGESTIONS: readonly ProjectSuggestion[] = [
  {
    name: 'northwind',
    path: '~/Code/northwind',
    harnesses: ['claude', 'codex'],
    lastActivityAt: STUDY_NOW - 2 * HOUR,
  },
  {
    name: 'billing-service',
    path: '~/Code/billing-service',
    harnesses: ['claude'],
    lastActivityAt: STUDY_NOW - 26 * HOUR,
  },
  {
    name: 'docs-site',
    path: '~/Code/docs-site',
    harnesses: ['codex'],
    lastActivityAt: STUDY_NOW - 3 * DAY,
  },
  {
    name: 'mobile-app',
    path: '~/Code/mobile-app',
    harnesses: ['antigravity', 'claude'],
    lastActivityAt: STUDY_NOW - 6 * DAY,
  },
  {
    name: 'infra',
    path: '~/Code/infra',
    harnesses: ['codex'],
    lastActivityAt: STUDY_NOW - 12 * DAY,
  },
  {
    name: 'design-tokens',
    path: '~/Code/design-tokens',
    harnesses: ['claude'],
    lastActivityAt: STUDY_NOW - 24 * DAY,
  },
  {
    name: 'legacy-importer',
    path: '~/Code/legacy-importer',
    harnesses: ['claude'],
    lastActivityAt: STUDY_NOW - 41 * DAY,
  },
  {
    name: 'hackathon-2025',
    path: '~/Code/hackathon-2025',
    harnesses: ['codex'],
    lastActivityAt: STUDY_NOW - 88 * DAY,
  },
];

export function isRecent(suggestion: ProjectSuggestion, now = STUDY_NOW) {
  return now - suggestion.lastActivityAt <= RECENT_WINDOW_MS;
}

/** Relative activity in the chooser's register: short, lower case. */
export function relativeActivity(timestamp: number, now = STUDY_NOW): string {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < HOUR)
    return `${Math.max(1, Math.round(elapsed / MINUTE))}m ago`;
  if (elapsed < DAY) return `${Math.round(elapsed / HOUR)}h ago`;
  if (elapsed < 2 * DAY) return 'yesterday';
  if (elapsed < 14 * DAY) return `${Math.round(elapsed / DAY)}d ago`;
  return `${Math.round(elapsed / (7 * DAY))}w ago`;
}

/** The Demo ribbon: the Voltaic Projects with their authored Agents. */
interface DemoRibbonProject {
  key: string;
  name: string;
  color: string;
  agents: readonly {
    id: string;
    name: string;
    status: AgentStatus;
    harness: AgentSourceAdapterId;
  }[];
}

export const DEMO_RIBBON: readonly DemoRibbonProject[] = DEMO_PROJECTS.map(
  project => ({
    key: project.key,
    name: project.name,
    color: project.color,
    agents: DEMO_BASE_AGENTS.filter(
      agent => agent.projectKey === project.key
    ).map(agent => ({
      id: agent.id,
      name: agent.name,
      status: agent.status,
      harness: agent.harness,
    })),
  })
);

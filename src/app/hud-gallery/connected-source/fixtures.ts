/**
 * Authored fixtures for the connected-Agent study (ENG-010 C2).
 *
 * Every value here is invented. No endpoint, host, alias, user, port, token,
 * or key material appears in this file or on the rendered surface, per the
 * project's public-safe fixture rule.
 *
 * The fixtures drive the real `resolveConnectionStatus` /
 * `describeConnectionStatus` boundary from `@exawatt/core`, so the study shows
 * the shipped freshness logic rather than a second copy of it.
 */
import type {
  AgentSourcePlacement,
  ConnectionObservation,
} from '@exawatt/core';
import type { StatusLightState } from '@/components/status-light';

/** Fixed clock: every rendered observation age is deterministic. */
export const STUDY_NOW = 1_755_400_000_000;

const SECOND = 1_000;
const MINUTE = 60_000;
const HOUR = 3_600_000;

/** The one Agent Source in this study, at three different placements. */
export const OPENCLAW_SOURCE = {
  label: 'OpenClaw',
  color: '#8BB9ED',
} as const;

export interface ConnectedAgentFixture {
  id: string;
  name: string;
  project: string;
  /** D40 work state, projected identically for local and remote Agents. */
  work: StatusLightState;
  workLine: string;
  placement: AgentSourcePlacement;
  observation: ConnectionObservation;
}

function live(agoMs: number): ConnectionObservation {
  return {
    transportUp: true,
    retrying: false,
    lastObservedAt: STUDY_NOW - agoMs,
    failure: null,
    now: STUDY_NOW,
  };
}

function unavailable(
  failure: ConnectionObservation['failure'],
  agoMs: number
): ConnectionObservation {
  return {
    transportUp: false,
    retrying: false,
    lastObservedAt: STUDY_NOW - agoMs,
    failure,
    now: STUDY_NOW,
  };
}

/**
 * The roster as one deck. Placement, connection, and work state are varied
 * independently on purpose: a remote Agent whose work faulted is fully visible,
 * and an Agent Exawatt cannot reach keeps whatever work it was last observed
 * doing.
 */
export const ROSTER: readonly ConnectedAgentFixture[] = [
  {
    id: 'scout',
    name: 'Scout',
    project: 'Events',
    work: 'active',
    workLine: 'Comparing three venue quotes for the November offsite',
    placement: 'customer-hosted',
    observation: live(4 * SECOND),
  },
  {
    id: 'reddit-marketer',
    name: 'reddit-marketer',
    project: 'Growth',
    work: 'fault',
    workLine: 'Publish step failed after three attempts',
    placement: 'customer-hosted',
    observation: live(9 * SECOND),
  },
  {
    id: 'vale',
    name: 'Vale',
    project: 'Growth',
    work: 'active',
    workLine: 'Sweeping the backlog for duplicate posts',
    placement: 'customer-hosted',
    observation: {
      transportUp: false,
      retrying: true,
      lastObservedAt: STUDY_NOW - 45 * SECOND,
      failure: null,
      now: STUDY_NOW,
    },
  },
  {
    id: 'wren',
    name: 'Wren',
    project: 'Research',
    work: 'result',
    workLine: 'Weekly digest ready for review',
    placement: 'customer-hosted',
    observation: live(22 * MINUTE),
  },
  {
    id: 'juno',
    name: 'Juno',
    project: 'Launch',
    work: 'active',
    workLine: 'Drafting the launch announcement',
    placement: 'customer-hosted',
    observation: unavailable('host-unreachable', 6 * MINUTE),
  },
  {
    id: 'bram',
    name: 'Bram',
    project: 'Support',
    work: 'needs-you',
    workLine: 'Waiting on a decision about the refund policy',
    placement: 'customer-hosted',
    observation: unavailable('auth-rejected', 31 * MINUTE),
  },
  {
    id: 'marlow',
    name: 'Marlow',
    project: 'Pricing',
    work: 'result',
    workLine: 'Competitor pricing table ready for review',
    placement: 'customer-hosted',
    observation: unavailable('gateway-down', 2 * HOUR),
  },
  {
    id: 'ines',
    name: 'Ines',
    project: 'Operations',
    work: 'off',
    workLine: 'No run in progress',
    placement: 'customer-hosted',
    observation: unavailable('approval-required', 8 * MINUTE),
  },
  {
    id: 'piper',
    name: 'Piper',
    project: 'Library',
    work: 'active',
    workLine: 'Reindexing the research library',
    placement: 'customer-hosted',
    observation: unavailable('incompatible', 14 * MINUTE),
  },
  {
    id: 'rowan',
    name: 'Rowan',
    project: 'Exawatt',
    work: 'needs-you',
    workLine: 'Asking before it rewrites the migration',
    placement: 'local',
    observation: live(2 * SECOND),
  },
];

/**
 * Gateway B's real shape, generalised: one configured Agent with a single
 * automation, no channels, and no conversation on the source at all. It opens
 * with Automations leading rather than with a fabricated Home.
 */
export const AUTOMATION_ONLY_AGENT = {
  id: 'tyler',
  name: 'Tyler',
  project: 'Reports',
  work: 'off' as StatusLightState,
  placement: 'customer-hosted' as AgentSourcePlacement,
  observation: live(6 * SECOND),
  automations: [
    {
      id: 'digest',
      name: 'Inbox digest',
      schedule: 'Every 30 minutes',
      lastRun: 'Last run 12 minutes ago, succeeded',
      nextRun: 'Next run in 18 minutes',
    },
  ],
  workLine: 'No run in progress',
  history: '48 runs in the past day',
} as const;

/**
 * The source reports a different Agent identity behind a mapping Exawatt
 * already holds. Display name alone is never enough to reconcile it.
 */
export const IDENTITY_DRIFT_AGENT = {
  id: 'nova',
  name: 'Nova',
  project: 'Research',
  work: 'off' as StatusLightState,
  placement: 'customer-hosted' as AgentSourcePlacement,
  observation: live(11 * SECOND),
  mapped: {
    label: 'Mapped identity',
    name: 'Nova',
    nativeId: 'Agent id 7c41f0',
    detail: 'Connected 6 days ago',
  },
  observed: {
    label: 'Now observed',
    name: 'Nova',
    nativeId: 'Agent id b0d2e9',
    detail: 'First seen 3 minutes ago',
  },
} as const;

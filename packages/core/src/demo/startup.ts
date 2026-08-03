/**
 * The portrayed startup (ENG-027 W3).
 *
 * Theme decided in the 2026-08-02 demo-arc coordination pass: an AI-native
 * energy-tech startup, which fits Exawatt's wattage vocabulary. Voltaic runs
 * a virtual power plant — it aggregates home batteries, EV chargers, and
 * rooftop solar into dispatchable grid capacity and bids that capacity into
 * wholesale markets. Majority-coding by construction (operator constraint):
 * seven of ten Projects are engineering; research, marketing, and support
 * exist as ENG-026 `preview` content selling the Agent Types vision.
 *
 * The fixture clock. Frozen so the corpus is deterministic; consumers that
 * need "now" to be now rebase against this constant (the generator functions
 * accept a `nowMs` override for exactly that).
 */

import type { DemoInitiative, DemoWorkspaceIdentity } from './types';

export const DEMO_WORKSPACE_NOW_MS = Date.parse('2026-08-02T16:00:00.000Z');

export const MIN_MS = 60_000;
export const HOUR_MS = 60 * MIN_MS;
export const DAY_MS = 24 * HOUR_MS;

export const DEMO_WORKSPACE: DemoWorkspaceIdentity = {
  id: 'demo-voltaic',
  name: 'Voltaic (Demo)',
  company: 'Voltaic Grid Systems',
  tagline: 'Every battery on the grid, working.',
  description:
    'Voltaic Grid Systems is an AI-native virtual power plant. It enrolls ' +
    'home batteries, EV chargers, and rooftop solar; forecasts what each ' +
    'site can safely give back; and bids the aggregate into wholesale ' +
    'energy markets. The company runs its engineering, research, marketing, ' +
    'and support work as an agent fleet commanded from Exawatt.',
};

export const DEMO_INITIATIVES: DemoInitiative[] = [
  {
    id: 'init-ercot',
    name: 'ERCOT market entry',
    goal: 'Bid the Texas pilot fleet into ERCOT ancillary services by October.',
    projectKeys: ['dispatch-engine', 'market-intel', 'platform-infra'],
  },
  {
    id: 'init-home-ga',
    name: 'Voltaic Home GA',
    goal: 'Take the customer app from pilot beta to general availability.',
    projectKeys: ['voltaic-home', 'grid-api', 'demand-gen'],
  },
  {
    id: 'init-pilot-500',
    name: 'Pilot: 500-home fleet',
    goal: 'Grow the live pilot from 214 to 500 enrolled homes without adding ops headcount.',
    projectKeys: ['telemetry-ingest', 'edge-gateway', 'partner-portal', 'support-ops'],
  },
  {
    id: 'init-soc2',
    name: 'SOC 2 Type II',
    goal: 'Clear the audit window with evidence collected continuously, not heroically.',
    projectKeys: ['platform-infra', 'grid-api'],
  },
];

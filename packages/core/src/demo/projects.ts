/**
 * Voltaic's Projects (ENG-027 W3).
 *
 * Ten Projects, majority coding: seven engineering functions carry
 * `readiness: 'live'` because commanding coding agents is what Exawatt ships
 * today; the three non-coding functions (research, marketing, support) are
 * `preview` — they exist to show the ENG-028 Agent Types direction and must
 * never render as shipped capability.
 *
 * Colors are identity-only (ENG-016 D32): distinct hues, no status meaning.
 */

import type { DemoWorkspaceProject } from './types';
import { isCodingFunction } from './types';

const HOME = '~/Code/voltaic';

export const DEMO_PROJECTS: DemoWorkspaceProject[] = [
  {
    key: 'dispatch-engine',
    name: 'dispatch-engine',
    dir: `${HOME}/dispatch-engine`,
    color: '#50E6FF',
    function: 'backend',
    agentType: 'Engineer',
    readiness: 'live',
    summary:
      'Battery dispatch optimizer and market bidder — decides when every enrolled site charges, holds, or sells.',
  },
  {
    key: 'grid-api',
    name: 'grid-api',
    dir: `${HOME}/grid-api`,
    color: '#8AE6A8',
    function: 'backend',
    agentType: 'Engineer',
    readiness: 'live',
    summary:
      'Partner and public API platform — enrollment, telemetry access, and dispatch webhooks for utilities and installers.',
  },
  {
    key: 'voltaic-home',
    name: 'voltaic-home',
    dir: `${HOME}/voltaic-home`,
    color: '#FFC46B',
    function: 'frontend',
    agentType: 'Engineer',
    readiness: 'live',
    summary:
      'The customer app — enrollment, live savings, outage backup status, and dispatch-event transparency.',
  },
  {
    key: 'telemetry-ingest',
    name: 'telemetry-ingest',
    dir: `${HOME}/telemetry-ingest`,
    color: '#B9A6FF',
    function: 'data',
    agentType: 'Engineer',
    readiness: 'live',
    summary:
      'Device telemetry pipeline — per-second battery, inverter, and charger readings from every enrolled site.',
  },
  {
    key: 'edge-gateway',
    name: 'edge-gateway',
    dir: `${HOME}/edge-gateway`,
    color: '#FF9ECF',
    function: 'firmware',
    agentType: 'Engineer',
    readiness: 'live',
    summary:
      'On-site gateway software — vendor protocol adapters, local safety limits, and over-the-air updates.',
  },
  {
    key: 'partner-portal',
    name: 'partner-portal',
    dir: `${HOME}/partner-portal`,
    color: '#7FD4B8',
    function: 'frontend',
    agentType: 'Engineer',
    readiness: 'live',
    summary:
      'Installer and utility portal — site commissioning, fleet health, and settlement statements.',
  },
  {
    key: 'platform-infra',
    name: 'platform-infra',
    dir: `${HOME}/platform-infra`,
    color: '#E6D06B',
    function: 'infra',
    agentType: 'Engineer',
    readiness: 'live',
    summary:
      'Cloud infrastructure, deploy pipelines, and the SOC 2 evidence trail.',
  },
  {
    key: 'market-intel',
    name: 'market-intel',
    dir: `${HOME}/market-intel`,
    color: '#9BB8FF',
    function: 'research',
    agentType: 'Researcher',
    readiness: 'preview',
    summary:
      'Market research desk — ISO rule changes, tariff filings, and interconnection queues, digested for the dispatch team.',
  },
  {
    key: 'demand-gen',
    name: 'demand-gen',
    dir: `${HOME}/demand-gen`,
    color: '#FFB08A',
    function: 'marketing',
    agentType: 'Marketer',
    readiness: 'preview',
    summary:
      'Growth and launch narrative — enrollment campaigns, case studies, and the GA announcement.',
  },
  {
    key: 'support-ops',
    name: 'support-ops',
    dir: `${HOME}/support-ops`,
    color: '#C9A6E6',
    function: 'support',
    agentType: 'Support',
    readiness: 'preview',
    summary:
      'Customer support desk — ticket triage, escalation digests, and enrollment troubleshooting.',
  },
];

export const DEMO_PROJECTS_BY_KEY: ReadonlyMap<string, DemoWorkspaceProject> =
  new Map(DEMO_PROJECTS.map(project => [project.key, project]));

export const DEMO_CODING_PROJECT_KEYS: readonly string[] = DEMO_PROJECTS.filter(
  project => isCodingFunction(project.function)
).map(project => project.key);

export const DEMO_PREVIEW_PROJECT_KEYS: readonly string[] = DEMO_PROJECTS.filter(
  project => !isCodingFunction(project.function)
).map(project => project.key);

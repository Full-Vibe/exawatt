/**
 * Voltaic's Projects (ENG-027 W3).
 *
 * NAMES ARE THE WORK, NOT THE REPOSITORY (operator, 2026-08-17, reviewing the
 * marketing board): `dispatch-engine`, `telemetry-ingest` and `voltaic-home`
 * read "a little bit too geeky" to a stranger, because they are repo slugs
 * wearing a display name's job. `key` and `dir` stay slugs, because that is
 * what a checkout and a cross-reference need; `name` is now the plain-English
 * work a person would say out loud. Every surface that shows a Project to a
 * human reads `name`; everything that resolves, groups, or links reads `key`.
 *
 * AMENDED 2026-08-17 (ENG-031 W9, operator, reviewing the marketing board a
 * second time): NAMES ARE WORK A STRANGER RECOGNIZES, NOT THIS COMPANY'S
 * DOMAIN. "Make one 'Social Marketing Team' no 'Battery Dispatch' - not sure
 * what that means." Voltaic is a virtual-power-plant startup, so `Battery
 * Dispatch`, `Device Telemetry`, `Gateway Firmware` and `Installer Portal`
 * were jargon to every reader outside it, and the homepage board is read
 * almost entirely by people outside it. The display names are now the kinds of
 * team any founder, VC or developer runs: Web Platform, Partner API, Customer
 * App, Data Pipeline, Mobile App, Design System, Cloud Platform, Market
 * Research, Social Marketing Team, Customer Support. `key` and `dir` are
 * untouched, so every roadmap reference, checkout path and cross-reference
 * still resolves; only `name` and the human `summary` beside it moved.
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
    name: 'Web Platform',
    dir: `${HOME}/dispatch-engine`,
    color: '#50E6FF',
    function: 'backend',
    agentType: 'Engineer',
    readiness: 'live',
    summary:
      'The web platform and the services behind it: scheduling, pricing, and the decisions the product makes on its own.',
  },
  {
    key: 'grid-api',
    name: 'Partner API',
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
    name: 'Customer App',
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
    name: 'Data Pipeline',
    dir: `${HOME}/telemetry-ingest`,
    color: '#B9A6FF',
    function: 'data',
    agentType: 'Engineer',
    readiness: 'live',
    summary:
      'The data pipeline: per-second readings from every enrolled site, cleaned, warehoused, and queryable.',
  },
  {
    key: 'edge-gateway',
    name: 'Mobile App',
    dir: `${HOME}/edge-gateway`,
    color: '#FF9ECF',
    function: 'firmware',
    agentType: 'Engineer',
    readiness: 'live',
    summary:
      'The mobile app: setup, notifications, and control that keeps working when the network does not.',
  },
  {
    key: 'partner-portal',
    name: 'Design System',
    dir: `${HOME}/partner-portal`,
    color: '#7FD4B8',
    function: 'frontend',
    agentType: 'Engineer',
    readiness: 'live',
    summary:
      'The design system: components, tokens, and the patterns every surface is built from.',
  },
  {
    key: 'platform-infra',
    name: 'Cloud Platform',
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
    name: 'Market Research',
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
    name: 'Social Marketing Team',
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
    name: 'Customer Support',
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

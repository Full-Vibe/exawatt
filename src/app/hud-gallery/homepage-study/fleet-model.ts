/**
 * The study fleet (ENG-031 W15).
 *
 * One synthetic, seeded fleet that every visual option in the study renders,
 * so the options are judged on rendering and not on data. Three properties
 * are load-bearing:
 *
 * - **Stable under growth.** The fleet is laid out ONCE at its maximum size
 *   and a smaller count is a prefix of that layout. Growing from 10 to 300
 *   adds marks; it never moves one. The operator's brief for the visual is a
 *   territory that expands as the fleet grows and collapses as it shrinks,
 *   which only reads if the agents already there hold still.
 * - **Project-major order.** The first agents all belong to the first
 *   Project, so a fleet of one is one Project with one agent and a little
 *   surrounding territory, not ten Projects with a tenth of an agent each.
 * - **The product's own five signals.** Status is the D40 light vocabulary
 *   (`active`, `needs-you`, `result`, `off`, `fault`), coloured by the same
 *   resolved theme the production board uses. The deck's third highlight,
 *   "queued", has no product status; the study maps it to `off`.
 *
 * Everything here is honest synthetic data and is labelled so on the page.
 */

import type { StatusLightState } from '@/components/status-light/protocol';
import { hexSpiral, type Axial } from './hex';

export const FLEET_MAX = 300;

/** Fleet sizes the study is judged at (operator, 2026-09-11: a first user
 *  has one to ten, not ten thousand). */
export const FLEET_COUNTS = [1, 10, 100, 300] as const;
export type FleetCount = (typeof FLEET_COUNTS)[number];

export interface FleetProject {
  id: number;
  name: string;
  /** Hex axial centre on the shared grid. */
  center: Axial;
  /** Tiles in this Project's spiral at full size, agent tiles first. */
  capacity: number;
  /** Rings the full-size spiral occupies (0 = one tile). */
  rings: number;
  /** Index range into `agents`, project-major. */
  first: number;
  count: number;
}

export interface FleetAgent {
  id: number;
  project: number;
  name: string;
  doing: string;
  status: StatusLightState;
  source: string;
  model: string;
  /** 0..1 share of the plan window this agent has spent. */
  burn: number;
  /** Minutes at work this session. */
  minutes: number;
  /** Hex axial position on the shared grid. */
  tile: Axial;
  /** Ring distance from the Project centre. */
  ring: number;
  /** Delegated children, 0 for most. Children are marks around the parent,
   *  never tiles of their own. */
  children: number;
}

export interface FleetTile {
  axial: Axial;
  project: number;
  /** Index into `agents`, or -1 for a territory tile with no agent. */
  agent: number;
  ring: number;
}

export interface FleetModel {
  projects: FleetProject[];
  agents: FleetAgent[];
  /** Every tile any Project can ever claim, at full size. */
  tiles: FleetTile[];
}

const PROJECT_NAMES = [
  'Web Platform',
  'Mobile App',
  'Partner API',
  'Design System',
  'Billing',
  'Data Pipeline',
  'Docs',
  'Support',
  'Infra',
  'Growth',
];

/** Agents per Project at full size. Sums to FLEET_MAX; the first is large
 *  enough that the ten-agent fleet is one Project. */
const PROJECT_SIZES = [34, 22, 46, 18, 28, 40, 31, 26, 35, 20];

const PURPOSES = [
  'Migrate auth to passkeys',
  'Triage flaky tests',
  'Basis feature sweep',
  'Rewrite the onboarding flow',
  'Index the support archive',
  'Port the billing worker',
  'Draft the release notes',
  'Fix the checkout regression',
  'Audit dependency licenses',
  'Profile the cold start',
  'Backfill usage events',
  'Localize the settings pages',
  'Tune the search ranker',
  'Repair the nightly build',
  'Trim the bundle',
  'Model the pricing table',
  'Verify the sandbox policy',
  'Reconcile the ledger',
  'Classify inbound tickets',
  'Refresh the brand assets',
  'Prune stale feature flags',
  'Upgrade the ORM',
  'Harden the webhook path',
  'Write the API changelog',
  'Shadow the canary deploy',
  'Cluster the churn cohort',
  'Rotate the signing keys',
  'Generate the fixture set',
  'Review open pull requests',
  'Map the schema drift',
];

const DOING = [
  'Reading the auth module',
  'Running the test suite',
  'Waiting on your approval',
  'Opened a pull request',
  'Comparing two migrations',
  'Editing six files',
  'Needs a decision on scope',
  'Result ready to review',
  'Scanning the ticket queue',
  'Rebuilding the index',
  'Blocked on a permission',
  'Writing the summary',
  'Idle until the next turn',
  'Checking the deploy logs',
  'Drafting the fix',
];

const SOURCES = [
  'Claude Code',
  'Codex',
  'OpenCode',
  'Grok Build',
  'OpenClaw',
  'Antigravity',
];

const MODELS: Record<string, string[]> = {
  'Claude Code': ['Fable 5.1', 'Opus 5.5', 'Sonnet 5.5'],
  Codex: ['GPT-6', 'GPT-6 mini'],
  OpenCode: ['Sonnet 5.5', 'Haiku 5.5'],
  'Grok Build': ['Grok 5'],
  OpenClaw: ['Opus 5.5'],
  Antigravity: ['Gemini 3.5 Pro'],
};

/** Mulberry32: tiny, seeded, deterministic. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function statusFor(index: number, local: number, random: () => number) {
  // The ten-agent fleet must already show every signal the story needs.
  if (local === 0) return 'active';
  if (local === 2) return 'needs-you';
  if (local === 4) return 'result';
  if (local === 6) return 'off';
  const roll = random();
  if (roll < 0.55) return 'active';
  if (roll < 0.68) return 'needs-you';
  if (roll < 0.85) return 'result';
  if (roll < 0.97) return 'off';
  return index % 11 === 3 ? 'fault' : 'active';
}

/** Rings a spiral needs for `n` tiles: 1 + 3k(k+1) tiles fit in k rings. */
export function ringsFor(n: number): number {
  let k = 0;
  while (1 + 3 * k * (k + 1) < n) k += 1;
  return k;
}

/** Planar centre of an axial tile, pointy-top, circumradius 1. */
export function axialToPlane(a: Axial): [number, number] {
  return [Math.sqrt(3) * (a.q + a.r / 2), 1.5 * a.r];
}

function planeToAxial(x: number, y: number): Axial {
  const r = y / 1.5;
  const q = x / Math.sqrt(3) - r / 2;
  // cube round
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

/**
 * Pack the Projects on the plane as circles, biggest first at the origin,
 * each next one walked around the cluster on a golden-angle spiral until it
 * clears every placed circle. Then snap to the hex grid.
 */
function packProjects(): FleetProject[] {
  const placed: { x: number; y: number; r: number }[] = [];
  const projects: FleetProject[] = [];
  let first = 0;
  const GAP = 1.4;
  for (let i = 0; i < PROJECT_SIZES.length; i += 1) {
    const count = PROJECT_SIZES[i];
    const rings = ringsFor(count) + 1; // one ring of territory around the agents
    const capacity = 1 + 3 * rings * (rings + 1);
    const radius = (rings + 0.5) * Math.sqrt(3);
    let center: Axial = { q: 0, r: 0 };
    if (i > 0) {
      // walk outward on a spiral until clear
      let distance = radius + placed[0].r;
      let angle = i * 2.399963; // golden angle, so neighbours spread
      let found = false;
      while (!found) {
        for (let step = 0; step < 48 && !found; step += 1) {
          const x = Math.cos(angle) * distance;
          const y = Math.sin(angle) * distance;
          const snapped = planeToAxial(x, y);
          const [sx, sy] = axialToPlane(snapped);
          const clear = placed.every(
            p => Math.hypot(p.x - sx, p.y - sy) >= p.r + radius + GAP
          );
          if (clear) {
            center = snapped;
            found = true;
          } else {
            angle += (Math.PI * 2) / 48;
          }
        }
        distance += Math.sqrt(3);
      }
    }
    const [cx, cy] = axialToPlane(center);
    placed.push({ x: cx, y: cy, r: radius });
    projects.push({
      id: i,
      name: PROJECT_NAMES[i],
      center,
      capacity,
      rings,
      first,
      count,
    });
    first += count;
  }
  return projects;
}

let cached: FleetModel | null = null;

export function fleetModel(): FleetModel {
  if (cached) return cached;
  const random = rng(20261008);
  const projects = packProjects();
  const agents: FleetAgent[] = [];
  const tiles: FleetTile[] = [];
  for (const project of projects) {
    const spiral = hexSpiral(project.center, project.rings);
    for (let local = 0; local < project.count; local += 1) {
      const index = project.first + local;
      const tile = spiral[local];
      const source = SOURCES[(index * 7 + project.id) % SOURCES.length];
      const models = MODELS[source];
      const status = statusFor(index, local, random);
      const purpose = PURPOSES[(index * 13 + project.id * 3) % PURPOSES.length];
      const doing =
        status === 'needs-you'
          ? DOING[[2, 6, 10][index % 3]]
          : status === 'result'
            ? DOING[[3, 7][index % 2]]
            : status === 'off'
              ? DOING[12]
              : DOING[[0, 1, 4, 5, 8, 9, 11, 13, 14][index % 9]];
      agents.push({
        id: index,
        project: project.id,
        name: `${purpose} ${1 + (index % 4)}/${4 + (index % 3)}`,
        doing,
        status,
        source,
        model: models[index % models.length],
        burn: Math.min(0.96, 0.08 + random() * 0.8),
        minutes: Math.round(6 + random() * 420),
        tile: tile.axial,
        ring: tile.ring,
        children: status === 'active' && local % 7 === 3 ? 2 + (index % 3) : 0,
      });
      tiles.push({
        axial: tile.axial,
        project: project.id,
        agent: index,
        ring: tile.ring,
      });
    }
    for (let i = project.count; i < spiral.length; i += 1) {
      tiles.push({
        axial: spiral[i].axial,
        project: project.id,
        agent: -1,
        ring: spiral[i].ring,
      });
    }
  }
  cached = { projects, agents, tiles };
  return cached;
}

/**
 * Which Projects and tiles are present at a given fleet size. Agents are a
 * prefix; a Project is present once its first agent is; a territory tile is
 * present when its ring is within one of the Project's outermost present
 * agent, so the territory hugs a small fleet and grows with it.
 */
export function fleetAt(model: FleetModel, count: number) {
  const n = Math.max(0, Math.min(FLEET_MAX, count));
  const presentProjects = model.projects.filter(p => p.first < n);
  const outermost = new Map<number, number>();
  for (const project of presentProjects) {
    const last = Math.min(n, project.first + project.count) - 1;
    outermost.set(project.id, model.agents[last].ring);
  }
  return {
    count: n,
    projects: presentProjects,
    /** Drawn at all: an agent tile whose agent is here, or any tile inside
     *  the territory (one ring past the outermost present agent). */
    tilePresent: (tile: FleetTile): boolean => {
      const edge = outermost.get(tile.project);
      if (edge === undefined) return false;
      if (tile.agent >= 0 && tile.agent < n) return true;
      return tile.ring <= edge + 1;
    },
    /** Outlined as a slot a click would fill: an empty agent slot inside the
     *  territory, or the next ring out. */
    tileGhost: (tile: FleetTile): boolean => {
      const edge = outermost.get(tile.project);
      if (edge === undefined) return false;
      if (tile.agent >= 0 && tile.agent < n) return false;
      return (
        tile.ring === edge + 2 || (tile.agent >= 0 && tile.ring <= edge + 1)
      );
    },
    /** True when the tile holds an agent that is here. */
    tileAgent: (tile: FleetTile): boolean => tile.agent >= 0 && tile.agent < n,
  };
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export const STATUS_LABEL: Record<StatusLightState, string> = {
  active: 'Working',
  'needs-you': 'Needs you',
  result: 'Done',
  off: 'Idle',
  fault: 'Fault',
};

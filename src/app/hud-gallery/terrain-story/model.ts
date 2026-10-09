import type { StatusLightState } from '@/components/status-light/protocol';

export type WorldStyle =
  | 'prism'
  | 'mercury'
  | 'acrylic'
  | 'terrace'
  | 'survey'
  | 'contour';
export type Voice = 'control' | 'momentum';
export const WORLDS: { id: WorldStyle; name: string; description: string }[] = [
  {
    id: 'prism',
    name: 'Prism',
    description:
      'Cut glass, a luminous heart, and spectral edges. A crystalline landscape of work.',
  },
  {
    id: 'mercury',
    name: 'Mercury',
    description:
      'Liquid chrome on a sculpted surface. Individual agents emerge from a shared team.',
  },
  {
    id: 'acrylic',
    name: 'Acrylic',
    description:
      'Translucent color, soft edges, and layered territories. A lighter, more tactile world.',
  },
  {
    id: 'terrace',
    name: 'Terrace',
    description:
      'A small, tactile territory. Add work and the surface grows with it.',
  },
  {
    id: 'survey',
    name: 'Survey',
    description:
      'A measured landscape of points. A scan reveals the shape of the work.',
  },
  {
    id: 'contour',
    name: 'Contour',
    description:
      'A continuous curved surface. Quiet topography, clear individual agents.',
  },
];
export const CHAPTERS = [
  {
    id: 'intro',
    label: 'The promise',
    slide: '15',
    control: [
      'More agents.\nStill your call.',
      'Run your AI agents from one place. See the work, catch the blockers, keep moving.',
    ],
    momentum: [
      'Your next team\nis already here.',
      'Put AI agents to work together. Exawatt gives you one place to direct them.',
    ],
  },
  {
    id: 'working',
    label: 'Work in progress',
    slide: '16–17',
    control: [
      'Know what’s moving.',
      'See which agents are working and what they’re working on. Open any one to get closer.',
    ],
    momentum: [
      'Keep good work moving.',
      'Research, code, and review can run side by side. Follow the work without following every terminal.',
    ],
  },
  {
    id: 'attention',
    label: 'Your judgment',
    slide: '18',
    control: [
      'Your attention.\nWhere it matters.',
      'A question. An approval. A decision. The work that needs you is easy to find.',
    ],
    momentum: [
      'One decision.\nWork moves again.',
      'Step into the moments that need your judgment, then let the rest keep running.',
    ],
  },
  {
    id: 'waiting',
    label: 'What’s next',
    slide: '19',
    control: [
      'Keep the next move\nin view.',
      'Work that’s waiting belongs beside work in motion. See the dependency before you step in.',
    ],
    momentum: [
      'Give the next idea\na place to start.',
      'Keep follow-on work close to the team. Grow from one task into a coordinated effort.',
    ],
  },
  {
    id: 'fleet',
    label: 'The whole operation',
    slide: '20',
    control: [
      'One agent to a hundred.\nKeep your bearings.',
      'Pull back to see the whole operation. Move closer to any agent. Your work stays where you left it.',
    ],
    momentum: [
      'Make room for\nbigger ambitions.',
      'Build a team around the work. Expand your view as the fleet grows, without losing the individual.',
    ],
  },
  {
    id: 'close',
    label: 'Get started',
    slide: '21',
    control: [
      'Put your agents\nto work.',
      'Bring the agent tools you already use. Start with one task and grow from there.',
    ],
    momentum: [
      'Start small.\nBuild something big.',
      'Your agents do the work. You keep the direction.',
    ],
  },
] as const;

type Site = {
  id: number;
  x: number;
  y: number;
  z: number;
  q: number;
  r: number;
};
export const RADIUS = 14;
export function surfaceY(x: number, z: number) {
  return Math.sqrt(Math.max(1, RADIUS * RADIUS - x * x - z * z)) - RADIUS;
}
// One stable axial lattice. Growth admits a prefix; it never redistributes survivors.
function makeSites(): Site[] {
  const coords: { q: number; r: number; ring: number; angle: number }[] = [];
  for (let q = -7; q <= 7; q++)
    for (let r = -7; r <= 7; r++) {
      const ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
      if (ring <= 7)
        coords.push({
          q,
          r,
          ring,
          angle: Math.atan2(r * 1.5, Math.sqrt(3) * (q + r / 2)),
        });
    }
  coords.sort((a, b) => a.ring - b.ring || a.angle - b.angle);
  return coords.map(({ q, r }, id) => {
    const x = Math.sqrt(3) * (q + r / 2) * 0.72;
    const z = r * 1.08;
    return { id, q, r, x, y: surfaceY(x, z), z };
  });
}
export const SITES = makeSites();
export const TASKS = [
  'Build the checkout',
  'Review the pull request',
  'Map the competition',
  'Write the launch brief',
  'Test the payment flow',
  'Explore onboarding',
  'Check accessibility',
  'Research pricing',
  'Polish the settings',
  'Plan the next release',
];
export const SOURCES = ['Codex', 'Claude Code', 'OpenClaw'];
export function agentAt(
  index: number,
  approved = false
): {
  id: number;
  name: string;
  source: string;
  state: StatusLightState;
  parent: number | null;
} {
  const state: StatusLightState =
    index === 1
      ? approved
        ? 'active'
        : 'needs-you'
      : index % 11 === 7
        ? 'fault'
        : index % 5 === 3
          ? 'result'
          : index % 5 === 4
            ? 'off'
            : 'active';
  return {
    id: index,
    name:
      TASKS[index % TASKS.length] +
      (index >= TASKS.length ? ` ${Math.floor(index / TASKS.length) + 1}` : ''),
    source: SOURCES[index % SOURCES.length],
    state,
    parent: index > 0 && index % 3 !== 0 ? Math.floor((index - 1) / 3) : null,
  };
}

export const TEAMS = ['Storefront', 'Research', 'Launch'] as const;
export function teamOf(id: number) {
  if (id === 0) return 0;
  const point = SITES[id];
  return Math.min(
    2,
    Math.floor((Math.atan2(point.z, point.x) + Math.PI) / ((Math.PI * 2) / 3))
  );
}

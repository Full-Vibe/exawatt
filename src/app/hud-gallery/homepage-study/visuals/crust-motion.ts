/**
 * How a working agent moves (ENG-031 W15g, operator 2026-10-13: "the
 * spinning dots are bad, try something else to show motion"). Orbit, a light
 * circling the tile, is gone. Five treatments on the same tile, a study
 * switch; each is driven by one clock, and by the agent's id for phase so a
 * fleet of working agents is never in lockstep, except Wave, whose phase is
 * where the tile sits, so activity travels across a cluster.
 */

export type CrustMotionId = 'breathe' | 'bob' | 'wave' | 'sheen' | 'pulse';

export const CRUST_MOTIONS: {
  id: CrustMotionId;
  name: string;
  note: string;
}[] = [
  {
    id: 'sheen',
    name: 'Sheen',
    note: 'A soft band of light sweeps across the tile and rests, like a glint on glass.',
  },
  {
    id: 'breathe',
    name: 'Breathe',
    note: 'The body brightens and dims slowly, like a sleeping laptop.',
  },
  {
    id: 'bob',
    name: 'Bob',
    note: 'The tile rises and settles gently, as if it were floating.',
  },
  {
    id: 'wave',
    name: 'Wave',
    note: 'A slow ripple of light and lift travels across the working agents.',
  },
  {
    id: 'pulse',
    name: 'Pulse',
    note: 'A ring of light leaves the tile every few seconds and fades.',
  },
];

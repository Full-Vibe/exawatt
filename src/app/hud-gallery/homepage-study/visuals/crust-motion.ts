/**
 * How a working agent moves (ENG-031 W15g, operator 2026-10-13: "Working
 * state should have some motion - give me options"). Five treatments on
 * the same tile, a study switch; each is driven by one clock and the
 * agent's id for phase, so a fleet of working agents is never in lockstep.
 */

export type CrustMotionId = 'breathe' | 'bob' | 'orbit' | 'spin' | 'pulse';

export const CRUST_MOTIONS: {
  id: CrustMotionId;
  name: string;
  note: string;
}[] = [
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
    id: 'orbit',
    name: 'Orbit',
    note: 'A small light circles the edge of the tile.',
  },
  {
    id: 'spin',
    name: 'Spin',
    note: 'The harness mark turns slowly.',
  },
  {
    id: 'pulse',
    name: 'Pulse',
    note: 'A ring of light leaves the tile every few seconds and fades.',
  },
];

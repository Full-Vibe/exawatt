/**
 * How a working agent moves (ENG-031 W15g to W15i). Two kinds of motion, a
 * study switch each (operator 2026-10-13: "For the working options that are
 * nonmutex, make them additive controls (So for example, one of them can
 * both sheen and breathe.)"):
 *
 * - Light, any of three at once: Sheen, a band of light that sweeps the
 *   tile's own surface and rests; Breathe, the light inside the tile
 *   swelling and settling; Pulse, a faint ring that leaves the top edge.
 * - Lift, one of three: Still, Bob (the tile floats up and settles) or Wave
 *   (a ripple of lift travels across the working agents). Both move the
 *   tile's height, so they are a pick-one.
 *
 * Each is driven by one clock and the agent's id for phase, so a fleet of
 * working agents is never in lockstep, except Wave, whose phase is where the
 * tile sits, so activity travels across a cluster. With Wave on, Breathe
 * rides the same phase: the light and the lift arrive together.
 *
 * In a URL a motion is its parts joined by dots, `sheen.breathe.wave`; no
 * parts at all is `still`.
 */

type CrustGlowId = 'sheen' | 'breathe' | 'pulse';
type CrustLiftId = 'still' | 'bob' | 'wave';

export interface CrustMotion {
  sheen: boolean;
  breathe: boolean;
  pulse: boolean;
  lift: CrustLiftId;
}

export const CRUST_GLOWS: { id: CrustGlowId; name: string; note: string }[] =
  [
    {
      id: 'sheen',
      name: 'Sheen',
      note: 'A soft band of light sweeps across the tile and rests, like a glint on glass. Combines with the others.',
    },
    {
      id: 'breathe',
      name: 'Breathe',
      note: 'The light inside the tile swells and settles, slowly. Combines with the others.',
    },
    {
      id: 'pulse',
      name: 'Pulse',
      note: 'A faint ring of light leaves the top edge every few seconds. Combines with the others.',
    },
  ];

export const CRUST_LIFTS: { id: CrustLiftId; name: string; note: string }[] =
  [
    { id: 'still', name: 'Still', note: 'The tile holds its height.' },
    {
      id: 'bob',
      name: 'Bob',
      note: 'The tile rises and settles gently, as if it were floating.',
    },
    {
      id: 'wave',
      name: 'Wave',
      note: 'A ripple of lift travels across the working agents.',
    },
  ];

export const DEFAULT_MOTION: CrustMotion = {
  sheen: true,
  breathe: false,
  pulse: false,
  lift: 'still',
};

/** Read a motion from its URL form. Missing is the default; present with no
 *  known part (`still`) is no motion at all. */
export function parseMotion(value: string | null): CrustMotion {
  if (value === null) return DEFAULT_MOTION;
  const parts = value.split(/[.,+\s]+/);
  const has = (part: string) => parts.includes(part);
  return {
    sheen: has('sheen'),
    breathe: has('breathe'),
    pulse: has('pulse'),
    lift: has('wave') ? 'wave' : has('bob') ? 'bob' : 'still',
  };
}

/** The URL form of a motion. */
export function motionParam(motion: CrustMotion): string {
  const parts: string[] = [];
  for (const glow of CRUST_GLOWS) if (motion[glow.id]) parts.push(glow.id);
  if (motion.lift !== 'still') parts.push(motion.lift);
  return parts.length > 0 ? parts.join('.') : 'still';
}

export function toggleGlow(motion: CrustMotion, id: CrustGlowId): CrustMotion {
  return { ...motion, [id]: !motion[id] };
}

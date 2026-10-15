/**
 * How an agent tile carries its status (ENG-031 W15d, operator 2026-10-09:
 * the painted tiles with a lit cap look "way too cartoony"). Three
 * treatments on the same geometry and material:
 *
 * - Paint: the body is the status colour and a lit glyph sits on top. The
 *   W15 baseline.
 * - Lamp: a neutral body; the status is a small lamp on top and a glow
 *   under the tile, the way a device shows state.
 * - Rim: a neutral body; the status is a light band around the top edge,
 *   as if the tile were edge-lit.
 */

export type CrustSignalId = 'paint' | 'lamp' | 'rim';

export const CRUST_SIGNALS: {
  id: CrustSignalId;
  name: string;
  note: string;
}[] = [
  {
    id: 'paint',
    name: 'Paint',
    note: 'The body is the status colour, with a lit glyph on top.',
  },
  {
    id: 'lamp',
    name: 'Lamp',
    note: 'Neutral body. The status is a small lamp on top and a glow under the tile.',
  },
  {
    id: 'rim',
    name: 'Rim',
    note: 'Neutral body. The status is a light band around the top edge.',
  },
];

interface CrustSignalSpec {
  /** 1: the body is painted the status colour. 0: a neutral body. */
  bodyStatus: number;
  /** Size of the glyph on top, relative to Paint. */
  glyphScale: number;
  /** 1: the glyph is lit in the status colour. 0: a quiet neutral mark. */
  glyphStatus: number;
  /** A status-coloured band around the top edge. */
  rim: boolean;
  /** A status-coloured glow under the tile. */
  underglow: boolean;
  /** Multiplier on how far an agent rises for its status. */
  liftScale: number;
}

export function crustSignal(id: CrustSignalId): CrustSignalSpec {
  switch (id) {
    case 'lamp':
      return {
        bodyStatus: 0,
        glyphScale: 0.5,
        glyphStatus: 1,
        rim: false,
        underglow: true,
        liftScale: 0.55,
      };
    case 'rim':
      return {
        bodyStatus: 0,
        glyphScale: 0.8,
        glyphStatus: 0,
        rim: true,
        underglow: false,
        liftScale: 0.55,
      };
    case 'paint':
    default:
      return {
        bodyStatus: 1,
        glyphScale: 1,
        glyphStatus: 1,
        rim: false,
        underglow: false,
        liftScale: 1,
      };
  }
}

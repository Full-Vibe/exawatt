/**
 * What the board is COLOURED BY while a panel is talking (ENG-031 W8).
 *
 * The operator's direction, and the reason this module exists:
 *
 * > "I don't see why we shouldn't keep it onscreen to help communicate some of
 * > the other points too, like security, spend, etc. (we can gradually build
 * > our actual product surface into that and make a homepage version more
 * > illustrative over time). E.g., the colour section clearly would benefit
 * > with that copy appearing alongside the actual product fleet board - why
 * > take it away"
 *
 * A LENS AND A HIGHLIGHT ARE DIFFERENT THINGS, and keeping them apart is what
 * makes this a seam rather than a switch. A highlight decides which marks LEAD
 * and which recede (`hero-board-highlight.ts`); a lens decides what the marks
 * MEAN. They compose freely, so a future panel can colour by burn while
 * emphasizing one Project without either module learning about the other.
 *
 * HOW IT REACHES THE GPU, and why it costs nothing. The unit field already
 * carries a per-instance palette ordinal and a six-colour uniform, because
 * that is how status colour has always worked. A lens writes the SAME two
 * things: different ordinals, different six colours. So the whole mechanism is
 * one uniform array and one instanced attribute that were already there, the
 * board stays at three draw calls, no per-frame JavaScript touches the units,
 * and switching lens rides the existing status transition, which means the
 * fleet crossfades between meanings instead of cutting.
 *
 * EVERY LENS READS THE PRODUCT'S OWN DATA AND THE PRODUCT'S OWN COLOURS.
 *
 * - `status` is the five signals from the resolved spatial theme (ENG-023).
 * - `source` is `contracts/agent-sources.json` through the launcher's own
 *   declarations, so a harness is the same colour here as it is in `⌘T`.
 * - `burn` is `SpatialBoardPiece.burnIntensity`, which is the figure the
 *   Operations Board's own burn lens colours by (ENG-008), run through the
 *   product's own `spatialPressureColor` ramp at the product's own break
 *   points. There is not a second burn derivation anywhere on the site.
 *
 * ONE LENS IS DECLARED AND NOT RESOLVED, deliberately. `permission` would
 * colour by each Agent's approval choice, which is real product state and
 * exactly the "security" case the operator named. The demo capture carries no
 * permission mode, and inventing one on the band whose whole subject is trust
 * is the specific failure `marketing.md` records twice. It renders as `status`
 * and says so in `active`, which is what a stub should look like: visible in
 * the type, honest at runtime, and one resolver branch from real.
 *
 * ADDING A LENS: an id in `BandBoardLens`, a branch here, and the panel picks
 * it up. No band component and no page change.
 */
import {
  spatialPressureColor,
  type SpatialThemeSnapshot,
} from '@/components/fleet/spatial/spatial-theme';
import { statusLightStateForAgentStatus } from '@/components/status-light/protocol';
import type { HeroBoardCapture } from './capture-types';
import { HERO_STATUS_ORDER } from './capture-types';

export type HeroLensId = 'status' | 'source' | 'burn' | 'permission';

/** The GPU carries six palette slots, because status has six ordinals. */
export const HERO_LENS_CHANNELS = 6;

export interface HeroLensChannel {
  label: string;
  color: string;
  /**
   * The Agent Source's declared id, where the channel IS a harness (ENG-031
   * W10). The legend draws that harness's own brand mark beside its swatch, so
   * a reader who does not know the product still recognises whose agents these
   * are. Undefined on any channel that is not a harness.
   */
  adapterId?: string;
}

export interface HeroLens {
  id: HeroLensId;
  /**
   * False when the lens renders as the status board. Either it IS the status
   * lens, or it is declared and not yet resolved. A caller must not print a
   * legend for an inactive lens: a legend for colours the board is not using
   * is worse than no legend.
   */
  active: boolean;
  /**
   * Per-unit palette ordinal, index-aligned with `capture.units`. Null under
   * `status`, where the ordinal is the unit's LIVE status and the scheduler
   * owns it.
   */
  channel: Float32Array | null;
  /** The palette, in ordinal order. Always exactly `HERO_LENS_CHANNELS` long
   *  so it can be written straight into the uniform. */
  colors: string[];
  /** What the legend prints. Empty under `status`, which needs no legend: the
   *  board's own five-signal legend is already in the frame. */
  legend: HeroLensChannel[];
  /** `categorical` prints one swatch per channel; `ramp` prints a strip with
   *  its two ends named. */
  legendKind: 'categorical' | 'ramp';
  /** One line naming what the colours now mean, or null. */
  caption: string | null;
}

function statusColors(theme: SpatialThemeSnapshot): string[] {
  return HERO_STATUS_ORDER.map(
    status => theme.status[statusLightStateForAgentStatus(status)]
  );
}

function padded(colors: string[], fill: string): string[] {
  const next = colors.slice(0, HERO_LENS_CHANNELS);
  while (next.length < HERO_LENS_CHANNELS) next.push(fill);
  return next;
}

/**
 * Burn bands, at the product's own break points.
 *
 * `spatialPressureColor` changes gradient at 0.62 and 0.85, which is where the
 * Operations Board decides an Agent has gone from ordinary to warm to hot. The
 * bands below use those two numbers rather than inventing thresholds, so a
 * mark that reads hot on the marketing board reads hot in the product.
 */
const BURN_BANDS = [0.2, 0.42, 0.62, 0.85, 1] as const;

export function resolveHeroLens(
  capture: HeroBoardCapture,
  id: HeroLensId,
  theme: SpatialThemeSnapshot
): HeroLens {
  if (id === 'source') {
    const channel = new Float32Array(capture.units.length);
    for (let index = 0; index < capture.units.length; index += 1) {
      channel[index] = Math.min(
        HERO_LENS_CHANNELS - 1,
        capture.units[index]!.source
      );
    }
    const colors = capture.sources.map(source => source.color);
    return {
      id,
      active: true,
      channel,
      colors: padded(colors, theme.unitMuted),
      legend: capture.sources.slice(0, HERO_LENS_CHANNELS).map(source => ({
        label: source.label,
        color: source.color,
        adapterId: source.adapterId,
      })),
      legendKind: 'categorical',
      caption: 'Every mark, coloured by the harness running it.',
    };
  }

  if (id === 'burn') {
    const channel = new Float32Array(capture.units.length);
    for (let index = 0; index < capture.units.length; index += 1) {
      const burn = capture.units[index]!.burn;
      let band = 0;
      while (band < BURN_BANDS.length - 1 && burn > BURN_BANDS[band]!) {
        band += 1;
      }
      channel[index] = band;
    }
    // The colour of a band is the product's ramp sampled at the band's own
    // midpoint, so the five bands sit on the ramp rather than beside it.
    const colors = BURN_BANDS.map((top, index) => {
      const bottom = index === 0 ? 0 : BURN_BANDS[index - 1]!;
      return spatialPressureColor(theme, (bottom + top) / 2);
    });
    return {
      id,
      active: true,
      channel,
      colors: padded(colors, theme.consumption.unknown),
      legend: [
        { label: 'Quietest', color: colors[0]! },
        { label: 'Hottest', color: colors[colors.length - 1]! },
      ],
      legendKind: 'ramp',
      caption:
        'Weighted tokens per agent, delegated runs counted with their parent.',
    };
  }

  // `status`, and `permission` until the capture carries an approval mode.
  return {
    id,
    active: id === 'status',
    channel: null,
    colors: statusColors(theme),
    legend: [],
    legendKind: 'categorical',
    caption: null,
  };
}

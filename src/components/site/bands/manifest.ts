/**
 * Homepage band manifest (ENG-031 W1).
 *
 * The homepage is an ORDERED SEQUENCE OF BANDS, not a fixed set of sections
 * (operator, 2026-08-14, `docs/engineering/projects/website-overhaul.md`).
 * Open source, security, privacy, observability and cost may each be promoted
 * to a first-class marketing concept later, and promoting one has to be a data
 * edit in this file plus one band component. Never a page rewrite.
 *
 * Same discipline as the ENG-026 readiness manifest in
 * `src/components/nav/surfaces.ts`: the fact lives once, in one typed list,
 * and every consumer derives from it. `src/app/page.tsx` renders this array
 * and holds no page structure of its own.
 *
 * A band declares six things, all from the brief:
 * - `id`             stable address; also the in-page anchor
 * - `job`            the single job it does for a cold reader
 * - `heading`        its copy, plus the `headingRole` that sizes it
 * - `copyBudget`     measured word ceiling, footer excluded
 * - `medium`         what carries the idea
 * - `altitudeAnchor` whether it moves the hero camera, and where to
 * - `screens`        viewport heights it occupies (one idea per screen)
 * - `status`         shipped, or reserved and therefore not rendered
 *
 * ADDING OR PROMOTING A BAND
 * 1. add or edit the row here, in the position it occupies on the page;
 * 2. flip `status` to `shipped` and drop `reservedUntil`;
 * 3. write its component and register it in `registry.tsx` (the registry is
 *    keyed by every `BandId`, so the compiler will ask for the entry).
 * The page is untouched.
 *
 * MEASURED CONSTRAINTS carried here rather than in prose, from the 16-site
 * reference study:
 * - one idea per screen, so every band runs 1.0 to 1.4 viewport heights;
 * - the fold stays under 26 words;
 * - section headings stay small and the closing band is the largest type on
 *   the page.
 *
 * KNOWN GAP, deliberately recorded rather than papered over: the nine core
 * bands' copy ceilings sum to roughly 470 words, which clears the 450-word
 * floor Conductor proves works but sits well under the 1,200 to 1,700 words
 * the study recommends for a site that is both premium and communicative.
 * Closing it is W3 to W5 copy work plus promoted reserve bands, not a change
 * to this contract. `pageCopyCeiling()` reports the current number.
 */

export type BandId =
  | 'fold'
  | 'voice'
  | 'thesis'
  | 'altitude-agent'
  | 'altitude-team'
  | 'altitude-fleet'
  | 'observability'
  | 'any-lab'
  | 'open-source'
  | 'trust'
  | 'security'
  | 'cost'
  | 'proof'
  | 'close';

/** Reserved bands declare their slot and render nothing. */
export type BandStatus = 'shipped' | 'reserved';

/** What carries the band's idea. */
export type BandMedium =
  | 'type'
  | 'board'
  | 'product-motion'
  | 'portrait'
  | 'logos'
  | 'cards'
  | 'ledger';

/**
 * Loudness is spent at the end, never the beginning. Exactly one band carries
 * the page headline and exactly one carries the closing type; everything
 * between them is a small section heading or none at all.
 */
export type BandHeadingRole = 'none' | 'headline' | 'section' | 'closing';

/** The altitude ladder is the narrative (decision 0023 names the altitudes). */
export type BandAltitude = 'agent' | 'team' | 'fleet';

export interface CopyBudget {
  /** words; omitted where the band has no floor */
  min?: number;
  /** words; a ceiling, never a target */
  max: number;
}

export interface HomepageBand {
  id: BandId;
  /** the single job this band does for a cold reader */
  job: string;
  headingRole: BandHeadingRole;
  /** null while the copy is unwritten, and always null for `headingRole: 'none'` */
  heading: string | null;
  copyBudget: CopyBudget;
  medium: BandMedium;
  /**
   * Where the hero camera sits while this band is on screen. `null` means the
   * band does not move it. The ordered non-null anchors ARE the pull-back.
   */
  altitudeAnchor: BandAltitude | null;
  /** viewport heights; one idea per screen holds this to 1.0 to 1.4 */
  screens: number;
  status: BandStatus;
  /** what has to be true before a reserved band renders */
  reservedUntil?: string;
}

/** One idea per screen, measured across the whole reference cohort. */
export const BAND_SCREENS_MIN = 1;
export const BAND_SCREENS_MAX = 1.4;

/** Total page copy, footer excluded. 450 is the proven floor; 534 is the
 *  cautionary middle; 1,200 to 1,700 is premium and communicative at once. */
export const PAGE_COPY_BUDGET: Required<CopyBudget> = {
  min: 1_200,
  max: 1_700,
};

/**
 * The page, in order. Reserved rows sit in the slot they would occupy, so
 * promoting one is a one-word edit rather than a placement decision made
 * under launch pressure.
 */
export const HOMEPAGE_BANDS: HomepageBand[] = [
  {
    id: 'fold',
    job: 'WHAT. Name the thing plainly, one subhead, the download and its requirement.',
    headingRole: 'headline',
    heading: 'Exawatt',
    copyBudget: { max: 24 },
    medium: 'board',
    // The opening crop the pull-back starts from. W2 owns the camera itself.
    altitudeAnchor: 'fleet',
    screens: 1,
    status: 'shipped',
  },
  {
    id: 'voice',
    job: 'WHO SAYS. One operator quote, avatar and company, directly under the button.',
    headingRole: 'none',
    heading: null,
    copyBudget: { min: 15, max: 20 },
    medium: 'portrait',
    altitudeAnchor: null,
    screens: 1,
    status: 'reserved',
    reservedUntil: 'W3 lands a real named operator who agreed to be quoted.',
  },
  {
    id: 'thesis',
    job: 'WHY. The only abstract paragraph on the page, centered and two-tone.',
    headingRole: 'none',
    heading: null,
    copyBudget: { min: 25, max: 35 },
    medium: 'type',
    altitudeAnchor: null,
    screens: 1,
    status: 'reserved',
    reservedUntil:
      'W3 writes the fold and close first; the thesis is sized against them.',
  },
  {
    id: 'altitude-agent',
    job: 'One agent, and the status you can trust.',
    headingRole: 'section',
    heading: null,
    copyBudget: { min: 20, max: 25 },
    medium: 'product-motion',
    altitudeAnchor: 'agent',
    screens: 1.2,
    status: 'reserved',
    reservedUntil: 'W4 needs the W2 capture rig.',
  },
  {
    id: 'altitude-team',
    job: 'Dozens at once, and where your attention is routed.',
    headingRole: 'section',
    heading: null,
    copyBudget: { min: 20, max: 25 },
    medium: 'product-motion',
    altitudeAnchor: 'team',
    screens: 1.2,
    status: 'reserved',
    reservedUntil: 'W4 needs the W2 capture rig.',
  },
  {
    id: 'altitude-fleet',
    job: 'Thousands. The longest hold on the page.',
    headingRole: 'section',
    heading: null,
    copyBudget: { min: 20, max: 25 },
    medium: 'board',
    altitudeAnchor: 'fleet',
    screens: 1.4,
    status: 'reserved',
    reservedUntil: 'W4 needs the W2 capture rig.',
  },
  {
    id: 'observability',
    job: 'The truthful status claim, stated as a mechanism rather than an adjective.',
    headingRole: 'section',
    heading: null,
    copyBudget: { min: 20, max: 40 },
    medium: 'product-motion',
    altitudeAnchor: null,
    screens: 1,
    status: 'reserved',
    reservedUntil:
      'The mechanism behind truthful status can be shown, not asserted.',
  },
  {
    id: 'any-lab',
    job: 'Vendor neutrality as a differentiator.',
    headingRole: 'section',
    heading: null,
    copyBudget: { min: 40, max: 60 },
    medium: 'logos',
    altitudeAnchor: null,
    screens: 1.2,
    status: 'reserved',
    reservedUntil: 'W5 needs ENG-003 S4 so the source list is truthful.',
  },
  {
    id: 'open-source',
    job: 'The AGPL app and the Apache-2.0 spec, in a human voice.',
    headingRole: 'section',
    heading: null,
    copyBudget: { min: 40, max: 80 },
    medium: 'type',
    altitudeAnchor: null,
    screens: 1,
    status: 'reserved',
    reservedUntil:
      'ENG-030 makes the repository public. Research is explicit that this belongs in a band and the footer, never the headline.',
  },
  {
    id: 'trust',
    job: 'What runs on your machine, and what you control.',
    headingRole: 'section',
    heading: null,
    copyBudget: { min: 40, max: 70 },
    medium: 'cards',
    altitudeAnchor: null,
    screens: 1,
    status: 'reserved',
    reservedUntil:
      'Every card states a control the user has. State what the product does; never confess a gap.',
  },
  {
    id: 'security',
    job: 'The provider-owned boundary today, graduated enforcement later.',
    headingRole: 'section',
    heading: null,
    copyBudget: { min: 30, max: 60 },
    medium: 'type',
    altitudeAnchor: null,
    screens: 1,
    status: 'reserved',
    reservedUntil:
      'The assurance ladder supports the claim. Claim nothing the product cannot show.',
  },
  {
    id: 'cost',
    job: 'Real cross-vendor consumption, shown as a ledger rather than a promise.',
    headingRole: 'section',
    heading: null,
    copyBudget: { min: 30, max: 60 },
    medium: 'ledger',
    altitudeAnchor: null,
    screens: 1.2,
    status: 'reserved',
    reservedUntil: 'A real per-agent ledger exists to publish.',
  },
  {
    id: 'proof',
    job: 'Named operators, then a dated changelog.',
    headingRole: 'section',
    heading: null,
    copyBudget: { min: 150, max: 250 },
    medium: 'cards',
    altitudeAnchor: null,
    screens: 1.4,
    status: 'reserved',
    reservedUntil: 'W5 has named operators who agreed and a dated changelog.',
  },
  {
    id: 'close',
    job: 'Act. The same buttons as the fold, requirement line beneath.',
    headingRole: 'closing',
    heading: null,
    copyBudget: { max: 10 },
    medium: 'type',
    altitudeAnchor: null,
    screens: 1,
    status: 'reserved',
    reservedUntil: 'W3 owns the closing line and the download requirement.',
  },
];

export function bandById(id: BandId): HomepageBand {
  // ids are a closed union, so a miss is a programming error, not a state.
  return HOMEPAGE_BANDS.find(band => band.id === id)!;
}

/** The bands the page actually renders, in page order. */
export function shippedBands(): HomepageBand[] {
  return HOMEPAGE_BANDS.filter(band => band.status === 'shipped');
}

/** Declared slots with no content yet. They render nothing. */
export function reservedBands(): HomepageBand[] {
  return HOMEPAGE_BANDS.filter(band => band.status === 'reserved');
}

export function anchorsHeroCamera(band: HomepageBand): boolean {
  return band.altitudeAnchor !== null;
}

/**
 * The camera choreography, derived rather than authored twice: the ordered
 * altitude anchors are the pull-back the hero board follows. W2 consumes this
 * instead of hardcoding a second copy of the sequence.
 */
export function heroCameraAnchors(): {
  id: BandId;
  altitude: BandAltitude;
}[] {
  return HOMEPAGE_BANDS.filter(anchorsHeroCamera).map(band => ({
    id: band.id,
    altitude: band.altitudeAnchor!,
  }));
}

/** Worst-case word count if every declared band spent its whole budget. */
export function pageCopyCeiling(
  bands: HomepageBand[] = HOMEPAGE_BANDS
): number {
  return bands.reduce((total, band) => total + band.copyBudget.max, 0);
}

/** Words in a rendered band, for asserting a band against its budget. */
export function countWords(text: string): number {
  return text.trim().split(/\s+/u).filter(Boolean).length;
}

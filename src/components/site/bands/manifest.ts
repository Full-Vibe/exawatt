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
 * AMENDED 2026-08-17 (ENG-031 W4, operator): THE ALTITUDE BANDS RUN FLEET TO
 * AGENT, not agent to fleet. The brief declared a pull-BACK, from one agent
 * out to the fleet, because it read the altitude ladder as a cinematic device
 * on its own. The operator's direction for the pinned board settled the
 * question the other way: "keep THIS as a persistent graphic which changes as
 * you scroll". The thing he was looking at is the fold's Fleet board, so the
 * sequence has to continue that picture rather than cut away from it and start
 * over on one agent. Reading down is now a dive: every project, one project,
 * one agent, ending concrete immediately above the closing CTA, which is also
 * where the standing what-and-why test wants it. `altitude-fleet` keeps the
 * longest hold, so the brief's other constraint on this run is untouched. This
 * reorder is a data edit in this file, which is the band system doing exactly
 * what it was built for.
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
  /** Drives the ONE pinned board. A consecutive run of these renders as a
   *  single sticky sequence: the bands supply the panels and their order, and
   *  the board is the medium they drive. See `pinned-board-sequence.tsx`. */
  | 'pinned-board'
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

/**
 * What the pinned board EMPHASIZES while this band is the active panel
 * (operator, 2026-08-17: the explanations "highlight elements or map to
 * elements that are highlighted in the graphic").
 *
 * A band declares the emphasis SEMANTICALLY and never by name. "The Project
 * with the most Agents" is stable across a regenerated capture; "Battery
 * Dispatch" is not, and a manifest that named it would be authoring fixture
 * data. `hero-board-highlight.ts` resolves these against the capture and hands
 * back the subject's real name for the panel to print.
 */
export type BandBoardHighlight =
  | 'whole-fleet'
  | 'needs-you'
  | 'one-project'
  | 'one-agent';

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
  /**
   * What the pinned board emphasizes while this band is the active panel.
   * Required on every `pinned-board` band and null everywhere else: a panel
   * that drives the board without saying what it is pointing at is exactly the
   * "state change alone" the operator ruled insufficient.
   */
  boardHighlight: BandBoardHighlight | null;
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
    boardHighlight: null,
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
    boardHighlight: null,
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
    boardHighlight: null,
    screens: 1,
    status: 'reserved',
    reservedUntil:
      'W3 writes the fold and close first; the thesis is sized against them.',
  },
  // THE PINNED RUN. These three are ONE graphic and three panels, not three
  // captures (operator, 2026-08-17). They are ordered Fleet, Team, Agent, which
  // REVERSES the brief's original agent-to-fleet order; see the amendment note
  // at the top of this file. `medium: 'pinned-board'` is what makes them a run.
  {
    id: 'altitude-fleet',
    job: 'Every project at once, and only the agents that need a human are loud.',
    headingRole: 'section',
    heading: 'Every project',
    copyBudget: { min: 20, max: 25 },
    medium: 'pinned-board',
    altitudeAnchor: 'fleet',
    boardHighlight: 'needs-you',
    screens: 1.4,
    status: 'reserved',
    reservedUntil:
      'The operator accepts the pinned sequence at /hud-gallery/altitude-scroll.',
  },
  {
    id: 'altitude-team',
    job: 'One project, with every agent inside it still named.',
    headingRole: 'section',
    heading: 'One project',
    copyBudget: { min: 20, max: 25 },
    medium: 'pinned-board',
    altitudeAnchor: 'team',
    boardHighlight: 'one-project',
    screens: 1.2,
    status: 'reserved',
    reservedUntil:
      'The operator accepts the pinned sequence at /hud-gallery/altitude-scroll.',
  },
  {
    id: 'altitude-agent',
    job: 'One agent, and the status you can trust.',
    headingRole: 'section',
    heading: 'One agent',
    copyBudget: { min: 20, max: 25 },
    medium: 'pinned-board',
    altitudeAnchor: 'agent',
    boardHighlight: 'one-agent',
    screens: 1.2,
    status: 'reserved',
    reservedUntil:
      'The operator accepts the pinned sequence at /hud-gallery/altitude-scroll.',
  },
  {
    id: 'observability',
    job: 'The truthful status claim, stated as a mechanism rather than an adjective.',
    headingRole: 'section',
    heading: null,
    copyBudget: { min: 20, max: 40 },
    medium: 'product-motion',
    altitudeAnchor: null,
    boardHighlight: null,
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
    boardHighlight: null,
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
    boardHighlight: null,
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
    boardHighlight: null,
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
    boardHighlight: null,
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
    boardHighlight: null,
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
    boardHighlight: null,
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
    boardHighlight: null,
    screens: 1,
    status: 'reserved',
    // W3 BUILT IT; the operator has not picked the line yet. The band, the
    // 72px rung, the closing copy and the repeated button are all real and
    // switchable at `/hud-gallery/fold-close`. Flipping this to `shipped` and
    // registering `CloseBand` is what puts it on the homepage, and that lands
    // with the fold variant the operator chooses, in one commit.
    reservedUntil:
      'The operator picks a W3 fold and close variant at /hud-gallery/fold-close.',
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

/** The bands that drive the ONE pinned board, in page order. */
export function pinnedBoardBands(
  bands: HomepageBand[] = HOMEPAGE_BANDS
): HomepageBand[] {
  return bands.filter(band => band.medium === 'pinned-board');
}

/**
 * The page as the composer walks it: bands in order, with each consecutive run
 * of `pinned-board` bands collected into ONE entry.
 *
 * This is what makes "one persistent graphic, several explanations" structural
 * rather than a component's private opinion. A pinned run is not three bands
 * that each mount a board; it is one board and three panels, and the page
 * cannot express it any other way.
 */
export type BandRun =
  | { kind: 'band'; band: HomepageBand }
  | { kind: 'pinned-board'; bands: HomepageBand[] };

export function bandRuns(bands: HomepageBand[]): BandRun[] {
  const runs: BandRun[] = [];
  for (const band of bands) {
    if (band.medium !== 'pinned-board') {
      runs.push({ kind: 'band', band });
      continue;
    }
    const previous = runs[runs.length - 1];
    if (previous?.kind === 'pinned-board') previous.bands.push(band);
    else runs.push({ kind: 'pinned-board', bands: [band] });
  }
  return runs;
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

/**
 * A rendered band's READING COPY, in words (ENG-031 W3).
 *
 * `copyBudget` is a ceiling on what a reader reads: kickers, headings and
 * prose. Conversion affordances are excluded, and marked in the DOM with
 * `data-band-affordance` so the exclusion is explicit rather than assumed.
 *
 * That is how the 16-site cohort was counted. Linear measures 19 words above
 * the fold with two buttons on screen, and the closing constraint is stated as
 * "10 words or fewer, AND repeats the fold's buttons" — the buttons are
 * additive by the constraint's own wording. The affordance has its own
 * measured rule instead: the download names the OS and states its requirement
 * at the button.
 */
export function bandCopyWords(root: Element): number {
  const clone = root.cloneNode(true) as Element;
  for (const affordance of Array.from(
    clone.querySelectorAll('[data-band-affordance]')
  )) {
    affordance.remove();
  }

  // Element boundaries are word boundaries. Every rendered line is its own
  // block-level span, and `textContent` concatenates them with no separator,
  // so "keep up." + "Exawatt is" measured as one word and a multi-line band
  // could sit over its ceiling while the assertion passed. Collect the text
  // nodes and join them instead.
  const text: string[] = [];
  const collect = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === TEXT_NODE) {
        text.push(child.textContent ?? '');
      } else {
        collect(child);
      }
    }
  };
  collect(clone);

  return countWords(text.join(' '));
}

/** `Node.TEXT_NODE`, spelled out so this module stays importable without a DOM. */
const TEXT_NODE = 3;

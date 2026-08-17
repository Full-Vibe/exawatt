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
 * AGENT, not agent to fleet, and they are ONE pinned graphic rather than three
 * bands. The brief declared a pull-BACK because it read the altitude ladder as
 * a cinematic device on its own. The operator's direction settled it the other
 * way: "keep THIS as a persistent graphic which changes as you scroll". The
 * thing he was looking at is the fold's Fleet board, so the sequence continues
 * that picture instead of cutting away and starting over on one agent.
 *
 * AMENDED 2026-08-17 (ENG-031 W5): THE ORDER IS NOW AN ARGUMENT, NOT AN
 * ARCHITECTURE TOUR. The operator's verdict on the shipped sequence was that
 * it "needs us to think through the narrative at a very high-level and build
 * the story as the user scrolls down". The diagnosis that produced this
 * revision: the panels DESCRIBED the view instead of making a claim the board
 * is evidence for, and Fleet/Team/Agent is the order of our own architecture,
 * which a stranger has no reason to care about. Four changes fall out of it.
 *
 * 1. `thesis` moves ahead of the board and NAMES THE FOIL, so the board
 *    arrives as evidence for an argument already in the reader's head. It is
 *    the one abstract paragraph the reference cohort allows.
 * 2. `altitude-attention` is a NEW panel. Scale and attention are two ideas
 *    and the measured constraint is one idea per screen, so they get one
 *    screen each. They share an altitude on purpose: the camera holds still
 *    and the BOARD changes, which is the single most persuasive beat available
 *    and the only one no competitor can screenshot.
 * 3. `altitude-delegation` is a NEW panel and the only anchor in the run that
 *    reverses. The page dives for four beats and opens back out for the fifth,
 *    so the sequence ends by expanding into the trajectory the fold promised
 *    rather than by bottoming out on one mark.
 * 4. `observability` moved UP, directly behind the run, because the truthful
 *    status claim is a claim about the colours the reader has just watched
 *    change. Asserted in the abstract it is an adjective; asserted one screen
 *    after the board it is the mechanism behind something already seen.
 *
 * WHERE THE BOARD HANDS OFF. The pinned run carries WHAT IT IS and HOW IT
 * HOLDS (scale, attention, depth, delegation). Everything after it is about
 * PROVENANCE AND OWNERSHIP, which is not spatial: whose agents (`any-lab`),
 * what they spend (`cost`), whose machine (`trust`), whose code
 * (`open-source`), and who is shipping it (`proof`). Forcing those onto the
 * board would be a diagram of a sentence.
 *
 * THE COPY GAP W1 RECORDED IS CLOSED. The nine core bands' ceilings summed to
 * about 474 words, well under the 1,200 to 1,700 the 16-site study recommends
 * for a page that is both premium and communicative. Real reading copy in the
 * differentiator bands and a dated `proof` list close it without padding;
 * `pageCopyCeiling()` now lands inside `PAGE_COPY_BUDGET` and a test asserts
 * both ends rather than only the ceiling.
 */

export type BandId =
  | 'fold'
  | 'voice'
  | 'thesis'
  | 'altitude-fleet'
  | 'altitude-attention'
  | 'altitude-team'
  | 'altitude-agent'
  | 'altitude-delegation'
  | 'observability'
  | 'any-lab'
  | 'cost'
  | 'trust'
  | 'open-source'
  | 'security'
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
  | 'one-agent'
  | 'delegation';

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
    // The opening crop the dive starts from, and the seat the reader is put in.
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
    // W5 reassigned this band's JOB to `proof` rather than leaving the slot to
    // block the page: borrowed credibility is the one thing the launch does
    // not have, and inventing a quote is not an option. The slot stays because
    // the first real named operator belongs here, above the fold's argument.
    reservedUntil:
      'A named operator agrees to be quoted. `proof` carries the credibility until then.',
  },
  {
    id: 'thesis',
    job: 'WHY. The one abstract paragraph on the page, and the only place the foil is named.',
    headingRole: 'none',
    heading: null,
    copyBudget: { min: 40, max: 60 },
    medium: 'type',
    altitudeAnchor: null,
    boardHighlight: null,
    screens: 1,
    status: 'reserved',
    reservedUntil:
      'The operator accepts the narrative at /hud-gallery/homepage-narrative.',
  },
  // THE PINNED RUN. ONE board and five panels, not five captures (operator,
  // 2026-08-17). Ordered as an ARGUMENT rather than as an architecture tour
  // (W5): scale, then attention, then depth, then delegation. The camera dives
  // for four beats and opens back out for the fifth, so the sequence ends
  // expanding into the trajectory the fold promised.
  {
    id: 'altitude-fleet',
    job: 'SCALE. Every project at once, and the board still fits on one screen.',
    headingRole: 'section',
    heading: 'Every project at once',
    copyBudget: { min: 20, max: 36 },
    medium: 'pinned-board',
    altitudeAnchor: 'fleet',
    boardHighlight: 'whole-fleet',
    screens: 1.2,
    status: 'reserved',
    reservedUntil:
      'The operator accepts the pinned sequence at /hud-gallery/homepage-narrative.',
  },
  {
    id: 'altitude-attention',
    job: 'ATTENTION. The camera holds and the board recedes to the agents waiting on a person.',
    headingRole: 'section',
    heading: 'Only what needs you',
    copyBudget: { min: 20, max: 36 },
    medium: 'pinned-board',
    // The SAME altitude as the panel before it, deliberately. The argument is
    // made by the board changing under a still camera, which is the one beat
    // on the page a competitor cannot screenshot.
    altitudeAnchor: 'fleet',
    boardHighlight: 'needs-you',
    screens: 1.4,
    status: 'reserved',
    reservedUntil:
      'The operator accepts the pinned sequence at /hud-gallery/homepage-narrative.',
  },
  {
    id: 'altitude-team',
    job: 'CONTINUITY. One project, still the same board, and every agent in it still an individual.',
    headingRole: 'section',
    heading: 'One project',
    copyBudget: { min: 20, max: 32 },
    medium: 'pinned-board',
    altitudeAnchor: 'team',
    boardHighlight: 'one-project',
    screens: 1,
    status: 'reserved',
    reservedUntil:
      'The operator accepts the pinned sequence at /hud-gallery/homepage-narrative.',
  },
  {
    id: 'altitude-agent',
    job: 'DEPTH. One agent, its real work, and a status that changes while you read it.',
    headingRole: 'section',
    heading: 'One agent',
    copyBudget: { min: 20, max: 38 },
    medium: 'pinned-board',
    altitudeAnchor: 'agent',
    boardHighlight: 'one-agent',
    screens: 1.2,
    status: 'reserved',
    reservedUntil:
      'The operator accepts the pinned sequence at /hud-gallery/homepage-narrative.',
  },
  {
    id: 'altitude-delegation',
    job: 'TRAJECTORY. Agents run agents, so the camera opens back out while the fleet blooms.',
    headingRole: 'section',
    heading: 'Agents run agents',
    copyBudget: { min: 20, max: 40 },
    medium: 'pinned-board',
    // Back OUT to the FLEET framing, which is the only anchor in the run that
    // reverses, and it reverses all the way. Two reasons, one of them a defect
    // this fixed: at the team framing only three delegating parents were in
    // frame while the panel's own subject line said sixteen, so the picture
    // undercut the sentence. And the mechanism by which ten becomes ten
    // thousand is the last thing the board says, so the page should end
    // opening out rather than staying in close.
    altitudeAnchor: 'fleet',
    boardHighlight: 'delegation',
    screens: 1.2,
    status: 'reserved',
    reservedUntil:
      'The operator accepts the pinned sequence at /hud-gallery/homepage-narrative.',
  },
  {
    id: 'observability',
    job: 'The truthful status claim, stated as five mechanisms rather than an adjective.',
    headingRole: 'section',
    heading: 'The lights tell the truth',
    copyBudget: { min: 80, max: 180 },
    medium: 'cards',
    altitudeAnchor: null,
    boardHighlight: null,
    screens: 1.2,
    status: 'reserved',
    // The gate this band carried since W1 ("the mechanism can be shown, not
    // asserted") is MET: reported-outranks-inferred, gate-not-guess, the
    // delegating parent that never reads done, stale-turn reclaim, and
    // absent-is-never-zero are all shipped behaviour with named owners.
    reservedUntil:
      'The operator accepts the narrative at /hud-gallery/homepage-narrative.',
  },
  {
    id: 'any-lab',
    job: 'Vendor neutrality as a differentiator, proved by the launcher rather than asserted.',
    headingRole: 'section',
    heading: 'Agents from any lab',
    copyBudget: { min: 80, max: 200 },
    medium: 'logos',
    altitudeAnchor: null,
    boardHighlight: null,
    screens: 1.4,
    status: 'reserved',
    reservedUntil:
      'The operator accepts the narrative at /hud-gallery/homepage-narrative.',
  },
  {
    id: 'cost',
    job: 'What a fleet spends, read off your own disk, with the modelled half labelled.',
    headingRole: 'section',
    heading: 'What it spent, beside what it did',
    copyBudget: { min: 60, max: 160 },
    medium: 'ledger',
    altitudeAnchor: null,
    boardHighlight: null,
    screens: 1.2,
    status: 'reserved',
    reservedUntil:
      'The operator accepts the narrative at /hud-gallery/homepage-narrative.',
  },
  {
    id: 'trust',
    job: 'What runs on your machine, and the switch attached to every outbound thing.',
    headingRole: 'section',
    heading: 'Your machine, your keys, your repo',
    copyBudget: { min: 80, max: 210 },
    medium: 'cards',
    altitudeAnchor: null,
    boardHighlight: null,
    screens: 1.4,
    status: 'reserved',
    reservedUntil:
      'The operator accepts the narrative at /hud-gallery/homepage-narrative.',
  },
  {
    id: 'open-source',
    job: 'The AGPL app and the Apache-2.0 spec, in a human voice.',
    headingRole: 'section',
    heading: 'Open source, on purpose',
    copyBudget: { min: 60, max: 130 },
    medium: 'type',
    altitudeAnchor: null,
    boardHighlight: null,
    screens: 1,
    status: 'reserved',
    reservedUntil:
      'ENG-030 makes the repository public. Research is explicit that this belongs in a band and the footer, never the headline.',
  },
  {
    id: 'security',
    job: 'The provider-owned boundary today, graduated Exawatt enforcement later.',
    headingRole: 'section',
    heading: null,
    copyBudget: { min: 30, max: 60 },
    medium: 'type',
    altitudeAnchor: null,
    boardHighlight: null,
    screens: 1,
    status: 'reserved',
    // W5 decided this WAITS, and the reason is a copy rule rather than a
    // missing feature. The honest security story today is the provider's
    // boundary plus the per-Agent permission choice, and that is already a
    // control the reader has, so it lives in `trust` as a control instead of
    // here as a section about a boundary Exawatt does not yet own. A band
    // whose whole subject is a deficiency promotes the deficiency.
    reservedUntil:
      'Exawatt mediates a high-impact action itself. Until then the honest half lives in `trust`.',
  },
  {
    id: 'proof',
    job: 'ALIVE. Built by the fleet it commands, and a dated list of what landed.',
    headingRole: 'section',
    heading: 'Built by the fleet it commands',
    copyBudget: { min: 150, max: 280 },
    medium: 'cards',
    altitudeAnchor: null,
    boardHighlight: null,
    screens: 1.4,
    status: 'reserved',
    reservedUntil:
      'The operator accepts the narrative at /hud-gallery/homepage-narrative.',
  },
  {
    id: 'close',
    job: 'Act. The same button as the fold, requirement line beneath.',
    headingRole: 'closing',
    heading: null,
    copyBudget: { max: 10 },
    medium: 'type',
    altitudeAnchor: null,
    boardHighlight: null,
    screens: 1,
    status: 'reserved',
    reservedUntil:
      'The operator picks a fold and close variant at /hud-gallery/fold-close.',
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
 * The altitudes the pinned board travels, in panel order (ENG-031 W5).
 *
 * The camera choreography is DERIVED from the bands rather than authored a
 * second time in the scene, which is what lets a panel be added, reordered, or
 * given a different altitude as a data edit. Two properties of the current
 * ladder are deliberate and would be invisible if the scene owned it:
 *
 * - two consecutive panels may share an altitude (`altitude-fleet` and
 *   `altitude-attention`), which makes the camera hold while the board itself
 *   makes the argument;
 * - the ladder is NOT monotonic. `altitude-delegation` returns to the team
 *   framing, so the sequence opens back out at the end instead of bottoming
 *   out on one mark.
 */
export function pinnedAltitudeLadder(
  bands: HomepageBand[] = HOMEPAGE_BANDS
): BandAltitude[] {
  return pinnedBoardBands(bands).map(band => band.altitudeAnchor ?? 'fleet');
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

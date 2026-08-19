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
 * A band declares:
 * - `id`             stable address; also the in-page anchor
 * - `job`            the single job it does for a cold reader
 * - `heading`        its copy, plus the `headingRole` that sizes it
 * - `copyBudget`     measured word ceiling, footer excluded
 * - `medium`         what carries the idea
 * - `altitudeAnchor` whether it moves the board camera, and where to
 * - `boardLens`      what the board COLOURS BY while the band is on screen
 * - `boardHighlight` what the board EMPHASIZES while the band is on screen
 * - `screens`        viewport heights it occupies (one idea per screen)
 * - `status`         shipped, proposed, or reserved
 *
 * ADDING OR PROMOTING A BAND
 * 1. add or edit the row here, in the position it occupies on the page;
 * 2. move `status` up the ladder and drop `reservedUntil`;
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
 * bands. The operator's direction settled it: "keep THIS as a persistent
 * graphic which changes as you scroll". The thing he was looking at is the
 * fold's Fleet board, so the sequence continues that picture instead of
 * cutting away and starting over on one agent.
 *
 * AMENDED 2026-08-17 (ENG-031 W5): THE ORDER IS AN ARGUMENT, NOT AN
 * ARCHITECTURE TOUR. `thesis` names the FOIL before the board arrives, so the
 * board is evidence rather than a caption; the panels stopped describing the
 * view and started making claims the board proves.
 *
 * AMENDED 2026-08-17 (ENG-031 W8, operator, and this is the shape the page
 * holds now): THE BOARD IS THE PAGE, AND EVERY PANEL IS A LENS ON IT.
 *
 * > "Yeah /homepage-narrative has way too much height, too many sections. Also
 * > can you move the interactive thing to the second section, right after the
 * > fold? I don't see why we shouldn't keep it onscreen to help communicate
 * > some of the other points too, like security, spend, etc. ... E.g., the
 * > colour section clearly would benefit with that copy appearing alongside
 * > the actual product fleet board - why take it away"
 *
 * Four changes fall out of it, each visible in the rows below.
 *
 * 1. **The board enters at section two and never leaves until the argument is
 *    over.** `thesis` is the first PANEL over the board rather than a screen
 *    of type before it. The claim still lands before the evidence, which is
 *    what W5 was protecting; it just lands on the same screen the evidence is
 *    already on.
 * 2. **Provenance and ownership are spatial after all.** W5 concluded that
 *    `any-lab`, `cost` and `trust` "are not spatial" and handed them to
 *    ordinary bands. That was wrong on the facts: a harness is a property of
 *    every mark, burn is a property of every mark, and a permission choice is
 *    a property of every mark. They are pinned panels now, each driving a
 *    LENS.
 * 3. **Merged, not deleted.** `observability` is the claim behind the colours
 *    the reader is watching change, so it merged into `altitude-attention`
 *    rather than following it one screen later. `altitude-team` merged into
 *    `altitude-agent`: one dive, not two. `open-source` moved to the footer
 *    column W6 owns, which is where the research put it in the first place.
 * 4. **Height came down.** Fourteen rendered bands and about 16.6 screens
 *    became eleven and about 12 screens, and eight of those eleven are one
 *    continuous graphic rather than eight separate stops.
 *
 * AMENDED 2026-08-17 (ENG-031 W9, operator): THE CAMERA ONLY EVER CLOSES IN.
 *
 * > "I think the zoom is a little bouncy, I like it when it goes only one
 * > direction smoothly across multiple steps."
 *
 * W8's order made the camera reverse three times in six panels: out of the
 * fold's crop to the whole fleet, in to one agent, then out to the fleet again
 * for delegation and for both lens panels. Each reversal is a real change of
 * direction, so no easing could have hidden it. The rows are reordered so the
 * path holds or closes in at every step and never once opens out, and
 * `BAND_ALTITUDE_DEPTH` plus `manifest.test.ts` make that a property the
 * manifest ENFORCES rather than one it happens to have.
 *
 * The dive is also the finale now. `altitude-agent` is the deepest rung and
 * therefore the last panel over the board, which puts the best frame on the
 * page immediately above the dated list and the call to action.
 *
 * AMENDED 2026-08-19 (ENG-031 W12, operator): THE PAGE GAINS A DURATION
 * CLAIM, AND IT SITS BETWEEN THE TWO SCALE CLAIMS AND THE DIVE.
 *
 * > "add a section about the (forthcoming ... it'll likely be live tomorrow)
 * > feature to push an agent up to the cloud to manage long-horizon agents /
 * > long-horizon work."
 *
 * `cloud` is ENG-033's one user-facing promise, and the affordance it names
 * already ships in the product as an ENG-026 `announced` row. Three decisions
 * are carried in its row below rather than in prose here:
 *
 * 1. **It follows `altitude-delegation`.** Delegation is scale ACROSS a fleet
 *    and this is scale THROUGH TIME. Both are answers to "how does ten become
 *    ten thousand", so they belong adjacent, and putting the pair immediately
 *    before the dive leaves the run's one remaining camera event where W9 put
 *    it.
 * 2. **It holds the Project framing.** The camera neither moves nor reverses,
 *    which is what the monotonic ladder requires and what keeps the dive the
 *    only arrival left.
 * 3. **The board does not pretend to prove it.** Placement is not a property
 *    the frozen capture carries, so the panel returns the Project to full
 *    strength after the delegation bloom and lets the SENTENCE carry the
 *    future tense. Lighting a real agent as though it were already hosted
 *    would be the false present-tense claim `marketing.md` records twice.
 *
 * THE LENS SEAM. `boardLens` is the extension point the operator asked for:
 * "we can gradually build our actual product surface into that and make a
 * homepage version more illustrative over time." A lens says what the marks
 * are COLOURED BY; a highlight says which marks LEAD. They are independent on
 * purpose, so a future panel can, for example, colour by burn while
 * emphasizing one Project. Adding a lens is one id, one resolver branch, and
 * one legend: never a change to a band component or to the page.
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
  | 'cloud'
  | 'open-source'
  | 'security'
  | 'proof'
  | 'close';

/**
 * How close a band is to the live homepage.
 *
 * - `shipped`  renders at `/`.
 * - `proposed` renders at `/v2`, the review address, and at `/` the moment
 *   `HOMEPAGE_ARRANGEMENT` flips. Written, reviewable, and one word away.
 * - `reserved` renders nowhere and says what would earn it.
 */
export type BandStatus = 'shipped' | 'proposed' | 'reserved';

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

/**
 * The altitude ladder is the narrative (decision 0023 names the altitudes).
 *
 * `cluster` is the ONE addition that is not a product altitude, and it says so
 * (ENG-031 W6b): it is the FLEET altitude cropped, centred on the same point,
 * close enough that three or four Project clusters fill the frame and an
 * individual mark is legible. It exists because the fold now shares the board
 * with the rest of the page, and a fold that opened on the whole fleet inside
 * a 58% column showed marks two pixels wide.
 *
 * AMENDED 2026-08-18 (W10): `cluster` is where the run OPENS, and it is the
 * widest frame the reader is ever shown. It no longer HOLDS. `cluster-in` is
 * that crop ten percent in, and it exists for one reason: the reader's first
 * scroll has to move the camera. `cluster-close` is one step in again, for the
 * panels whose subject is what the marks MEAN rather than where they are. The
 * run never opens out to `fleet` at all, because the camera only ever travels
 * one direction; see `BAND_ALTITUDE_DEPTH`.
 */
export type BandAltitude =
  | 'agent'
  | 'team'
  | 'fleet'
  | 'cluster'
  | 'cluster-in'
  | 'cluster-close';

/**
 * HOW DEEP EACH ALTITUDE IS, and therefore which direction the camera is
 * travelling between two bands (ENG-031 W9).
 *
 * The operator's note on the assembled run: "I think the zoom is a little
 * bouncy, I like it when it goes only one direction smoothly across multiple
 * steps." The old ladder pulled OUT to the fleet after the fold's crop, dove
 * IN to one agent, and pulled OUT again for the last three panels. Easing
 * cannot rescue a path that turns around, because each reversal is a real
 * change of direction and the eye is right to notice it.
 *
 * So depth is DECLARED here and asserted by `manifest.test.ts`: across the
 * bands that anchor the camera, in page order, this number may only rise. The
 * bounce cannot come back by reordering a row or by giving a new panel a
 * convenient framing, because either one fails the test rather than shipping.
 *
 * `hero-board-framings.ts` holds the same ordering in world units and asserts
 * the fitted distances agree with it, so the manifest's claim and the camera's
 * behaviour cannot drift apart.
 */
export const BAND_ALTITUDE_DEPTH: Record<BandAltitude, number> = {
  fleet: 0,
  cluster: 1,
  'cluster-in': 2,
  'cluster-close': 3,
  team: 4,
  agent: 5,
};

/**
 * What the pinned board COLOURS BY while this band is the active panel
 * (ENG-031 W8, operator).
 *
 * This is the seam the operator asked for when he said the board should stay
 * onscreen "to help communicate some of the other points too, like security,
 * spend". A lens re-reads the SAME fleet through a different property of the
 * same marks, so the argument is proved by the picture instead of illustrated
 * beside it.
 *
 * - `status`     the product's own five signals. The board's resting state.
 * - `source`     which harness runs each Agent. Real, from the capture.
 * - `burn`       model-weighted consumption per Agent (ENG-008 E3). Real.
 * - `permission` the per-Agent approval choice. DECLARED, NOT YET RESOLVED:
 *   the demo fixture carries no permission mode, and inventing one on a trust
 *   surface is exactly the failure `marketing.md` records. It falls back to
 *   `status` until the fixture carries the field.
 */
export type BandBoardLens = 'status' | 'source' | 'burn' | 'permission';

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
   * Where the board camera sits while this band is on screen. `null` means the
   * band does not move it.
   */
  altitudeAnchor: BandAltitude | null;
  /**
   * What the board colours by while this band is the active panel. Required on
   * every `pinned-board` band and null everywhere else.
   */
  boardLens: BandBoardLens | null;
  /**
   * What the board emphasizes while this band is the active panel. Required on
   * every `pinned-board` band and null everywhere else: a panel that drives the
   * board without saying what it is pointing at is exactly the "state change
   * alone" the operator ruled insufficient.
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

/**
 * Total page copy, footer excluded.
 *
 * 450 is the proven floor (Conductor); 534 is the cautionary middle (Warp,
 * vague and unclear at once); 1,200 to 1,700 was measured for a page that is
 * premium and communicative at once. W8 lowered the floor to 900 because the
 * chapters share one board and the picture carries what those pages spend
 * words on.
 *
 * AMENDED 2026-08-17 (W6b, operator: "I don't want to read all the text on
 * that page"). The band is 320 to 520, and the reason is that the measured
 * cohort's 1,200 figure is a count of words on pages where the ARGUMENT is
 * made in prose. Here the argument is made by a board that changes, and the
 * page shipped 1,216 words anyway, which is the cohort's number reached by
 * writing a documentation page next to a graphic that was already making the
 * point. Every mechanism list is gone: a mechanism is checkable in the docs
 * and merely long on a marketing page. What is left is one claim per panel,
 * in the same register, plus the dated list, which is the one place on the
 * page where volume is the evidence.
 *
 * This is a cut in VOLUME and not in register. The lines the page is known by
 * are all still on it.
 *
 * Floor lowered 2026-08-17 after the operator killed the proof band's lede and
 * coda as copy for its own sake. The floor exists to stop padding, and it must
 * never be the reason a deliberate cut gets refilled.
 *
 * FLOOR LOWERED AGAIN 2026-08-17 (W6c), 280 to 230, and the reason is the same
 * one for the third time. W6b left every panel with a two-sentence claim, a
 * coda and a state line, and reading the page as a cold developer, VC or
 * founder found four of those sentences CAPTIONING a picture that was already
 * saying it and one explaining a mechanism nobody needs before they trust us.
 * Deleting them takes the written page to about 255 words.
 *
 * The floor is NOT a target and it never has been. It exists so the page
 * cannot become vague, and what actually satisfies it is SPECIFICITY: five
 * dated rows, a named requirement at the button, a lens legend read off the
 * capture, and claims a competitor could not truthfully write. A page that
 * met 280 by re-describing its own graphic would fail the thing the floor is
 * for while passing the number. 230 is set below what W6c wrote so a later
 * pass can still cut a sentence that stops working without the test asking
 * for it back.
 *
 * The CEILING stays at 520 on purpose. It is the measured band's number and
 * it binds `pageCopyCeiling()`, the sum of every rendered band's declared
 * budget, which W6c tightened band by band instead. Real restraint lives in
 * the per-band budgets, where it is attributable to a band; the page number
 * only catches a page that has quietly doubled.
 */
/*
 * FLOOR LOWERED AGAIN 2026-08-18 (W10), 230 to 170, and this time the cut is
 * a whole band rather than a sentence. The operator removed the `What shipped`
 * section outright, which takes about 65 written words and the page's second
 * tall reading block off it in one edit. The floor is not a target and never
 * has been: it exists so the page cannot go vague, and 170 sits below what
 * W10 actually writes so a later pass can still drop a line that stops working
 * without this test asking for it back.
 */
export const PAGE_COPY_BUDGET: Required<CopyBudget> = {
  min: 170,
  max: 520,
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
    // F0: the crop the whole run opens on, holds on, and dives from, and the
    // seat the reader is put in. It is the WIDEST frame the page ever shows,
    // which is what makes the rest of the run a straight line in (W9).
    altitudeAnchor: 'cluster',
    // THE FOLD IS THE FIRST FRAME OF THE GRAPHIC (ENG-031 W6b), which is why
    // it is the one band outside `medium: 'pinned-board'` that declares a lens
    // and a highlight. It cannot BE a pinned band, because `/` still renders
    // it alone and a run of one would put the proposed fold on the shipped
    // homepage. `bandRuns()` merges it into the run whenever a run follows it,
    // so the page has exactly one board instance and the "one continuous
    // board" claim is literally true rather than a crossfade between two
    // canvases.
    boardLens: 'status',
    boardHighlight: 'one-project',
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
    boardLens: null,
    boardHighlight: null,
    screens: 1,
    status: 'reserved',
    // W5 reassigned this band's JOB to `proof` rather than leaving the slot to
    // block the page: borrowed credibility is the one thing the launch does
    // not have, and inventing a quote is not an option.
    reservedUntil:
      'A named operator agrees to be quoted. `proof` carries the credibility until then.',
  },
  // THE PINNED RUN. It starts HERE, at section two, and holds until the
  // argument is over (operator, W8: "move the interactive thing to the second
  // section, right after the fold ... I don't see why we shouldn't keep it
  // onscreen to help communicate some of the other points too").
  //
  // ITS ORDER IS THE CAMERA PATH (W9). The rows below run in the order a
  // camera that only closes in can visit them: hold the fold's crop while the
  // board recedes to what needs you, step in once while the lens re-reads the
  // same marks twice, step in again onto the Project where delegation is
  // legible, and dive to one agent as the last thing the page shows. Every
  // panel's copy already stood alone, so the reorder is a resequencing of
  // claims rather than a rewrite of any of them.
  {
    id: 'thesis',
    job: 'WHY. The claim and the foil, said over the board rather than one screen before it.',
    headingRole: 'section',
    heading: 'Your tools were built for one agent',
    copyBudget: { min: 40, max: 70 },
    medium: 'type',
    altitudeAnchor: null,
    boardLens: null,
    boardHighlight: null,
    screens: 1,
    status: 'reserved',
    // W5 gave the claim its own screen so it landed before the evidence. W8
    // keeps the ORDER and drops the SCREEN: `THESIS_LINES` is the lede of the
    // first panel over the board, so the reader meets the foil while looking
    // at the counter-example. Two screens that showed the identical board are
    // one screen now, and the row stays because the argument may earn its own
    // screen back if the page ever gets quieter.
    reservedUntil:
      'The foil needs a screen of its own. It opens the first pinned panel today.',
  },
  {
    id: 'altitude-fleet',
    job: 'WHY, then SCALE. Name the foil, then answer it with every project at once.',
    headingRole: 'section',
    // D's rejected h1 line, which W3b said deserved a later band. This is it.
    heading: 'Your tools were built for one agent',
    copyBudget: { min: 60, max: 110 },
    medium: 'pinned-board',
    // HELD AT F0, NOT PULLED OUT TO IT (W9). The run's camera only ever closes
    // in, so there is no wider frame for a scale panel to occupy: if this row
    // is ever promoted it holds the fold's crop while its copy carries the
    // count, and the crop is what says the rest of the fleet runs past the
    // frame edge.
    altitudeAnchor: 'cluster',
    boardLens: 'status',
    boardHighlight: 'whole-fleet',
    screens: 1.2,
    status: 'reserved',
    // RESERVED 2026-08-17 (W6b, operator): "eight panels to four or five". The
    // scale claim is the first thing the page DOES now rather than the first
    // thing it says: the fold opens on a crop dense enough that the fleet
    // obviously continues past the frame, so a screen of type explaining that
    // a fleet fits on one screen was describing a picture the reader was
    // already looking at. The foil it carried spends at 72px at the close
    // instead, which is where the brief already puts the world claim.
    reservedUntil:
      'The fold crop no longer reads as the scale claim on its own.',
  },
  {
    id: 'altitude-attention',
    job: 'SCALE AND ATTENTION. Every agent on one screen, with the ones waiting on a person lit.',
    headingRole: 'section',
    // W12 (operator: "make it more about see 100s of agents in one screen").
    // `Only what needs you` was the panel's whole heading and it named the
    // half a reader arrives caring about second. The number goes first now
    // and the needs-you idea is one plain sentence under it.
    //
    // W13, the operator's own edit: `A hundred agents, one screen` becomes
    // `Hundreds of agents`. The pair was a construction, and the half that
    // does the work is the count; a reader who is looking at the screen does
    // not need the screen named. Plural also stops the heading being a claim
    // the board has to match unit for unit.
    heading: 'Hundreds of agents',
    // W6c: one claim, no coda. W13 lifts the ceiling by the closing line the
    // operator wrote for this panel and nothing else.
    copyBudget: { min: 22, max: 46 },
    medium: 'pinned-board',
    // THE FIRST SCROLL GLIDES (W10, operator: "I do want some sort of camera
    // change / zoom / animation on the first scroll section - right now the
    // scene is static"). W9 held the fold's crop here so the board could make
    // the argument under a still camera. Read from the top of the page that
    // reasoning inverts: the first scroll is where a reader finds out whether
    // the picture is alive, and a camera that answers it by not moving reads
    // as a screenshot however much the marks are doing. Ten percent in, on
    // the same centre, so the fold's composition survives the move and only
    // the agents waiting on a person stay bright.
    altitudeAnchor: 'cluster-in',
    boardLens: 'status',
    boardHighlight: 'needs-you',
    screens: 1.2,
    status: 'proposed',
    // W8 MERGED `observability` into this panel. The truthful-status claim is
    // a claim about the colours the reader is watching change, and the
    // operator named this exact case: "the colour section clearly would
    // benefit with that copy appearing alongside the actual product fleet
    // board - why take it away".
  },
  {
    id: 'observability',
    job: 'The truthful status claim, stated as mechanisms rather than an adjective.',
    headingRole: 'section',
    heading: 'The lights tell the truth',
    copyBudget: { min: 80, max: 180 },
    medium: 'cards',
    altitudeAnchor: null,
    boardLens: null,
    boardHighlight: null,
    screens: 1.2,
    status: 'reserved',
    // W8 MERGED this into `altitude-attention`. Its copy is not lost: the
    // mechanisms are the cards on that panel, said one screen earlier and
    // beside the colours they are about. The row stays because the mechanism
    // list may outgrow a panel.
    reservedUntil:
      'The truthful-status mechanisms outgrow the `altitude-attention` panel and need their own screen.',
  },
  {
    id: 'any-lab',
    job: 'PROVENANCE. Whose agents these are, coloured by the harness that runs each one.',
    headingRole: 'section',
    heading: 'Agents from any lab',
    // Floor 30 to 26 in W12. The rewrite that NAMES the harnesses is shorter
    // than the abstraction it replaced, and a floor is never a target.
    copyBudget: { min: 26, max: 48 },
    // W13: the fifth harness joins the named set (operator: OpenClaw "is
    // presently underway or done"). ENG-003 S1 landed OpenClaw discovery and
    // normalization into production Settings and S1.1 added its protocol
    // probe, so it is a source Exawatt commands today. What it is NOT is a
    // fifth `⌘T` row: `contracts/agent-sources.json` declares
    // `interactiveLaunch: false` for it, because it connects as a Gateway
    // rather than spawning a local CLI. So the verb changed with the list.
    // `Launch` would have been false for one of the five; `Command` is true
    // for all five and is the product's own word for what it does to them.
    // W8 promoted this from a card chapter to a LENS. A harness is a property
    // of every mark on the board, so the claim proves itself the moment the
    // fleet recolours by source.
    medium: 'pinned-board',
    // ONE STEP IN FROM F0 (W9). The subject here is what a mark MEANS, not
    // where it is, so the lens is the event and the camera only keeps the run
    // moving forward rather than making a journey of it.
    altitudeAnchor: 'cluster-close',
    boardLens: 'source',
    boardHighlight: 'whole-fleet',
    screens: 1,
    status: 'proposed',
  },
  {
    id: 'cost',
    job: 'SPEND. What the fleet is burning, read off the same marks.',
    headingRole: 'section',
    heading: 'What it spent, beside what it did',
    copyBudget: { min: 60, max: 150 },
    medium: 'pinned-board',
    // Beside `any-lab` at the same rung: another lens on the same marks.
    altitudeAnchor: 'cluster-close',
    boardLens: 'burn',
    boardHighlight: 'whole-fleet',
    screens: 1,
    status: 'reserved',
    // RESERVED 2026-08-17 (W6b, operator): "eight panels to four or five",
    // and this is the panel the named four leave out. Cross-vendor spend is
    // still the thing nobody else in the category shows, so the LENS stays
    // built and resolved: promoting the row back is a status edit, not a
    // rebuild. It comes back on a page that has room for a sixth claim.
    reservedUntil:
      'The page has room for a sixth claim. The burn lens is built and resolves today.',
  },
  {
    id: 'altitude-team',
    job: 'CONTINUITY. One project, closer in, every agent in it still an individual.',
    headingRole: 'section',
    heading: 'One project',
    copyBudget: { min: 20, max: 32 },
    medium: 'pinned-board',
    altitudeAnchor: 'team',
    boardLens: 'status',
    boardHighlight: 'one-project',
    screens: 1,
    status: 'reserved',
    // W8: one dive, not two. W9 gave the Project framing back to
    // `altitude-delegation`, which holds it for a full panel, so the dive
    // stops there on the way down whether or not this row is ever promoted.
    reservedUntil:
      'The dive needs a second stop at the project framing, beyond the one `altitude-delegation` already holds.',
  },
  {
    id: 'altitude-delegation',
    job: 'TRAJECTORY. Agents run agents, so the camera opens back out while the fleet blooms.',
    headingRole: 'section',
    heading: 'Agents run agents',
    copyBudget: { min: 18, max: 36 },
    medium: 'pinned-board',
    // IN A STEP, onto the Project the dive is already heading for (W9). This
    // panel used to pull all the way back out to the fleet, which was the
    // single largest reversal in the run and the one the operator felt most.
    // The bloom does not need distance; it needs to be LEGIBLE, and a child
    // mark blooming out of its parent is legible at the Project framing and
    // invisible at the fleet's. The rest of the fleet is still there, receded,
    // saying that this is happening everywhere.
    altitudeAnchor: 'team',
    boardLens: 'status',
    boardHighlight: 'delegation',
    screens: 1,
    status: 'proposed',
  },
  {
    id: 'altitude-agent',
    job: 'DEPTH. All the way down to one agent, with a status that changes while you read it.',
    headingRole: 'section',
    heading: 'Down to one agent',
    copyBudget: { min: 22, max: 40 },
    medium: 'pinned-board',
    // THE DIVE, MOVED UP SO THE PAGE ZOOMS IN CLOSER, FASTER (ENG-031 W13,
    // operator: move `Down to one agent` up one). It was the last panel over
    // the board; it is now the ARRIVAL the last three panels share.
    //
    // Why the naive reorder was not available. The operator also asked for
    // `Your machine, your keys` to be the LAST section, and the camera may
    // only ever close in (W9). Putting a wide framing after the dive is a
    // reversal, so the resolution is that the dive happens once and the two
    // panels after it HOLD the frame it arrived on. That is the stronger
    // reading anyway: the reader is looking at one agent when the page says
    // push this agent to the cloud, and ownership lands last, on the one
    // Agent the whole run travelled to, immediately above the button.
    altitudeAnchor: 'agent',
    boardLens: 'status',
    boardHighlight: 'one-agent',
    screens: 1,
    status: 'proposed',
  },
  {
    id: 'cloud',
    job: 'DURATION. The long work leaves your laptop and keeps going without you.',
    headingRole: 'section',
    heading: 'Push an agent to the cloud',
    // Written at 32. The floor sits under that so a later pass can cut a line
    // without this test asking for it back.
    copyBudget: { min: 26, max: 44 },
    medium: 'pinned-board',
    // HOLDS THE AGENT FRAMING (ENG-031 W13; it held the Project framing in
    // W12, before the dive moved up). The camera neither moves nor reverses,
    // and the reader is looking at exactly one running agent while the page
    // says push a running agent to the cloud. The sentence and the picture
    // are about the same thing for the first time.
    //
    // The board still does not PRETEND to prove it: hosted placement is not a
    // property the frozen capture carries, and lighting a mark as though it
    // were already running somewhere else would be a claim the picture cannot
    // make. It holds the agent it already has, and the words do the work.
    altitudeAnchor: 'agent',
    boardLens: 'status',
    // THE FLEET COMES BACK UP AROUND THE ONE AGENT. The dive lit one mark and
    // receded the rest; here the rest return to full strength while the
    // sentence says the long work leaves the laptop. That is a claim the
    // picture can honestly make (everything around this agent is still
    // running) and it is what keeps the run's last three panels three
    // pictures rather than one held for a third of the page.
    boardHighlight: 'whole-fleet',
    screens: 1,
    status: 'proposed',
  },
  {
    id: 'trust',
    job: 'OWNERSHIP. Whose machine this runs on, whose account, whose keys, and where the work stays.',
    headingRole: 'section',
    heading: 'Your machine, your keys, your repo',
    // Floor 30 to 26 in W12, because the coda came off (operator: "kill ...
    // such overpedantic hyperpolite copy lines") and the two claims that
    // remain are 31 words. The floor sits under what is written, as always.
    copyBudget: { min: 26, max: 46 },
    medium: 'pinned-board',
    // THE LAST THING THE PAGE SAYS OVER THE BOARD (ENG-031 W13, operator:
    // move `Your machine, your keys` to be the last section). W9 held it
    // beside `any-lab` and argued it could not come after the dive, because
    // getting back OUT to say it would be the reversal the run exists to
    // remove. That argument was about a framing, not about a position: it
    // does not have to get back out, it can HOLD the dive's frame. So it
    // does, and ownership is now the last claim before the call to action,
    // which is where a closing reassurance belongs.
    altitudeAnchor: 'agent',
    // Declared `permission` and resolved as `status` until the fixture carries
    // a per-Agent approval mode. Declaring the intent in the manifest and
    // resolving it honestly in the lens is the whole point of the seam.
    boardLens: 'permission',
    boardHighlight: 'one-agent',
    screens: 1,
    status: 'proposed',
  },
  {
    id: 'security',
    job: 'The provider-owned boundary today, graduated Exawatt enforcement later.',
    headingRole: 'section',
    heading: null,
    copyBudget: { min: 30, max: 60 },
    medium: 'type',
    altitudeAnchor: null,
    boardLens: null,
    boardHighlight: null,
    screens: 1,
    status: 'reserved',
    // The honest security story today is the provider's boundary plus the
    // per-Agent permission choice, and that is a control the reader has, so it
    // lives in `trust` as a control. A band whose whole subject is a
    // deficiency promotes the deficiency.
    reservedUntil:
      'Exawatt mediates a high-impact action itself. Until then the honest half lives in `trust`.',
  },
  {
    id: 'open-source',
    job: 'The AGPL app and the Apache-2.0 spec, in a human voice.',
    headingRole: 'section',
    heading: 'Open source, on purpose',
    copyBudget: { min: 60, max: 130 },
    medium: 'type',
    altitudeAnchor: null,
    boardLens: null,
    boardHighlight: null,
    screens: 1,
    status: 'reserved',
    // W8 moved this to the FOOTER column, which is where the research put it:
    // open source belongs as a band and a footer column, never the headline,
    // and the page had one screen too many. `site-footer.tsx` states the split
    // once, plainly.
    reservedUntil:
      'The two-license split needs more than the footer column states. It is stated once in `site-footer.tsx` today.',
  },
  {
    id: 'proof',
    job: 'ALIVE. A dated list of what landed.',
    headingRole: 'section',
    heading: null,
    copyBudget: { min: 40, max: 110 },
    medium: 'cards',
    altitudeAnchor: null,
    boardLens: null,
    boardHighlight: null,
    screens: 1,
    status: 'reserved',
    // RETIRED 2026-08-18 (W10, operator: "Remove the What shipped ...
    // section"). The dated list, its five rows, its heading and its link are
    // DELETED rather than parked: `proof-band.tsx` and `narrative-copy.ts`
    // are gone, and the nav's `Changelog` item points at the releases page,
    // which is where the rest of the list already lived.
    //
    // The row stays because the slot is real. PROOF is one of the sixteen-site
    // skeleton's own sections and the page still has no named human in
    // `voice`, so if borrowed credibility is ever needed again this is where
    // it goes. What it may not do is come back as a second tall reading block
    // under a graphic that is already the argument.
    reservedUntil:
      'The page needs borrowed credibility again, and it can be shown without a second tall reading block under the board.',
  },
  {
    id: 'close',
    job: 'Act. The same button as the fold, requirement line beneath.',
    headingRole: 'closing',
    heading: null,
    copyBudget: { max: 10 },
    medium: 'type',
    altitudeAnchor: null,
    boardLens: null,
    boardHighlight: null,
    screens: 1,
    status: 'proposed',
  },
];

/**
 * WHICH ARRANGEMENT THE HOMEPAGE RENDERS, and the one-line switch that
 * promotes the proposal (ENG-031 W8).
 *
 * `shipped`  — `/` renders only bands at `status: 'shipped'`. Today that is
 *              the fold, exactly as it has rendered since W1.
 * `proposed` — `/` renders the whole assembled arc, which is what `/v2` shows
 *              today.
 *
 * CHANGING THIS ONE VALUE IS THE PROMOTION. It moves the arc onto `/`, swaps
 * the fold's interior to `FoldHero`, and switches the site chrome to the W6
 * nav and footer, because all three derive from it. `/v2` then retires: it is
 * a review address, and leaving a second copy of the homepage at a memorable
 * URL is how a stale front door happens.
 */
export type HomepageArrangement = 'shipped' | 'proposed';

export const HOMEPAGE_ARRANGEMENT: HomepageArrangement = 'shipped';

export function bandById(id: BandId): HomepageBand {
  // ids are a closed union, so a miss is a programming error, not a state.
  return HOMEPAGE_BANDS.find(band => band.id === id)!;
}

/** The bands `/` renders today, in page order. */
export function shippedBands(): HomepageBand[] {
  return HOMEPAGE_BANDS.filter(band => band.status === 'shipped');
}

/** The whole assembled arc: what `/v2` renders, and what `/` renders the
 *  moment `HOMEPAGE_ARRANGEMENT` flips. */
export function proposedBands(): HomepageBand[] {
  return HOMEPAGE_BANDS.filter(band => band.status !== 'reserved');
}

/** The bands an arrangement renders, in page order. */
export function arrangementBands(
  arrangement: HomepageArrangement = HOMEPAGE_ARRANGEMENT
): HomepageBand[] {
  return arrangement === 'proposed' ? proposedBands() : shippedBands();
}

/** Declared slots with no content on the page. They render nothing. */
export function reservedBands(): HomepageBand[] {
  return HOMEPAGE_BANDS.filter(band => band.status === 'reserved');
}

export function anchorsHeroCamera(band: HomepageBand): boolean {
  return band.altitudeAnchor !== null;
}

/** The bands that drive the ONE pinned board, in page order. */
export function pinnedBoardBands(
  bands: HomepageBand[] = proposedBands()
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
 * - consecutive panels may share an altitude, which makes the camera hold
 *   while the board itself makes the argument;
 * - the ladder is MONOTONIC (W9). Depth never decreases, so the reader is
 *   only ever taken further in, and the run ends on the one agent it has been
 *   travelling towards. `pinnedAltitudeDepths()` is what a test asserts on.
 */
export function pinnedAltitudeLadder(
  bands: HomepageBand[] = proposedBands()
): BandAltitude[] {
  return pinnedBoardBands(bands).map(band => band.altitudeAnchor ?? 'fleet');
}

/**
 * How deep the camera is at each band that anchors it, in page order, the fold
 * included (ENG-031 W9).
 *
 * This is the sequence the monotonicity test reads. The FOLD has to be in it:
 * it is the graphic's first frame, `bandRuns()` merges it into the run, and the
 * single worst reversal the page ever shipped was the one between the fold's
 * crop and the panel directly after it.
 */
export function pinnedAltitudeDepths(
  bands: HomepageBand[] = proposedBands()
): number[] {
  return heroCameraAnchors(bands).map(
    anchor => BAND_ALTITUDE_DEPTH[anchor.altitude]
  );
}

/**
 * The page as the composer walks it: bands in order, with each consecutive run
 * of `pinned-board` bands collected into ONE entry.
 *
 * This is what makes "one persistent graphic, several explanations" structural
 * rather than a component's private opinion. A pinned run is not eight bands
 * that each mount a board; it is one board and eight panels, and the page
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
    if (previous?.kind === 'pinned-board') {
      previous.bands.push(band);
      continue;
    }
    // THE FOLD JOINS THE GRAPHIC WHEN THE GRAPHIC FOLLOWS IT (ENG-031 W6b).
    // Before this, `/v2` mounted two `HeroBoard` instances: a full-width one
    // in the fold and a second one at the top of the run, which produced a
    // visible seam at 900px, two fleet-count chips, and two legends. One
    // instance is also what makes the page's own claim true, so the merge is
    // structural rather than a de-duplication. It is conditional on a run
    // FOLLOWING, because `/` renders the fold alone and a pinned run of one
    // would put the proposed fold on the shipped homepage.
    if (previous?.kind === 'band' && previous.band.id === 'fold') {
      runs[runs.length - 1] = {
        kind: 'pinned-board',
        bands: [previous.band, band],
      };
      continue;
    }
    runs.push({ kind: 'pinned-board', bands: [band] });
  }
  return runs;
}

/**
 * The camera choreography, derived rather than authored twice: the ordered
 * altitude anchors are the journey the board follows.
 */
export function heroCameraAnchors(bands: HomepageBand[] = proposedBands()): {
  id: BandId;
  altitude: BandAltitude;
}[] {
  return bands.filter(anchorsHeroCamera).map(band => ({
    id: band.id,
    altitude: band.altitudeAnchor!,
  }));
}

/** Worst-case word count if every rendered band spent its whole budget. */
export function pageCopyCeiling(
  bands: HomepageBand[] = proposedBands()
): number {
  return bands.reduce((total, band) => total + band.copyBudget.max, 0);
}

/** Total viewport heights the rendered page occupies. */
export function pageScreens(bands: HomepageBand[] = proposedBands()): number {
  return bands.reduce((total, band) => total + band.screens, 0);
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

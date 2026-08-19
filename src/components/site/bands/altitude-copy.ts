import { bandById, countWords, type BandId } from './manifest';

/**
 * The pinned sequence's panels (ENG-031 W4, rewritten W5, widened W8, CUT W6b,
 * cut again W6c).
 *
 * ONE graphic, six explanations. Each panel says what the board is doing
 * WHILE the board does it, and names the thing it is pointing at. The names
 * and the numbers are never written here: `hero-board-highlight.ts` and
 * `hero-board-lens.ts` read them off the frozen capture, so the copy and the
 * picture cannot drift apart, and a regenerated capture can never make a
 * sentence false.
 *
 * WHY THIS FILE SHRANK (operator, 2026-08-17): "I don't want to read all the
 * text on that page." W8 gave every panel a claim AND a trio of sub-headed
 * mechanisms, and the page reached 1,216 words. The diagnosis is that a
 * mechanism list is DOCUMENTATION: it is the right thing to write when a
 * reader has already decided to trust you and wants to check how, and it is
 * the wrong thing to put beside a graphic that is making the argument by
 * changing. Every trio is deleted. What each panel keeps is one heading, one
 * two-sentence claim, and one line of state read off the board itself.
 *
 * THE CUT IS VOLUME, NOT REGISTER. Every sentence the page was known by is
 * still here: "Never a green check that lies" and the plain-voice product
 * sentences. Nothing was softened, generalised, or made safer. (W12 retired
 * the other line this paragraph used to name; see below.)
 *
 * W6C, THE SECOND CUT: ONE CLAIM PER PANEL, AND EVERY SENTENCE DOES WORK.
 * W6b removed the mechanism trios and left each panel with a two-sentence
 * claim, a coda, and a state line. Read as a cold developer, VC or founder,
 * four of those sentences were still CAPTIONS on a picture that was already
 * saying it, and one was mechanism a stranger has no use for until after they
 * trust us. Each cut is named where it happened:
 *
 * - `altitude-attention` loses "Reported by the agent, never guessed from its
 *   output." That is how the colour is true, which is a docs sentence. The
 *   claim above it already spends the honesty, and `altitude-agent` now says
 *   the same fact as a value ("in its own words").
 * - `altitude-agent` loses "Drop all the way in and an agent is a name, the
 *   work it is on, and a status that changes while you read it", which was 24
 *   words describing the frame the reader is looking at.
 * - `altitude-delegation` loses "Some of these agents are running agents of
 *   their own", which restated its own heading.
 * - `any-lab` loses "The same board, coloured by what is running each agent",
 *   because the legend under it names the harnesses off the capture, and its
 *   coda is PROMOTED into the claim: "Bring the plan you already pay for" is
 *   the commercial answer a stranger actually wants, and it was set at 13px.
 * - `trust` keeps its coda. A disclosure with a control attached is a feature
 *   and a disclosure without one is a warning (`marketing.md`, "Disclosure is
 *   not apology"), so the switch stays. SUPERSEDED BY W12, which removes the
 *   coda and the `coda` field with it; the reason is in the W12 block below.
 *
 * W9, THE ORDER IS THE CAMERA PATH (operator: "I like it when it goes only
 * one direction smoothly across multiple steps"). The panels are resequenced,
 * not rewritten: each claim already stood alone, so the reorder cost no
 * sentence. What it bought is a camera that holds or closes in at every step
 * and never opens back out, and a run that ENDS on the dive, which is the
 * frame both design reviews called the best on the page.
 *
 * W12, THREE PANELS REWRITTEN CONCRETE AND ONE ADDED (operator, 2026-08-19).
 * Every note here is a rejection of ABSTRACTION, and each one is answered in
 * the panel it names rather than by a general resolve to write better:
 *
 * - `altitude-attention`: "this copy really sucks - make it more about see
 *   100s of agents in one screen." The panel used to make an aphoristic claim
 *   about where to look ("The board tells you where to look, so you never go
 *   looking" / "Every colour here is a claim, and a wrong one costs you a
 *   trip"). The second of those is the clever-not-useful register outright: it
 *   is a sentence about the COST OF A LIE rather than about what the reader
 *   can see. Both are replaced by the claim the board is actually making, in
 *   the number the operator asked for: a hundred agents at once, and the ones
 *   waiting on you are the lit ones.
 * - `any-lab`: "way too abstract." "None of them will sell you the seat you
 *   command them from" is a metaphor about a market; the reader wants to know
 *   what runs. The harnesses are NAMED now, in the product's own labels from
 *   `contracts/agent-sources.json`, with the one that cannot be launched today
 *   marked as arriving rather than listed beside the four that can. The
 *   commercial line W6c promoted out of a coda survives as the second half of
 *   the second sentence, which is where it was already doing the work.
 * - `trust`: the coda goes. "kill that and other such overpedantic hyperpolite
 *   copy lines." W6c kept "Every outbound feature has a switch in Settings"
 *   under the `marketing.md` rule that a disclosure with a control is a
 *   feature and one without is a warning. That rule is not violated by
 *   removing it, because there is no longer a DISCLOSURE on this panel for it
 *   to attach to: what remains is a claim that nothing leaves the machine, and
 *   a switch for an outbound behaviour the page does not describe is a
 *   footnote about Settings on a page a stranger has not installed yet.
 * - `cloud` is NEW: ENG-033's one user-facing promise, and the future tense is
 *   IN THE SENTENCE rather than in a badge. `marketing.md` -> "Aspiration is
 *   half the message" makes the future tense first-class and draws the line at
 *   a false claim about PRESENT behaviour, so "Soon you will push" is the
 *   honest form and "Push a running agent to the cloud" alone would not be.
 *
 * THE PANELS, one claim at a time, each one a claim the board is
 * simultaneously proving:
 *
 * 1. `fold` WHAT. Not written here: the fold's own copy is the operator's
 *    frame in `fold-copy.ts`. It is the first frame of this graphic, and its
 *    crop is the widest the page ever shows.
 * 2. `altitude-attention` SCALE AND ATTENTION. The camera glides in while the
 *    board recedes to the agents waiting on a person, so a hundred marks are
 *    on screen and only the ones that want something are lit.
 * 3. `any-lab` PROVENANCE. One step in, and the fleet recolours by the harness
 *    running each agent, so vendor neutrality proves itself.
 * 4. `trust` OWNERSHIP. Whose machine, whose keys, whose repo, said while the
 *    marks it is a claim about are all still in frame.
 * 5. `altitude-delegation` TRAJECTORY. In a step, onto the Project where a
 *    child mark blooming out of its parent is actually legible.
 * 6. `cloud` DURATION. The same framing, held: the fleet returns to full
 *    strength while the one claim on the page written in the future tense is
 *    made over it.
 * 7. `altitude-agent` DEPTH. All the way down to one agent whose status
 *    changes while it is read, and then the page releases into the button.
 *
 * `altitude-fleet` and `cost` are RESERVED, each with its reason in
 * `manifest.ts`. Their lenses and highlights still resolve, so either is a
 * status edit away from returning.
 *
 * RULES, all inherited and all asserted in `altitude-copy.test.ts`:
 *
 * - each panel's declared `copyBudget`, counted with its heading;
 * - no em dashes (operator: "that's an AI smell");
 * - the reader is never the bottleneck; the tools are (`marketing.md`);
 * - never the five words banned from the fold, on the same merits;
 * - never a Project name, an Agent name, or a count. Those come from the
 *   capture through the panel's subject line and its legend, which is why a
 *   regenerated fixture cannot turn a sentence into a lie.
 *
 * ASPIRATION LEADS (operator, 2026-08-17). Future tense is a first-class
 * register here. The one line the copy does not cross is a false SPECIFIC
 * FACTUAL CLAIM ABOUT PRESENT BEHAVIOUR, and every present-tense mechanism
 * below was read out of the code rather than remembered:
 * `electron/main/pty/attention-monitor.ts`,
 * `src/components/workspace/session-status.ts`,
 * `contracts/agent-sources.json`, and the `/download` disclosures.
 */

export interface AltitudePanelCopy {
  /** Band id, so the panel and its declaration cannot separate. */
  id: BandId;
  /** The panel's body, one entry per rendered line. */
  copy: string[];
}

/**
 * THERE IS NO CODA FIELD (ENG-031 W12, operator: "kill that and other such
 * overpedantic hyperpolite copy lines").
 *
 * W6b allowed exactly one quiet line under a claim and W6c left one panel
 * using it. The shape is retired rather than emptied, per the burn-bridges
 * rule: a 13px explanatory sentence under a claim is where a panel hides the
 * thing it could not justify saying at full size, and leaving the field in
 * place is an invitation to write another one. A panel is a heading, a claim,
 * and whatever the board itself says beside it.
 */

export const ALTITUDE_PANELS: AltitudePanelCopy[] = [
  {
    id: 'altitude-attention',
    copy: [
      'See what every one of them is doing without opening a single one.',
      'The ones waiting on you light up. The rest keep working.',
      'Take your agentmaxxing to the next level.',
    ],
  },
  {
    id: 'any-lab',
    copy: [
      'Command Claude Code, Codex, OpenCode, Grok Build and OpenClaw.',
      'They run side by side on one board, on the plan you already pay for.',
    ],
  },
  {
    id: 'altitude-delegation',
    copy: [
      'The work fans out and comes back under the one that asked for it.',
      'This is how ten becomes ten thousand.',
    ],
  },
  {
    id: 'altitude-agent',
    copy: [
      'Command a thousand. Drop into any one of them and it tells you exactly what it is doing.',
      'Working, needs you, done. Never a green check that lies.',
    ],
  },
  {
    id: 'cloud',
    copy: [
      'Push a running agent to the cloud and close your laptop.',
      'Long-horizon work runs for hours or days, and it keeps running after you walk away.',
    ],
  },
  {
    id: 'trust',
    copy: [
      'Your agents run on your Mac, under your account, on your keys.',
      'Your code, your prompts, and what your agents write never pass through Exawatt.',
    ],
  },
];

export function altitudePanel(id: BandId): AltitudePanelCopy | undefined {
  return ALTITUDE_PANELS.find(panel => panel.id === id);
}

/** Reading words in a panel: its heading and its claim. */
export function panelWords(panel: AltitudePanelCopy): number {
  return countWords(
    [bandById(panel.id).heading ?? '', ...panel.copy].join(' ')
  );
}

/** Every word a reader reads across the whole pinned run. */
export function pinnedRunWords(): number {
  return ALTITUDE_PANELS.reduce((total, panel) => total + panelWords(panel), 0);
}

/** Everything a reader reads in the panel layer, for a lint pass. */
export function panelProse(): string {
  return ALTITUDE_PANELS.flatMap(panel => panel.copy).join(' ');
}

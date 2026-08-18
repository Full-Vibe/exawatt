import { bandById, countWords, type BandId } from './manifest';

/**
 * The pinned sequence's panels (ENG-031 W4, rewritten W5, widened W8, CUT W6b,
 * cut again W6c).
 *
 * ONE graphic, five explanations. Each panel says what the board is doing
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
 * still here: "Every colour here is a claim, and a wrong one costs you a
 * trip", "Never a green check that lies", and the plain-voice product
 * sentences. Nothing was softened, generalised, or made safer.
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
 *   not apology"), so the switch stays.
 *
 * W9, THE ORDER IS THE CAMERA PATH (operator: "I like it when it goes only
 * one direction smoothly across multiple steps"). The panels are resequenced,
 * not rewritten: each claim already stood alone, so the reorder cost no
 * sentence. What it bought is a camera that holds or closes in at every step
 * and never opens back out, and a run that ENDS on the dive, which is the
 * frame both design reviews called the best on the page.
 *
 * THE PANELS, one claim at a time, each one a claim the board is
 * simultaneously proving:
 *
 * 1. `fold` WHAT. Not written here: the fold's own copy is the operator's
 *    frame in `fold-copy.ts`. It is the first frame of this graphic, and its
 *    crop is the widest the page ever shows.
 * 2. `altitude-attention` ATTENTION. The camera HOLDS on that crop while the
 *    board recedes to the agents waiting on a person. A still camera over a
 *    changing board is the one beat a competitor cannot screenshot.
 * 3. `any-lab` PROVENANCE. One step in, and the fleet recolours by the harness
 *    running each agent, so vendor neutrality proves itself.
 * 4. `trust` OWNERSHIP. Whose machine, whose keys, whose repo, said while the
 *    marks it is a claim about are all still in frame.
 * 5. `altitude-delegation` TRAJECTORY. In a step, onto the Project where a
 *    child mark blooming out of its parent is actually legible.
 * 6. `altitude-agent` DEPTH. All the way down to one agent whose status
 *    changes while it is read, and then the page releases into the dated list
 *    and the button.
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
  /**
   * One quiet line under the claim, and the ONLY thing permitted beneath it
   * (ENG-031 W6b). The `cards` field is gone rather than capped: a sub-headed
   * trio is documentation, and the page it was on is the page the operator
   * said he would not read.
   */
  coda?: string;
}

export const ALTITUDE_PANELS: AltitudePanelCopy[] = [
  {
    id: 'altitude-attention',
    copy: [
      'The board tells you where to look, so you never go looking.',
      'Every colour here is a claim, and a wrong one costs you a trip.',
    ],
  },
  {
    id: 'any-lab',
    copy: [
      'Every lab will sell you agents. None of them will sell you the seat you command them from.',
      'Bring the plan you already pay for. Exawatt never asks for a balance of its own.',
    ],
  },
  {
    id: 'trust',
    copy: [
      'Your agents run on your Mac, under your account, on your keys.',
      'Your code, your prompts, and what your agents write never pass through Exawatt.',
    ],
    coda: 'Every outbound feature has a switch in Settings.',
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
      'Every agent tells you the job it is on, in its own words.',
      'Working, needs you, done. Never a green check that lies.',
    ],
  },
];

export function altitudePanel(id: BandId): AltitudePanelCopy | undefined {
  return ALTITUDE_PANELS.find(panel => panel.id === id);
}

/** Reading words in a panel: its heading, claim, and coda. */
export function panelWords(panel: AltitudePanelCopy): number {
  return countWords(
    [bandById(panel.id).heading ?? '', ...panel.copy, panel.coda ?? ''].join(
      ' '
    )
  );
}

/** Every word a reader reads across the whole pinned run. */
export function pinnedRunWords(): number {
  return ALTITUDE_PANELS.reduce((total, panel) => total + panelWords(panel), 0);
}

/** Everything a reader reads in the panel layer, for a lint pass. */
export function panelProse(): string {
  return ALTITUDE_PANELS.flatMap(panel => [
    ...panel.copy,
    panel.coda ?? '',
  ]).join(' ');
}

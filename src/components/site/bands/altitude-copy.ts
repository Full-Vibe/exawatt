import { bandById, countWords, type BandId } from './manifest';

/**
 * The pinned sequence's panels (ENG-031 W4, rewritten W5, widened W8, CUT W6b).
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
 * THE PANELS, one claim at a time, each one a claim the board is
 * simultaneously proving:
 *
 * 1. `fold` WHAT. Not written here: the fold's own copy is the operator's
 *    frame in `fold-copy.ts`. It is the first frame of this graphic.
 * 2. `altitude-attention` ATTENTION. The camera opens out of the fold's crop
 *    to the whole fleet and the board recedes to the agents waiting on a
 *    person. The one beat a competitor cannot screenshot.
 * 3. `altitude-agent` DEPTH. One dive, down to one agent whose status changes
 *    while it is read. Promoted from fourth to second (operator: it is the
 *    best frame on the site and it was arriving too late).
 * 4. `altitude-delegation` TRAJECTORY. Agents run agents, and the camera opens
 *    back out while the constellations bloom.
 * 5. `any-lab` PROVENANCE. The fleet recolours by the harness running each
 *    agent, so vendor neutrality proves itself.
 * 6. `trust` OWNERSHIP. Whose machine, whose keys, whose repo.
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
    coda: 'Reported by the agent, never guessed from its output.',
  },
  {
    id: 'altitude-agent',
    copy: [
      'Drop all the way in and an agent is a name, the work it is on, and a status that changes while you read it.',
      'Working, needs you, done. Never a green check that lies.',
    ],
  },
  {
    id: 'altitude-delegation',
    copy: [
      'Some of these agents are running agents of their own.',
      'The work fans out and comes back under the one that asked for it. This is how ten becomes ten thousand.',
    ],
  },
  {
    id: 'any-lab',
    copy: [
      'Every lab will sell you agents. None of them will sell you the seat you command them from.',
      'The same board, coloured by what is running each agent.',
    ],
    coda: 'Bring the plan you already pay for. Exawatt never asks for a balance of its own.',
  },
  {
    id: 'trust',
    copy: [
      'Every one of these agents runs on your Mac, under your account, on your keys.',
      'Your code, your prompts, and what your agents write never pass through Exawatt.',
    ],
    coda: 'Every outbound feature has a switch in Settings.',
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

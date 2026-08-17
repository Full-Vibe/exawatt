import { bandById, countWords, type BandId } from './manifest';

/**
 * The pinned sequence's panels (ENG-031 W4, rewritten W5).
 *
 * One graphic, five explanations. Each panel says what the board is doing
 * WHILE the board does it, and names the thing it is pointing at. The names
 * and numbers themselves are never written here: `hero-board-highlight.ts`
 * reads them off the frozen capture, so the copy and the camera cannot drift
 * apart, and a regenerated capture can never make a sentence false.
 *
 * WHY THE COPY WAS REWRITTEN (operator, 2026-08-17): "needs us to think
 * through the narrative at a very high-level and build the story as the user
 * scrolls down". The three original panels DESCRIBED the view. "Every project
 * you run, on one board" is a caption. A caption is what you write when the
 * picture is the subject; here the picture is the EVIDENCE, and the subject is
 * an argument the fold started and the close finishes.
 *
 * THE ARGUMENT, one panel at a time, each one a claim the board is
 * simultaneously proving:
 *
 * 1. `altitude-fleet` SCALE. A fleet is a thing that fits on one screen, and
 *    it keeps fitting as it grows. This answers the fold's 10,000 with a
 *    picture instead of an adjective.
 * 2. `altitude-attention` ATTENTION. The camera does not move; the board
 *    recedes to the agents waiting on a person. This is the claim that scale
 *    is survivable, and it is made by the graphic rather than by the sentence.
 * 3. `altitude-team` CONTINUITY. Closer in is the same board. Nothing was
 *    hidden behind a summary, which is the promise a dashboard cannot make.
 * 4. `altitude-agent` DEPTH. One agent, its real work, and a status that keeps
 *    changing while it is read. The concrete half the standing what-and-why
 *    test asks for.
 * 5. `altitude-delegation` TRAJECTORY. Agents run agents. The camera opens
 *    back out while the constellations bloom, and the panel says the sentence
 *    the whole page has been walking toward.
 *
 * RULES, all inherited and all asserted in `altitude-copy.test.ts`:
 *
 * - each panel's declared `copyBudget`, counted with its heading;
 * - no em dashes (operator: "that's an AI smell");
 * - the reader is never the bottleneck; the tools are (`marketing.md`);
 * - never the five words banned from the fold, on the same merits;
 * - never a Project name, an Agent name, or a count. Those come from the
 *   capture through the panel's subject line, which is why a regenerated
 *   fixture cannot turn a sentence into a lie.
 */
export interface AltitudePanelCopy {
  /** Band id, so the panel and its declaration cannot separate. */
  id: BandId;
  /** The panel's body, one entry per rendered line. */
  copy: string[];
}

export const ALTITUDE_PANELS: AltitudePanelCopy[] = [
  {
    id: 'altitude-fleet',
    copy: [
      'Every project you run, on one board.',
      'Each mark is one agent on one real assignment. Add a hundred more and it is still one screen.',
    ],
  },
  {
    id: 'altitude-attention',
    copy: [
      'The board tells you where to look, so you never go looking.',
      'Agents waiting on a person are the only loud thing on it. The rest keep running without you.',
    ],
  },
  {
    id: 'altitude-team',
    copy: [
      'Drop into one project and its agents are still individuals, not a count.',
      'Same board, closer in. Nothing was hidden behind a summary.',
    ],
  },
  {
    id: 'altitude-agent',
    copy: [
      'Down to one agent: a name, the work it is on, and a status that changes while you read it.',
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
];

export function altitudePanel(id: BandId): AltitudePanelCopy | undefined {
  return ALTITUDE_PANELS.find(panel => panel.id === id);
}

/** Reading words in a panel: its heading and its body. */
export function panelWords(panel: AltitudePanelCopy): number {
  return countWords(
    [bandById(panel.id).heading ?? '', ...panel.copy].join(' ')
  );
}

/** Every word a reader reads across the whole pinned run. */
export function pinnedRunWords(): number {
  return ALTITUDE_PANELS.reduce((total, panel) => total + panelWords(panel), 0);
}

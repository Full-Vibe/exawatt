import { bandById, countWords, type BandId } from './manifest';

/**
 * The pinned sequence's three panels (ENG-031 W4).
 *
 * One graphic, three explanations. Each panel says what the board is doing
 * WHILE the board does it, and names the thing it is pointing at. The names
 * themselves are never written here: `hero-board-highlight.ts` reads them off
 * the frozen capture, so the copy and the camera cannot drift apart.
 *
 * The rules, all inherited and all asserted in `altitude-copy.test.ts`:
 *
 * - 20 to 25 words per panel, from each band's declared `copyBudget`;
 * - no em dashes (operator: "that's an AI smell");
 * - the reader is never the bottleneck (`fold-copy.ts`, `marketing.md`);
 * - never the five words banned from the fold, on the same merits;
 * - state what the product DOES; never explain the page to the reader.
 *
 * WHY THESE THREE SENTENCES. The page's spine is the altitude ladder, and the
 * ladder's job is to answer "what is it" without spending words on the answer.
 * So each panel does exactly one thing the board is simultaneously proving:
 * Fleet says colour means state and only the waiting agents are loud; Team
 * says the agents keep their names when you open a project; Agent says the
 * status is live and specific. Nothing here describes scrolling, the graphic,
 * or the page.
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
      'Colour is state, and the only agents that speak up are the ones waiting on you.',
    ],
  },
  {
    id: 'altitude-team',
    copy: [
      'Open one project and every agent in it is a mark you can count.',
      'Work moving, work finished, and work waiting on you.',
    ],
  },
  {
    id: 'altitude-agent',
    copy: [
      'Close in and every mark is one agent.',
      'A name, the task it is running, and a status that changes while you watch.',
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

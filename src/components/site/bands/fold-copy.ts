import { bandById, countWords } from './manifest';

/**
 * Fold and close copy, as an options study (ENG-031 W3, reframed W3b).
 *
 * Four complete arrangements of ONE frame, so the operator compares real type
 * on a real page instead of reading a list of sentences. Every variant is
 * shippable; picking one is a one-word edit of `DEFAULT_FOLD_CLOSE_VARIANT`.
 *
 * WHY THE FIRST FOUR VARIANTS WERE THROWN AWAY (operator, 2026-08-17):
 * "Hmm those copy options all kind of suck. 'Two hundred you cannot' - are you
 * trying to pitch me that I can't watch 200 agents? This doesn't make sense to
 * me as a user."
 *
 * The structural flaw, and it is a rule now, not a note: THAT COPY MADE THE
 * READER THE BOTTLENECK. Telling a user what they cannot do is an insult
 * dressed as a value proposition. The enemy is the old way of working and the
 * tools that have not kept up, never the reader's own capacity. See
 * `marketing.md`, "Copy rules".
 *
 * THE FRAME, which is the operator's own draft and the spine of all four:
 *
 *   "Today you run 10 agents. Tomorrow you will run 10,000. Exawatt is the
 *   command interface for your team's agent fleets. The economy is refactoring
 *   and your tools need to keep up. Download now"
 *
 * AMENDED 2026-08-17 (operator, on the shipped study): the product sentence is
 * SINGULAR and drops the possessive. "Exawatt is the command interface for
 * your agent fleet." One reader, one fleet. "Your team's agent fleets" made a
 * reader count other people's fleets before they had run one of their own, and
 * the plural read as a category rather than a thing you operate. Team reach
 * now comes from the trajectory, not from the possessive.
 *
 * Four things in it survive every variant below:
 *
 * - TRAJECTORY, NOT LIMITATION. Today to tomorrow. The reader is already
 *   climbing and the product meets them further up. This is also what makes
 *   the big number honest: 10,000 as a future is true in a way that 10,000
 *   today is not, which resolves the honest-scale constraint the brief spends
 *   pages on without softening the claim.
 * - THE TOOLS ARE THE BOTTLENECK, stated outright.
 * - ONE READER, ONE FLEET. "your agent fleet", singular, no possessive
 *   (operator, 2026-08-17). The climb from 10 to 10,000 is what reaches past
 *   the single operator; the product sentence stays addressed to one person.
 * - A DIRECT CTA, and the thesis line integrated into the flow rather than
 *   fighting the headline for the top slot.
 *
 * WHAT THE FOUR VARY, since the frame is settled:
 * - A holds the trajectory as a two-line h1 and spends the thesis AND the
 *   enemy at 72px, where the type is loudest. 20 words above the fold.
 * - B demotes today to the kicker so the honest future number owns the whole
 *   h1, and puts the enemy directly under it.
 * - C keeps the operator's thesis sentence verbatim in the subhead, in his
 *   order, over a clipped one-to-a-thousand pairing.
 * - D names the old tool as the foil in the h1 and weights the team hardest,
 *   leaving the concrete numbers for the close.
 *
 * His draft runs 31 words above the fold against a 24-word ceiling. Every
 * variant here earns those words back without giving up the trajectory, the
 * tools-not-you enemy, or the team reach.
 *
 * RULES HELD BY CONSTRUCTION, each asserted in `fold-copy.test.ts`:
 * - under 26 words above the fold (the manifest ceiling is 24);
 * - 10 words or fewer at the close;
 * - no em dashes anywhere (operator: "that's an AI smell");
 * - never in the fold: orchestration, platform, SDLC, agentic, command center;
 * - never a sentence in which the reader is the thing that fails.
 *
 * Competitor overlap is awareness, not a blocklist (`marketing.md`,
 * "Competitor phrasing: note it, do not route around it"). Plain person-voice
 * sentences stay available to us.
 */

export type FoldCloseVariantId = 'a' | 'b' | 'c' | 'd';

export interface FoldCloseVariant {
  id: FoldCloseVariantId;
  /** How the operator refers to it while comparing. */
  name: string;
  /**
   * Small line above the headline, or null. Used only where demoting a clause
   * buys the headline something: in B it hands the whole h1 to the future
   * number while keeping the honest present tense on the page.
   */
  kicker: string | null;
  /**
   * The h1, one entry per rendered line. The LAST line is full strength and
   * every line before it is set back, which is the two-tone treatment the
   * brief already sanctions for the thesis band.
   */
  headline: string[];
  /** The subhead, one entry per rendered line. */
  subhead: string[];
  /** The closing band's line. Biggest type on the page, 10 words or fewer. */
  close: string;
  /** One line for the operator, in the switcher. Never rendered on the page. */
  note: string;
}

export const FOLD_CLOSE_VARIANTS: FoldCloseVariant[] = [
  {
    id: 'a',
    name: 'Ten thousand',
    kicker: null,
    headline: ['Today you run 10 agents.', 'Tomorrow you will run 10,000.'],
    subhead: ['Exawatt is the command interface for your agent fleet.'],
    close: 'The economy is refactoring.',
    note: 'His draft, tightened to 20. Both halves of the climb at 60px; the thesis and the enemy spend at 72px, right above the button.',
  },
  {
    id: 'b',
    name: 'Tomorrow',
    kicker: 'Today you run 10 agents.',
    headline: ['Tomorrow you will run 10,000.'],
    subhead: [
      'Your tools need to keep up.',
      'Exawatt is the command interface for your fleet.',
    ],
    close: 'The economy is refactoring.',
    note: 'The future number owns the whole h1 and the enemy sits directly under it. The vision line alone at 72px.',
  },
  {
    id: 'c',
    name: 'Refactoring',
    kicker: null,
    headline: ['Today, one agent.', 'Tomorrow, a thousand.'],
    subhead: [
      'Exawatt is your command interface.',
      'The economy is refactoring and your tools need to keep up.',
    ],
    close: 'Command the fleet you are about to run.',
    note: 'His thesis sentence, kept whole and in his order, over the tightest honest pairing. The close is an imperative.',
  },
  {
    id: 'd',
    name: 'Built for one',
    kicker: null,
    headline: [
      'Your tools were built for one agent.',
      'Your team is about to run thousands.',
    ],
    subhead: ['Exawatt is the command interface for your agent fleet.'],
    close: 'Today, 10 agents. Tomorrow, 10,000.',
    note: 'The old tool is named as the foil in the h1 and the team carries the climb there. The numbers land at 72px.',
  },
];

/**
 * What the page renders when nothing is selected. This is the agent
 * recommendation and the single edit that ships the operator's pick.
 */
export const DEFAULT_FOLD_CLOSE_VARIANT: FoldCloseVariantId = 'a';

export function foldCloseVariant(
  id: FoldCloseVariantId | string | null | undefined
): FoldCloseVariant {
  return (
    FOLD_CLOSE_VARIANTS.find(variant => variant.id === id) ??
    FOLD_CLOSE_VARIANTS.find(
      variant => variant.id === DEFAULT_FOLD_CLOSE_VARIANT
    )!
  );
}

/** Every word a reader reads above the fold: kicker, headline, subhead. */
export function foldWords(variant: FoldCloseVariant): number {
  return countWords(
    [variant.kicker ?? '', ...variant.headline, ...variant.subhead].join(' ')
  );
}

/** The closing line only. The repeated button is an affordance, not copy. */
export function closeWords(variant: FoldCloseVariant): number {
  return countWords(variant.close);
}

export function foldBudget(): number {
  return bandById('fold').copyBudget.max;
}

export function closeBudget(): number {
  return bandById('close').copyBudget.max;
}

/**
 * Words banned from the fold, each on its own merits: category nouns and
 * jargon that say nothing specific (brief, "Copy"; `marketing.md`,
 * "Competitor phrasing"). This is the ONLY word list in the copy layer, and it
 * exists because these five were named explicitly.
 */
export const FOLD_FORBIDDEN = [
  'orchestration',
  'platform',
  'SDLC',
  'agentic',
  'command center',
];

/**
 * Constructions that make the READER the thing that fails, which is what got
 * the first four variants rejected. A phrase list cannot police an idea, so
 * this stays deliberately small and literal: it catches the exact shapes that
 * shipped, and the reason lives in the doc comment above and in
 * `marketing.md`. The word "cannot" is not banned on its own; "you cannot" is.
 */
export const READER_AS_BOTTLENECK = [
  'you cannot',
  "you can't",
  'you fail',
  'you are the bottleneck',
  'too many for you',
  'more than you can',
  'keep up with',
];

/** Everything a reader sees in the fold or the close, for a lint pass. */
export function variantProse(variant: FoldCloseVariant): string {
  return [
    variant.kicker ?? '',
    ...variant.headline,
    ...variant.subhead,
    variant.close,
  ].join(' ');
}

import { bandById, countWords } from './manifest';

/**
 * Fold and close copy, as an options study (ENG-031 W3).
 *
 * Four complete arrangements of the SAME two approved directions, so the
 * operator compares real type on a real page instead of reading a list of
 * sentences. Every variant is shippable; picking one is a one-word edit of
 * `DEFAULT_FOLD_CLOSE_VARIANT`.
 *
 * WHAT IS BEING DECIDED, and it is one question:
 * does "The economy is refactoring." run as the h1, or is it demoted so the
 * control thesis can lead? The operator does not want to give up the thesis
 * line and asked for a two-way door, so the study spends its four slots on
 * three different WEIGHTS for it rather than on four different sentences:
 *
 * - A demotes it to a kicker above the control thesis;
 * - B keeps it as the h1 proper, with the control thesis as the subhead;
 * - C demotes it to a kicker above the imperative value line;
 * - D removes it from the fold entirely and spends it at the close, where the
 *   type is 72px. That is the third answer to "I hate to give up the h1
 *   thesis": you do not give it up, you make it the loudest thing on the page.
 *
 * THE TWO APPROVED DIRECTIONS (operator, 2026-08-16):
 * - "One agent you can watch. Two hundred you cannot." carried by A and B.
 * - "Command a fleet of 100 agents." carried by C and D. Its second clause was
 *   unresolved; "See everything all of them did" was called clunky and wanted
 *   tightening toward control or visibility, so the variants carry the two
 *   tightest candidates: "See every one of them." and "Stay in control of
 *   every one."
 *
 * REGISTER: visionary AND concrete, in that combination and never one alone.
 * The vision line says where this goes; the control thesis says why you
 * download it today (`marketing.md`, "The control thesis, found by drill").
 *
 * RULES HELD BY CONSTRUCTION, each asserted in `fold-copy.test.ts`:
 * - under 26 words above the fold (the manifest ceiling is 24);
 * - 10 words or fewer at the close;
 * - no em dashes anywhere (operator: "that's an AI smell");
 * - never in the fold: orchestration, platform, SDLC, agentic, command center.
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
   * Small line above the headline, or null. This is where the vision line
   * goes when the control thesis leads.
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
    name: 'Two hundred',
    kicker: 'The economy is refactoring.',
    headline: ['One agent you can watch.', 'Two hundred you cannot.'],
    subhead: ['Exawatt is the command interface for every agent you run.'],
    close: 'Run two hundred. Watch every one.',
    note: 'Thesis as kicker. The problem is the h1; the product is the subhead.',
  },
  {
    id: 'b',
    name: 'Refactoring',
    kicker: null,
    headline: ['The economy is refactoring.'],
    subhead: [
      'One agent you can watch. Two hundred you cannot.',
      'Exawatt is the command interface for all of them.',
    ],
    close: 'Take command of your fleet.',
    note: 'Thesis kept as the h1. The control thesis carries the subhead.',
  },
  {
    id: 'c',
    name: 'See every one',
    kicker: 'The economy is refactoring.',
    headline: ['Command a fleet of 100 agents.', 'See every one of them.'],
    subhead: ['Exawatt is one screen for every agent you run.'],
    close: 'See every agent. Command every one.',
    note: 'Imperative value line, second clause tightened toward visibility.',
  },
  {
    id: 'd',
    name: 'Stay in control',
    kicker: null,
    headline: [
      'Command a fleet of 100 agents.',
      'Stay in control of every one.',
    ],
    subhead: ['Exawatt shows you what all of them are doing.'],
    close: 'The economy is refactoring.',
    note: 'Second clause tightened toward control. The thesis moves to 72px at the close.',
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

/** Everything a reader sees in the fold or the close, for a lint pass. */
export function variantProse(variant: FoldCloseVariant): string {
  return [
    variant.kicker ?? '',
    ...variant.headline,
    ...variant.subhead,
    variant.close,
  ].join(' ');
}

/**
 * Every mark the story draws, in one registry, in three explicit groups
 * (ENG-031 W15q):
 *
 * - the product's own (`HARNESS_MARK_PATHS`), for the harnesses Exawatt runs
 *   and draws in its chrome;
 * - shipped, drawn only here: a harness Exawatt runs whose mark its chrome
 *   does not draw, Gemini (`gemini-mark.ts`; the product keeps
 *   Antigravity's mark null, ENG-003 S5.3);
 * - concepts (`concept-marks.ts`): agents Exawatt does not run yet.
 *
 * Keys are adapter ids, as in the product's registry, so an agent's mark is
 * found from its source. Order is the tile geometry's mark index.
 */

import { CONCEPT_MARK_PATHS, type ConceptMarkId } from './concept-marks';
import { GEMINI_MARK } from './gemini-mark';
import type { MarkPaths } from './concept-marks';
import {
  HARNESS_MARK_PATHS,
  type HarnessMarkId,
} from '@/components/workspace/harness-icons';

/** Shipped harnesses whose marks the product's chrome does not draw. */
const SHIPPED_SITE_MARK_PATHS = {
  antigravity: GEMINI_MARK,
} satisfies Record<string, MarkPaths>;

type ShippedSiteMarkId = keyof typeof SHIPPED_SITE_MARK_PATHS;

/** A mark the story can draw: the product's, a shipped one drawn only
 *  here, or a concept's. */
export type StoryMarkId = HarnessMarkId | ShippedSiteMarkId | ConceptMarkId;

export const STORY_MARK_PATHS: Record<StoryMarkId, MarkPaths> = {
  ...HARNESS_MARK_PATHS,
  ...SHIPPED_SITE_MARK_PATHS,
  ...CONCEPT_MARK_PATHS,
};

/** Whether a mark belongs to a harness Exawatt does not run yet. */
export function isConceptMark(id: string): boolean {
  return Object.hasOwn(CONCEPT_MARK_PATHS, id);
}

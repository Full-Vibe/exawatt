/** Homepage adapter: concept artwork never enters the shared tile module. */
import {
  makeMarkParts as makeParts,
  markIndexFor as indexFor,
} from '@/components/tiles/crust-marks';
import { STORY_MARK_PATHS } from '../concept-marks';
import { markToneHex } from '../mark-tones';
import type { StoryMarkId } from '../concept-marks';
import type { TileMarkRegistry } from '@/components/tiles/tile-contract';
export { CRUST_MARKS, type CrustMarkId } from '@/components/tiles/crust-marks';
export const STORY_TILE_MARKS: TileMarkRegistry = {
  paths: STORY_MARK_PATHS,
  tone: (id, tone) => markToneHex(id as StoryMarkId, tone),
};
export const MARK_COUNT = Object.keys(STORY_MARK_PATHS).length;
export const markIndexFor = (id: string) => indexFor(STORY_TILE_MARKS, id);
export const makeMarkParts = () => makeParts(STORY_TILE_MARKS);

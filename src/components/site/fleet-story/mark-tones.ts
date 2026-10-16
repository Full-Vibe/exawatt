/**
 * The paint for a harness mark (ENG-031 W15g). The registries
 * (`harness-icons.tsx` for the product's marks, `gemini-mark.ts` and
 * `concept-marks.ts` for the story's own) name a tone for every part of a mark and carry no colour; this
 * is where the story resolves the names, once, for both the 2D glyph in its
 * panels and the 3D mark on its tiles, so the two never disagree. Plain
 * data: nothing here imports three, so the panels do not pull the renderer
 * into the page.
 *
 * `ink` is the surrounding ink, never a tint: Anthropic, OpenAI and xAI
 * forbid recolouring their marks and supply black and white only
 * (LICENSES/brand/harness-marks.md). The exceptions are where the vendor
 * itself supplies a colour: Anthropic draws Claude's mark in its terracotta,
 * OpenClaw's mascot is coral by its own artwork, and Meta draws Muse's in
 * blue. Google draws the Gemini spark in four colours, but the story draws
 * its silhouette in the ink, so it reads as a peer of the others (W15q).
 */

import type { StoryMarkId } from './story-marks';
import { harnessMarkTone } from '@/components/workspace/harness-mark-tones';

/** Story paint for the tones a registry names, per mark. A tone a mark does
 *  not list is `ink`. */
const TONES: Partial<Record<StoryMarkId, Record<string, string>>> = {
  // the middle stop of Meta's gradient
  muse: { brand: '#0064E0' },
};

/** Which mark an agent source draws, from its adapter id. A harness whose
 *  mark the story may not draw (Qwen) and sources that are not vendors have
 *  none. Antigravity draws the Gemini spark here, though the product's
 *  chrome does not (W15q). */
const MARKS: ReadonlySet<string> = new Set<StoryMarkId>([
  'claude',
  'codex',
  'opencode',
  'grok',
  'openclaw',
  'antigravity',
  'grok-bot',
  'muse',
  'instinct',
  'dots',
]);

export function markIdFor(adapterId: string): StoryMarkId | null {
  return MARKS.has(adapterId) ? (adapterId as StoryMarkId) : null;
}

/** The colour a tone takes, or null where it takes the surrounding ink. */
export function markToneHex(mark: StoryMarkId, tone: string): string | null {
  return TONES[mark]?.[tone] ?? harnessMarkTone(mark, tone);
}

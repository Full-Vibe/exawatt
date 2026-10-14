/**
 * The paint for a harness mark (ENG-031 W15g). The registry in
 * `harness-icons.tsx` names a tone for every part of a mark and carries no
 * colour; this is where the study resolves the names, once, for both the 2D
 * glyph in its panels and the 3D mark on its tiles, so the two never
 * disagree. Plain data: nothing here imports three, so the panels do not
 * pull the renderer into the page.
 *
 * `ink` is the surrounding ink, never a tint: Anthropic, OpenAI and xAI
 * forbid recolouring their marks and supply black and white only
 * (LICENSES/brand/harness-marks.md). The exceptions are where the vendor
 * itself supplies a colour: Anthropic draws Claude's mark in its terracotta,
 * and OpenClaw's mascot is coral by its own artwork.
 */

import type { HarnessMarkId } from '@/components/workspace/harness-icons';

/** Study paint for the tones a registry names, per mark. A tone a mark does
 *  not list is `ink`. */
const TONES: Partial<Record<HarnessMarkId, Record<string, string>>> = {
  claude: { brand: '#D97757' },
  openclaw: {
    brand: '#ff4d4d',
    claws: '#f0453e',
    eye: '#050810',
    glint: '#00e5cc',
  },
};

/** Which mark an agent source draws, from the product's adapter id. Marks
 *  the product may not draw (Antigravity, Qwen) and sources that are not
 *  vendors have none. */
const MARKS: ReadonlySet<string> = new Set<HarnessMarkId>([
  'claude',
  'codex',
  'opencode',
  'grok',
  'openclaw',
]);

export function markIdFor(adapterId: string): HarnessMarkId | null {
  return MARKS.has(adapterId) ? (adapterId as HarnessMarkId) : null;
}

/** The colour a tone takes, or null where it takes the surrounding ink. */
export function markToneHex(mark: HarnessMarkId, tone: string): string | null {
  return TONES[mark]?.[tone] ?? null;
}

/**
 * A harness's own brand mark, at chrome size (ENG-031 W10).
 *
 * The operator asked for the identity card to carry "a recognizable harness
 * logo like Claude Code or Codex or Grok or OpenClaw". Exawatt already ships
 * those marks: `src/components/workspace/harness-icons.tsx` has carried them
 * since 2026-07-03, sourced rather than drawn, and the launcher, the Launch
 * Configuration ribbon and Agent Sources settings all render them. So this
 * module SOURCES NOTHING NEW. It is the one adapter between the hero board's
 * declared `adapterId` and the marks the product already draws, which is what
 * keeps a harness looking the same on the marketing board as it does in `⌘T`.
 *
 * ONE NEUTRAL INK, NEVER A TINT, and that is a trademark decision rather than
 * a taste one. Anthropic's guidelines say "no alterations of our trademarks
 * (changes to color, font, proportion, or otherwise) are permitted"; OpenAI's
 * say "DON'T add any colors to the Blossom"; xAI's say to use the logo
 * "without any alteration or adjustment". Every one of those vendors supplies
 * a black and a white rendition, so a single neutral ink on a dark board is
 * the closest available reading of "as provided", and colouring each mark
 * with its source's identity colour is not. The board already carries the
 * source colour: it is the colour of the mark on the board under the `source`
 * lens. `LICENSES/brand/harness-marks.md` carries the full per-mark record,
 * the quoted vendor language, and the remedy.
 *
 * These are third-party trademarks used NOMINATIVELY, to identify the product
 * that runs each Agent. Exawatt claims no affiliation or endorsement.
 *
 * The `adapterId` is `contracts/agent-sources.json`'s own id, carried through
 * `capture.sources`, so a harness that joins the launcher reaches this board
 * as a data edit.
 */
import {
  ClaudeIcon,
  GrokIcon,
  OpenAIIcon,
  OpenClawIcon,
  OpenCodeIcon,
} from '@/components/workspace/harness-icons';

/** Which declared Agent Sources have a brand mark. `demo` deliberately has
 *  none: Demo Mode is Exawatt's own scenario source, not a vendor. */
export function harnessMarkExists(adapterId: string): boolean {
  return (
    adapterId === 'claude' ||
    adapterId === 'codex' ||
    adapterId === 'opencode' ||
    adapterId === 'grok' ||
    adapterId === 'openclaw'
  );
}

export function HarnessMark({
  adapterId,
  size = 16,
}: {
  adapterId: string;
  size?: number;
}) {
  if (adapterId === 'claude') return <ClaudeIcon size={size} />;
  if (adapterId === 'codex') return <OpenAIIcon size={size} />;
  if (adapterId === 'opencode') return <OpenCodeIcon size={size} />;
  if (adapterId === 'grok') return <GrokIcon size={size} />;
  if (adapterId === 'openclaw') return <OpenClawIcon size={size} />;
  return null;
}

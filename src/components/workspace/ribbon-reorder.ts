/**
 * Pointer-based ribbon rearrangement (ENG-016 D42, replacing HTML5 DnD).
 *
 * The interaction model is Chrome's: the REAL chip follows the pointer while
 * its siblings re-target live through the pure layout engine fed a
 * hypothetical order, and releasing settles the chip into its computed slot.
 * This module owns the pure math — where the pointer wants the dragged item
 * to sit, what token order that implies, and how a final order translates
 * into the existing reorder-beside verbs. Grouping stays directory truth:
 * a tab drag can never leave its Project.
 */

import type { RibbonTarget } from './project-ribbon-layout';
import type { RibbonToken } from './project-ribbon-motion';

export const DRAG_THRESHOLD_PX = 4;

export interface SlotCenter {
  id: string;
  x: number;
  y: number;
  row: number;
}

export function slotCenter(target: RibbonTarget): SlotCenter {
  return {
    id: target.id,
    x: target.x + target.width / 2,
    y: target.y,
    row: target.row,
  };
}

/**
 * The insertion index the pointer implies among sibling slots, in reading
 * order (row, then x). A sibling counts as "before" the pointer when its
 * center precedes the pointer's position; crossing a neighbor's midpoint is
 * therefore the exact swap moment, which gives natural hysteresis once the
 * neighbor slides away.
 */
export function dropIndexForPointer(
  siblings: readonly SlotCenter[],
  pointer: { x: number; y: number },
  rowHeight: number
): number {
  const pointerRow = Math.max(0, Math.floor(pointer.y / Math.max(1, rowHeight)));
  let index = 0;
  for (const sibling of siblings) {
    if (
      sibling.row < pointerRow ||
      (sibling.row === pointerRow && sibling.x <= pointer.x)
    ) {
      index += 1;
    }
  }
  return index;
}

/** Reorder one Project's tab tokens so the dragged tab sits at `index`
 *  among its Project siblings. Other Projects' blocks are untouched. */
export function reorderTokensForTabDrag(
  tokens: readonly RibbonToken[],
  tabKey: string,
  index: number
): RibbonToken[] {
  const dragged = tokens.find(token => token.key === tabKey);
  if (!dragged || dragged.kind !== 'tab') return [...tokens];
  const projectDir = dragged.project.dir;
  const siblings = tokens.filter(
    token =>
      token.kind === 'tab' &&
      token.project.dir === projectDir &&
      token.key !== tabKey
  );
  const bounded = Math.max(0, Math.min(index, siblings.length));
  const reordered = [...siblings];
  reordered.splice(bounded, 0, dragged);
  let cursor = 0;
  return tokens.map(token =>
    token.kind === 'tab' && token.project.dir === projectDir
      ? reordered[cursor++]
      : token
  );
}

/** Reorder whole Project blocks (header + its tabs move as one unit). */
export function reorderTokensForProjectDrag(
  tokens: readonly RibbonToken[],
  projectDir: string,
  index: number
): RibbonToken[] {
  const blocks: RibbonToken[][] = [];
  for (const token of tokens) {
    if (token.kind === 'project') blocks.push([token]);
    else blocks[blocks.length - 1]?.push(token);
  }
  const at = blocks.findIndex(
    block => block[0]?.kind === 'project' && block[0].project.dir === projectDir
  );
  if (at === -1) return [...tokens];
  const [dragged] = blocks.splice(at, 1);
  const bounded = Math.max(0, Math.min(index, blocks.length));
  blocks.splice(bounded, 0, dragged);
  return blocks.flat();
}

/**
 * Translate a final order into the existing reorder-beside verb. Returns
 * null when the dragged item did not actually move.
 */
export function placementForOrder(
  originalOrder: readonly string[],
  finalOrder: readonly string[],
  draggedId: string
): { targetId: string; place: 'before' | 'after' } | null {
  if (
    originalOrder.length === finalOrder.length &&
    originalOrder.every((id, at) => id === finalOrder[at])
  ) {
    return null;
  }
  const at = finalOrder.indexOf(draggedId);
  if (at === -1) return null;
  if (at > 0) return { targetId: finalOrder[at - 1], place: 'after' };
  const next = finalOrder[1];
  return next ? { targetId: next, place: 'before' } : null;
}

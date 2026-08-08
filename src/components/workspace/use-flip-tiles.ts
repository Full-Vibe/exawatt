'use client';

/**
 * FLIP position glide for a keyed set of tiles (ENG-015 S6.3).
 *
 * Team re-sorts LIVE (operator, 2026-08-07): an Agent that starts working
 * glides to the front of its Project while you watch. React reorders the
 * DOM instantly, so the glide is First-Last-Invert-Play — measure where
 * each tile was, let layout land it where it now belongs, transform it back
 * to where it was with no transition, then release it to the new position
 * on the next frame.
 *
 * The hook owns POSITION only. Tiles keep their own entrance, selection,
 * and hover transforms on the inner element; the FLIP transform lives on a
 * dedicated wrapper so the two can never fight over one `transform`, and
 * the tile's per-index entrance stagger cannot delay a glide.
 *
 * Timing is the ribbon's motion vocabulary (D45): width snaps, position
 * tweens, `cubic-bezier(0.25, 1, 0.5, 1)`. Reduced motion snaps — a
 * re-sort is a data change, and the crossfade a moving tile would need is
 * exactly the motion the preference declines.
 */
import { useLayoutEffect, useRef } from 'react';

export const FLIP_MOTION_MS = 320;
const FLIP_EASE = 'cubic-bezier(0.25, 1, 0.5, 1)';

export function useFlipTiles(orderKey: string, reducedMotion: boolean) {
  const nodes = useRef(new Map<string, HTMLElement>());
  const rects = useRef(new Map<string, DOMRect>());
  const lastKey = useRef(orderKey);

  const registerFlipNode = (key: string) => (node: HTMLElement | null) => {
    if (node) nodes.current.set(key, node);
    else nodes.current.delete(key);
  };

  useLayoutEffect(() => {
    const orderChanged = lastKey.current !== orderKey;
    lastKey.current = orderKey;
    const next = new Map<string, DOMRect>();
    for (const [key, node] of nodes.current) {
      next.set(key, node.getBoundingClientRect());
    }
    if (orderChanged && !reducedMotion) {
      for (const [key, node] of nodes.current) {
        const before = rects.current.get(key);
        const after = next.get(key);
        if (!before || !after) continue; // entering tiles keep their entrance
        const dx = before.left - after.left;
        const dy = before.top - after.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
        // Invert with no transition, then release on the next frame.
        node.style.transition = 'none';
        node.style.transform = `translate(${dx}px, ${dy}px)`;
        node.style.willChange = 'transform';
        requestAnimationFrame(() => {
          node.style.transition = `transform ${FLIP_MOTION_MS}ms ${FLIP_EASE}`;
          node.style.transform = '';
          window.setTimeout(() => {
            node.style.willChange = '';
            node.style.transition = '';
          }, FLIP_MOTION_MS + 50);
        });
      }
    }
    rects.current = next;
  });

  return registerFlipNode;
}

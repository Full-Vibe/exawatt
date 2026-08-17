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
 *
 * `animate` is both the reduced-motion switch and the readiness gate. While
 * it is false nothing is measured, so a tile has no prior rect to glide
 * FROM — which is what makes the stored sort settle silently on open
 * instead of animating into place, and equally what lets a tile that
 * arrives late keep its entrance. Nothing further is needed to suppress
 * the open-glide, and an extra guard for it was removed once the eval
 * showed it never fired.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';

export const FLIP_MOTION_MS = 320;
const FLIP_EASE = 'cubic-bezier(0.25, 1, 0.5, 1)';

export function useFlipTiles(orderKey: string, animate: boolean) {
  const nodes = useRef(new Map<string, HTMLElement>());
  const rects = useRef(new Map<string, DOMRect>());
  const lastKey = useRef(orderKey);
  // One in-flight glide per tile. A second re-sort arriving mid-glide must
  // cancel the first one's cleanup, or that cleanup strips `transition`
  // partway through the newer animation and the tile snaps — the exact
  // failure the glide exists to avoid, reachable by toggling the sort twice
  // inside 320ms.
  const timers = useRef(new Map<string, number>());

  // One stable callback per tile. A fresh closure each render makes React
  // detach and re-attach every ref on every render — 2N ref calls for no
  // change — so they are cached by key and reused.
  //
  // The cache is NEVER dropped on detach, and that is the whole point of it.
  // Deleting it there inverted the optimisation into its opposite: any
  // single detach — Strict Mode's mount double-invoke is enough, and it
  // happens on every dev mount — evicted the callback, so the next render
  // built a fresh closure, so React detached and re-attached again, forever.
  // Each of those detaches cleared `rects`, and a tile with no prior rect
  // has nothing to glide FROM, so the re-sort silently snapped: the exact
  // regression `eval:workspace:team`'s glide gate exists to catch, arriving
  // through the gate's own blind spot. The map dies with the overlay, and
  // the keys are the tabs open while Team is on screen.
  const callbacks = useRef(
    new Map<string, (node: HTMLElement | null) => void>()
  );
  const registerFlipNode = (key: string) => {
    const existing = callbacks.current.get(key);
    if (existing) return existing;
    const callback = (node: HTMLElement | null) => {
      if (node) nodes.current.set(key, node);
      else {
        nodes.current.delete(key);
        // a tile that really left keeps no stale rect: it re-enters with its
        // entrance, not with a glide from where it used to be
        rects.current.delete(key);
        const timer = timers.current.get(key);
        if (timer !== undefined) {
          window.clearTimeout(timer);
          timers.current.delete(key);
        }
      }
    };
    callbacks.current.set(key, callback);
    return callback;
  };

  useLayoutEffect(() => {
    const orderChanged = lastKey.current !== orderKey;
    lastKey.current = orderKey;
    // Reduced motion never glides, so it never needs the measurement pass
    // either — measuring every tile on every render is a forced layout the
    // preference has already declined.
    if (!animate) return;
    const next = new Map<string, DOMRect>();
    for (const [key, node] of nodes.current) {
      next.set(key, node.getBoundingClientRect());
    }
    if (orderChanged) {
      for (const [key, node] of nodes.current) {
        const before = rects.current.get(key);
        const after = next.get(key);
        if (!before || !after) continue; // entering tiles keep their entrance
        const dx = before.left - after.left;
        const dy = before.top - after.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
        // Invert with no transition, then release on the next frame.
        const pending = timers.current.get(key);
        if (pending !== undefined) window.clearTimeout(pending);
        node.style.transition = 'none';
        node.style.transform = `translate(${dx}px, ${dy}px)`;
        node.style.willChange = 'transform';
        requestAnimationFrame(() => {
          node.style.transition = `transform ${FLIP_MOTION_MS}ms ${FLIP_EASE}`;
          node.style.transform = '';
          timers.current.set(
            key,
            window.setTimeout(() => {
              timers.current.delete(key);
              node.style.willChange = '';
              node.style.transition = '';
            }, FLIP_MOTION_MS + 50)
          );
        });
      }
    }
    rects.current = next;
  });

  // A tile mid-glide when Team closes leaves a live timer pointed at a
  // detached node.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer);
      pending.clear();
    };
  }, []);

  return registerFlipNode;
}

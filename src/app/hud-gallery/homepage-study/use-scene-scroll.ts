'use client';

/**
 * Scene-at-a-time scrolling for the story (ENG-031 W15g, W15h), on three
 * modes the study lets the operator feel:
 *
 * - `off`   the page scrolls as the browser scrolls it.
 * - `soft`  native scroll, and when it stops within a third of a screen of a
 *           frame, a glide to that frame.
 * - `page`  one scene per gesture. A wheel gesture inside the story is taken
 *           and turned into one move (`page-gesture.ts` decides what a
 *           gesture is, `page-curve.ts` shapes the move), arrow, page and
 *           space keys page the same way, and a touch screen gets one native
 *           snap point per frame that it may not skip.
 *
 * Page mode takes the wheel. The shipped homepage's rule is no scroll-jacking
 * (W9, W12: native CSS snap, no wheel handler, no `scrollTo`), and native snap
 * cannot do this: a Mac trackpad's momentum is the system's, and the browser
 * lets it carry the page past the next snap point before it settles. The
 * study is where that trade is felt; it is not a decision for `/`.
 *
 * Everything that is not a plain vertical wheel is left alone: pinch zoom,
 * horizontal swipes, something under the pointer that scrolls itself, any
 * key typed into a field, and the page outside the story.
 */

import { useEffect, type RefObject } from 'react';
import { easeInOutCubic, MOVE_MS, pagedProgress, railMove } from './page-curve';
import { WheelPager } from './page-gesture';
import {
  frameProgress,
  isAtOrPast,
  isBeyond,
  isPinned,
  nearestFrame,
  pinnedFor,
  pinnedAt,
  PIN_TOP,
  progressAt,
  storyTravel,
} from './story-scroll';

export type SnapMode = 'off' | 'soft' | 'page';

/** How long the scroll must be still before it settles on a frame. */
const SETTLE_MS = 180;
/** How far from a frame, in stages, Soft will still pull. */
const SOFT_REACH = 0.3;
/** Closer than this to a frame, in stages, is on it. */
const ON_FRAME = 0.02;
/** A wheel event this soon after the last one, from outside the story, is
 *  the same gesture carrying in. */
const ENTRY_HOLD_MS = 180;

/** Whether something under the pointer scrolls itself in this direction. */
function scrollsItself(target: EventTarget | null, dy: number): boolean {
  let el = target instanceof Element ? target : null;
  while (el && el !== document.documentElement && el !== document.body) {
    if (el.scrollHeight > el.clientHeight + 1) {
      const overflow = getComputedStyle(el).overflowY;
      if (overflow === 'auto' || overflow === 'scroll') {
        const atTop = el.scrollTop <= 0;
        const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
        if ((dy < 0 && !atTop) || (dy > 0 && !atEnd)) return true;
      }
    }
    el = el.parentElement;
  }
  return false;
}

/** Where arrow and page keys belong to the thing that has focus: a field, a
 *  list, a slider. A button or a link does not take them, so a reader who has
 *  just clicked a study control can still page with the keyboard. */
const OWNS_ARROWS =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="slider"], [role="textbox"], [role="listbox"], [role="combobox"], [role="spinbutton"], [role="tablist"], [role="menu"]';
/** Space belongs to anything it can press. */
const OWNS_SPACE = `${OWNS_ARROWS}, button, a[href], summary, [role="button"], [role="tab"], [role="checkbox"], [role="switch"]`;

export function useSceneScroll({
  mode,
  sectionRef,
  stageRef,
  frames,
  reducedMotion,
}: {
  mode: SnapMode;
  sectionRef: RefObject<HTMLElement | null>;
  stageRef: RefObject<HTMLElement | null>;
  /** How many frames (stages) the story has. */
  frames: number;
  reducedMotion: boolean;
}) {
  useEffect(() => {
    if (mode === 'off') return;
    const section = sectionRef.current;
    const stage = stageRef.current;
    if (!section || !stage) return;
    const last = frames - 1;
    const root = document.documentElement;
    const previousSnap = root.style.scrollSnapType;
    const coarse = window.matchMedia('(pointer: coarse)').matches;

    const read = () => {
      const rect = section.getBoundingClientRect();
      const travel = storyTravel(rect.height, stage.offsetHeight);
      const pinned = pinnedAt(rect.top, travel);
      return {
        rect,
        travel,
        pinned,
        progress: progressAt(pinned, travel, last),
      };
    };
    const inStory = () => {
      const { rect, travel } = read();
      return isPinned(rect.top, travel);
    };
    /** The scroll position at which the story rests at a progress. */
    const topFor = (progress: number) => {
      const { rect, travel } = read();
      return (
        rect.top + window.scrollY + pinnedFor(progress, travel, last) - PIN_TOP
      );
    };

    // A touch screen gets the browser's own snap, one point per frame it may
    // not skip; the markers are the experience's. Off while a move runs, or
    // the browser would pull every step of it to the nearest frame.
    const snapOn = () => {
      if (mode === 'page' && coarse)
        root.style.setProperty('scroll-snap-type', 'y mandatory');
    };
    const snapOff = () => root.style.removeProperty('scroll-snap-type');
    snapOn();

    let frame = 0;
    let animating = false;
    const pager = new WheelPager();

    const scrollTop = (top: number) =>
      window.scrollTo({ top, left: 0, behavior: 'instant' });

    /** Run a move along the scroll, shaped by `shape` (tau to a fraction of
     *  the distance), and say when it lands. */
    const run = (
      to: number,
      shape: (tau: number) => number,
      landed?: () => void
    ) => {
      cancelAnimationFrame(frame);
      const from = window.scrollY;
      if (Math.abs(to - from) < 1) {
        animating = false;
        landed?.();
        return;
      }
      if (reducedMotion) {
        scrollTop(to);
        animating = false;
        landed?.();
        return;
      }
      animating = true;
      snapOff();
      const start = performance.now();
      const step = (now: number) => {
        const tau = Math.min(1, (now - start) / MOVE_MS);
        scrollTop(from + (to - from) * shape(tau));
        if (tau < 1) frame = requestAnimationFrame(step);
        else {
          animating = false;
          snapOn();
          landed?.();
        }
      };
      frame = requestAnimationFrame(step);
    };

    /** Go to a frame: along the camera's own curve when it is the next one
     *  over and the scroll is on a frame, otherwise on a plain ease. */
    const goTo = (index: number, landed?: () => void) => {
      const here = read().progress;
      const current = nearestFrame(here, last);
      const onFrame = Math.abs(here - frameProgress(current, last)) < ON_FRAME;
      const to = topFor(frameProgress(index, last));
      if (onFrame && Math.abs(index - current) === 1) {
        const move = railMove(current, index, last);
        const span = move.to - move.from;
        run(to, tau => (pagedProgress(tau, move) - move.from) / span, landed);
      } else run(to, easeInOutCubic, landed);
    };

    // The pager controls the story and the page below it, so a flick up from
    // the footer is the pager's: the browser lets a wheel sequence whose first
    // event it was not asked to cancel carry on natively whatever the rest of
    // its events do, and a flick that began in the footer would coast through
    // every scene on the system's momentum. A gesture that still carries in
    // from above the story (when one is embedded in a longer page) cannot be
    // cancelled for that reason; the pager holds it so it starts no move on
    // top of the page's own, and the scroll settles on a scene when it ends.
    let lastWheel = Number.NEGATIVE_INFINITY;
    let wasInside = false;
    const onWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey) return;
      const { rect, travel, progress } = read();
      const inside = isAtOrPast(rect.top);
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        // A swipe sideways is the browser's (back and forward, a map), unless
        // a gesture of ours is in its tail: an event left alone there would
        // let the rest of the sequence scroll natively under the move.
        if (inside && pager.engaged) event.preventDefault();
        return;
      }
      const dy =
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? window.innerHeight
            : 1);
      if (dy === 0) return;
      const gap = event.timeStamp - lastWheel;
      lastWheel = event.timeStamp;
      if (inside && !wasInside && gap < ENTRY_HOLD_MS)
        pager.hold(event.timeStamp);
      wasInside = inside;
      if (!inside) return;
      if (scrollsItself(event.target, dy)) return;
      const beyond = isBeyond(rect.top, travel);
      const index = beyond ? last : nearestFrame(progress, last);
      const verdict = pager.wheel(dy, event.timeStamp, dir =>
        dir > 0 ? index < last : index > 0
      );
      if (verdict === 'pass') return;
      event.preventDefault();
      if (verdict === 'swallow') return;
      // from the footer, up is the story's last scene, not the one before it
      goTo(beyond ? last : index + (verdict === 'next' ? 1 : -1), () =>
        pager.moveEnded()
      );
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target instanceof Element ? event.target : null;
      const space = event.key === ' ';
      if (target?.closest(space ? OWNS_SPACE : OWNS_ARROWS)) return;
      let dir = 0;
      if (
        event.key === 'ArrowDown' ||
        event.key === 'PageDown' ||
        (space && !event.shiftKey)
      )
        dir = 1;
      else if (
        event.key === 'ArrowUp' ||
        event.key === 'PageUp' ||
        (space && event.shiftKey)
      )
        dir = -1;
      const { rect, travel, progress } = read();
      if (dir === 0 || !isAtOrPast(rect.top)) return;
      const beyond = isBeyond(rect.top, travel);
      const index = beyond ? last : nearestFrame(progress, last);
      // at either end the page carries on natively
      if (dir > 0 ? index >= last : index <= 0) return;
      event.preventDefault();
      if (!animating) goTo(beyond ? last : index + dir);
    };

    // When the scroll stops somewhere that is not a frame (a scrollbar drag,
    // a jump, a restored position), glide to the nearest one.
    let settleTimer = 0;
    const settle = () => {
      if (animating || !inStory()) return;
      const here = read().progress;
      const frameIndex = nearestFrame(here, last);
      const away = Math.abs(here - frameProgress(frameIndex, last));
      if (away < ON_FRAME) return;
      if (mode === 'soft' && away > SOFT_REACH) return;
      goTo(frameIndex);
    };
    const onScroll = () => {
      if (animating) return;
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(settle, SETTLE_MS);
    };

    // The wheel and the keys are taken in Page mode only. A page that holds a
    // non-passive wheel listener makes every wheel event wait for the main
    // thread, which the canvas keeps busy; the other modes keep the browser's
    // own off-thread scroll.
    if (mode === 'page') {
      window.addEventListener('wheel', onWheel, { passive: false });
      window.addEventListener('keydown', onKey);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll);
      if (previousSnap) root.style.scrollSnapType = previousSnap;
      else root.style.removeProperty('scroll-snap-type');
    };
  }, [mode, sectionRef, stageRef, frames, reducedMotion]);
}

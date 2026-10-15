'use client';

/**
 * Scene-at-a-time scrolling for the story (ENG-031 W15g, W15h), on three
 * modes the study lets the operator feel:
 *
 * - `off`   the page scrolls as the browser scrolls it.
 * - `soft`  native scroll, and when it stops, a glide to the nearest frame.
 * - `page`  one scene per gesture. A wheel gesture inside the story is taken
 *           and turned into one move (`page-gesture.ts` decides what a
 *           gesture is, `page-curve.ts` shapes the move), arrow, page and
 *           space keys page the same way, and a finger is taken whole: the
 *           page follows it and glides to a scene when it lifts
 *           (`touch-pager.ts`, W15o; the browser's own snap, which this used
 *           before, bounced, skipped and jerked on an iPhone).
 *
 * Page mode takes the wheel. The band homepage's rule was no scroll-jacking
 * (W9, W12: native CSS snap, no wheel handler, no `scrollTo`), and native snap
 * cannot do this: a Mac trackpad's momentum is the system's, and the browser
 * lets it carry the page past the next snap point before it settles. The
 * operator chose Page for `/` (W15m, 2026-10-14), and keeps Soft in the
 * study to compare.
 *
 * Everything that is not a plain vertical wheel or drag is left alone: pinch
 * zoom, a page zoomed in, horizontal swipes (a sideways drag turns the
 * world), something under the pointer that scrolls itself, a menu or a
 * dialog, any key typed into a field, and the page above the story.
 */

import { useEffect, useRef, type RefObject } from 'react';
import {
  easeInOutCubic,
  MOVE_MS,
  pagedProgress,
  railMove,
  shownProgress,
} from './page-curve';
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
import {
  fingerVelocity,
  nearestStop,
  pageStops,
  releaseGlide,
  releaseStop,
} from './touch-pager';
import {
  setIntent,
  setMoving,
  setPaged,
  type StoryDrive,
} from './visual-contract';

export type SnapMode = 'off' | 'soft' | 'page';

/** How long the scroll must be still before it settles on a frame. */
const SETTLE_MS = 180;
/** Closer than this to a frame, in stages, is on it. */
const ON_FRAME = 0.02;
/** A wheel event this soon after the last one, from outside the story, is
 *  the same gesture carrying in. */
const ENTRY_HOLD_MS = 180;
/** The landing's invitation (W15i): after this long with no input on the
 *  landing, the page leans toward the next scene by itself, as a push
 *  would, and lets go; at most twice, a while apart, and never again once
 *  the reader has touched anything. The delay is the keyswitch study's idle
 *  hint's. */
const HINT_AFTER_MS = 2400;
const HINT_MS = 1500;
const HINT_AGAIN_MS = 7000;
const HINT_REACH = 0.4;
const HINTS = 2;
/** How far a finger travels before its drag is taken as a page or a turn:
 *  the camera rig's own measure, so the two always agree. */
const TOUCH_DECIDE_PX = 8;
/** Finger samples kept for the release speed. */
const FINGER_SAMPLES = 12;

/** Where a finger's gesture belongs to something other than the page: a
 *  menu or a dialog over it, or a page locked under one. */
const OWNS_TOUCH =
  '[role="dialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]';

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
  drive,
}: {
  mode: SnapMode;
  sectionRef: RefObject<HTMLElement | null>;
  stageRef: RefObject<HTMLElement | null>;
  /** How many frames (stages) the story has. */
  frames: number;
  reducedMotion: boolean;
  /** The story drive: Page mode writes how far a gesture has pushed and
   *  which way a move is going, for the camera and the page to show. */
  drive: RefObject<StoryDrive>;
}): RefObject<(index: number) => void> {
  // Go to a scene from outside a gesture (the scene steps): on the camera's
  // own curve when it is the next one over, otherwise a plain glide.
  const goToRef = useRef<(index: number) => void>(() => undefined);
  useEffect(() => {
    const section = sectionRef.current;
    const stage = stageRef.current;
    if (!section || !stage) return;
    const story = drive.current;
    const last = frames - 1;
    const root = document.documentElement;

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

    let frame = 0;
    let animating = false;
    /** Where the move under way is going, for a finger that catches it. */
    let runTo = 0;
    /** What to do if a move is stopped before it lands (a finger catching
     *  it): a wheel move must still let its pager go. */
    let onCancel: (() => void) | undefined;
    /** A finger is on the page: the page is where the finger puts it, and
     *  nothing settles it. */
    let touching = false;
    const pager = new WheelPager();

    // The invitation: a push the page makes itself, shaped like a breath,
    // while the story rests on its landing.
    // A push from the footer goes to the story's last scene, which is not
    // the way a lean from the last scene would point: shown as nothing.
    let pastStory = false;
    let hintsOff = reducedMotion;
    let hintsPlayed = 0;
    let hintAt = performance.now() + HINT_AFTER_MS;
    const landing = frameProgress(0, last);
    const onLanding = () => Math.abs(story.progress - landing) < ON_FRAME;
    const stopHints = () => {
      hintsOff = true;
    };
    const hint = (now: number) => {
      if (hintsOff || animating || !onLanding() || now < hintAt) return 0;
      const t = (now - hintAt) / HINT_MS;
      if (t >= 1) {
        hintsPlayed += 1;
        if (hintsPlayed >= HINTS) hintsOff = true;
        else hintAt = now + HINT_AGAIN_MS;
        return 0;
      }
      const s = Math.sin(Math.PI * t);
      return HINT_REACH * s * s;
    };

    const scrollTop = (top: number) =>
      window.scrollTo({ top, left: 0, behavior: 'instant' });

    /** Stop a move where it is, as a finger catching it does. */
    const cancelRun = () => {
      cancelAnimationFrame(frame);
      setPaged(story, undefined);
      if (!animating) return;
      animating = false;
      const cancelled = onCancel;
      onCancel = undefined;
      cancelled?.();
    };

    /** Run a move along the scroll, shaped by `shape` (tau to a fraction of
     *  the distance) over `duration`, and say when it lands; `cancelled` is
     *  what a move stopped short of landing still owes. `shown` is where the
     *  type that follows the scroll shows the move instead, if not the
     *  scroll itself (tau to story progress). */
    const run = (
      to: number,
      shape: (tau: number) => number,
      landed?: () => void,
      duration = MOVE_MS,
      cancelled?: () => void,
      shown?: (tau: number) => number
    ) => {
      cancelRun();
      const from = window.scrollY;
      if (Math.abs(to - from) < 1 || reducedMotion) {
        if (Math.abs(to - from) >= 0.5) scrollTop(to);
        animating = false;
        landed?.();
        return;
      }
      animating = true;
      runTo = to;
      onCancel = cancelled;
      const start = performance.now();
      if (shown)
        setPaged(story, now =>
          shown(Math.max(0, Math.min(1, (now - start) / duration)))
        );
      const step = (now: number) => {
        const tau = Math.min(1, (now - start) / duration);
        scrollTop(from + (to - from) * shape(tau));
        if (tau < 1) frame = requestAnimationFrame(step);
        else {
          animating = false;
          onCancel = undefined;
          setPaged(story, undefined);
          landed?.();
        }
      };
      frame = requestAnimationFrame(step);
    };

    /** Go to a frame: along the camera's own curve when it is the next one
     *  over and the scroll is on a frame, otherwise on a plain ease. */
    const goTo = (
      index: number,
      landed?: () => void,
      cancelled?: () => void
    ) => {
      const here = read().progress;
      const current = nearestFrame(here, last);
      const onFrame = Math.abs(here - frameProgress(current, last)) < ON_FRAME;
      const to = topFor(frameProgress(index, last));
      if (onFrame && Math.abs(index - current) === 1) {
        const move = railMove(current, index, last);
        const span = move.to - move.from;
        // the camera on its own curve, the type on one ease (W15p)
        run(
          to,
          tau => (pagedProgress(tau, move) - move.from) / span,
          landed,
          MOVE_MS,
          cancelled,
          tau => shownProgress(tau, move)
        );
      } else run(to, easeInOutCubic, landed, MOVE_MS, cancelled);
    };
    // a step pressed while the page moves goes there from where it is
    goToRef.current = index => {
      cancelRun();
      goTo(Math.max(0, Math.min(last, index)));
    };
    if (mode === 'off') {
      return () => {
        cancelAnimationFrame(frame);
        goToRef.current = () => undefined;
        setPaged(story, undefined);
      };
    }

    // A finger, in Page mode (W15o, `touch-pager.ts`). The story takes the
    // whole gesture from its first move: the page follows the finger one to
    // one while it is down, so the scene answers from the first pixel, and
    // when it lifts the page glides to a stop, starting at the finger's own
    // speed. Nothing of the browser's (momentum, the bounce at either end,
    // its snap) ever moves the page under the story. A sideways drag is the
    // camera rig's, which turns the world; the page stays put under it.
    let finger: {
      id: number;
      x: number;
      y: number;
      /** The scroll position the drag moves from. */
      top: number;
      axis: 'none' | 'page' | 'turn';
      /** Where a move this finger caught was going, or null. */
      resume: number | null;
      samples: { t: number; y: number }[];
      /** What the finger went down on: on an iPhone its moves keep going
       *  there even if it leaves the page (the card's step line re-renders
       *  under it), so they are listened for there as well as on the page. */
      target: EventTarget | null;
    } | null = null;
    /** A second finger came down: the browser's pinch. The page settles when
     *  the last finger lifts, never under a pinch. */
    let pinched = false;
    const zoomed = () => (window.visualViewport?.scale ?? 1) > 1.01;
    const maxScroll = () => Math.max(0, root.scrollHeight - window.innerHeight);
    const stopsNow = () => {
      const tops: number[] = [];
      for (let i = 0; i <= last; i += 1)
        tops.push(topFor(frameProgress(i, last)));
      return pageStops(tops, maxScroll(), window.innerHeight);
    };
    /** Glide to a scroll position from the speed the page is going. */
    const glideTo = (to: number, velocity: number) => {
      const glide = releaseGlide(
        to - window.scrollY,
        velocity,
        window.innerHeight
      );
      run(to, glide.ease, undefined, glide.duration);
    };
    const settleSoon = () => {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(settle, SETTLE_MS);
    };
    const ownsTouch = (target: EventTarget | null) => {
      if (document.body.hasAttribute('data-scroll-locked')) return true;
      let el = target instanceof Element ? target : null;
      if (el?.closest(OWNS_TOUCH)) return true;
      // something under the finger that scrolls itself keeps its drag
      while (el && el !== document.documentElement && el !== document.body) {
        if (el.scrollHeight > el.clientHeight + 1) {
          const overflow = getComputedStyle(el).overflowY;
          if (overflow === 'auto' || overflow === 'scroll') return true;
        }
        el = el.parentElement;
      }
      return false;
    };
    // An event reaches both the finger's own element and the page; it is
    // handled once.
    let handled: Event | null = null;
    const listenOn = (target: EventTarget | null, on: boolean) => {
      if (!target || target === window) return;
      const method = on ? 'addEventListener' : 'removeEventListener';
      target[method](
        'touchmove',
        onTouchMove as EventListener,
        {
          passive: false,
        } as AddEventListenerOptions
      );
      target[method](
        'touchend',
        onTouchEnd as EventListener,
        {
          passive: false,
        } as AddEventListenerOptions
      );
      target[method]('touchcancel', onTouchEnd as EventListener);
    };
    const letGo = () => {
      if (finger) listenOn(finger.target, false);
      finger = null;
      touching = false;
    };
    const onTouchStart = (event: TouchEvent) => {
      stopHints();
      // a second finger is a pinch, which is the browser's: the page stays
      // where the first one left it until every finger is up
      if (event.touches.length !== 1) {
        if (finger) letGo();
        pinched = true;
        window.clearTimeout(settleTimer);
        return;
      }
      if (zoomed() || ownsTouch(event.target)) return;
      if (!isAtOrPast(read().rect.top)) return;
      const touch = event.touches[0];
      // a finger catches a move where it is
      const resume = animating ? runTo : null;
      cancelRun();
      finger = {
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        top: window.scrollY,
        axis: 'none',
        resume,
        samples: [],
        target: event.target,
      };
      listenOn(event.target, true);
      touching = true;
    };
    function onTouchMove(event: TouchEvent) {
      if (event === handled) return;
      handled = event;
      if (!finger) return;
      const id = finger.id;
      const touch = Array.from(event.touches).find(t => t.identifier === id);
      if (!touch || event.touches.length !== 1) return;
      // the page never moves under the finger by itself
      if (event.cancelable) event.preventDefault();
      if (finger.axis === 'none') {
        const dx = touch.clientX - finger.x;
        const dy = touch.clientY - finger.y;
        if (Math.hypot(dx, dy) < TOUCH_DECIDE_PX) return;
        finger.axis = Math.abs(dx) > Math.abs(dy) ? 'turn' : 'page';
        // the drag starts here, so the page never jumps by the slop
        finger.y = touch.clientY;
        finger.top = window.scrollY;
      }
      if (finger.axis !== 'page') return;
      finger.samples.push({ t: event.timeStamp, y: touch.clientY });
      if (finger.samples.length > FINGER_SAMPLES) finger.samples.shift();
      scrollTop(
        Math.max(
          0,
          Math.min(maxScroll(), finger.top - (touch.clientY - finger.y))
        )
      );
    }
    function onTouchEnd(event: TouchEvent) {
      if (event === handled) return;
      handled = event;
      // the last finger of a pinch is up: the page may settle again
      if (!finger) {
        if (pinched && event.touches.length === 0) {
          pinched = false;
          if (!zoomed()) settleSoon();
        }
        return;
      }
      const id = finger.id;
      if (!Array.from(event.changedTouches).some(t => t.identifier === id))
        return;
      const gesture = finger;
      letGo();
      if (gesture.axis !== 'page') {
        // a tap or a turn: a move it caught goes on where it was going, and
        // a tap that only stopped the page presses nothing under it
        if (gesture.resume !== null) {
          if (gesture.axis === 'none' && event.cancelable)
            event.preventDefault();
          glideTo(gesture.resume, 0);
        } else settleSoon();
        return;
      }
      // the page's speed is the finger's, the other way up; a cancelled
      // touch (the system took it) lifts without one
      const velocity =
        event.type === 'touchcancel'
          ? 0
          : -fingerVelocity(gesture.samples, event.timeStamp);
      const stops = stopsNow();
      const position = window.scrollY;
      glideTo(
        stops[releaseStop(stops, position, velocity, gesture.top)],
        velocity
      );
    }

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
      stopHints();
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
      pastStory = beyond;
      const index = beyond ? last : nearestFrame(progress, last);
      const verdict = pager.wheel(dy, event.timeStamp, dir =>
        dir > 0 ? index < last : index > 0
      );
      if (verdict === 'pass') return;
      event.preventDefault();
      if (verdict === 'swallow') return;
      // the camera holds whatever lean the push gave it until the move
      // carries it further (`camera-rig.tsx`)
      const dir = verdict === 'next' ? 1 : -1;
      if (!beyond) setMoving(story, dir);
      const ended = () => {
        pager.moveEnded();
        setMoving(story, 0);
      };
      // from the footer, up is the story's last scene, not the one before it
      goTo(beyond ? last : index + dir, ended, ended);
    };

    const onKey = (event: KeyboardEvent) => {
      stopHints();
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
      if (animating || touching || zoomed() || !inStory()) return;
      const here = read().progress;
      const frameIndex = nearestFrame(here, last);
      const away = Math.abs(here - frameProgress(frameIndex, last));
      if (away < ON_FRAME) return;
      goTo(frameIndex);
    };
    const onScroll = () => {
      if (animating || touching || zoomed()) return;
      if (!onLanding()) stopHints();
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
      // a finger's drag is taken from its first move, so that one listener
      // may not be passive; the rest only listen
      window.addEventListener('touchstart', onTouchStart, { passive: true });
      window.addEventListener('touchmove', onTouchMove, { passive: false });
      // a tap that only stops a moving page must not press what is under it
      window.addEventListener('touchend', onTouchEnd, { passive: false });
      window.addEventListener('touchcancel', onTouchEnd, { passive: true });
      // how far a push has got before it pages, for the camera and the page,
      // and the landing's invitation, which is shown the same way
      setIntent(story, now => (pastStory ? 0 : pager.pending(now)) + hint(now));
    } else window.addEventListener('touchstart', stopHints, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pointerdown', stopHints, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      goToRef.current = () => undefined;
      setIntent(story, undefined);
      setMoving(story, 0);
      setPaged(story, undefined);
      window.clearTimeout(settleTimer);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
      letGo();
      window.removeEventListener('touchstart', stopHints);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pointerdown', stopHints);
    };
  }, [mode, sectionRef, stageRef, frames, reducedMotion, drive]);
  return goToRef;
}

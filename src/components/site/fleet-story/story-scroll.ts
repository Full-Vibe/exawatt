/**
 * How the page's scroll becomes the story's progress (ENG-031 W15, W15d).
 * One tall section, one sticky stage inside it; the stage pins under the site
 * header, and the distance it travels while pinned is the whole story. The
 * mapping runs from the end of the first stage's dwell to the start of the
 * last stage's, so the page's first and last pixels of travel already move
 * the scene and nothing is dead scroll. Pure arithmetic, shared by the
 * scroll listener, the paging, and the tests.
 */

import { HEADER_PX } from './narrow';
import { RAIL_DWELL } from './stages';

/** Where the stage pins: under the site header. */
export const PIN_TOP = HEADER_PX;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** The distance the stage is pinned for: the section less one stage. */
export function storyTravel(sectionHeight: number, stageHeight: number) {
  return Math.max(1, sectionHeight - stageHeight);
}

/** How far into the pinned travel the page is, from the section's top edge
 *  in the viewport. Zero before the stage pins, the travel once it unpins. */
export function pinnedAt(sectionTop: number, travel: number) {
  return clamp(PIN_TOP - sectionTop, 0, travel);
}

/** Whether the stage is pinned, or within a pixel of it. */
export function isPinned(sectionTop: number, travel: number) {
  const pinned = PIN_TOP - sectionTop;
  return pinned >= -1 && pinned <= travel + 1;
}

/** The page is at or past the story's first frame: in the story, or in the
 *  page below it. What the pager controls, so that a flick up from the footer
 *  is the pager's and cannot coast through every scene on the browser's own
 *  momentum. */
export function isAtOrPast(sectionTop: number) {
  return PIN_TOP - sectionTop >= -1;
}

/** Past the story's last frame, in the page below it. */
export function isBeyond(sectionTop: number, travel: number) {
  return PIN_TOP - sectionTop > travel + 1;
}

/** Story progress, a stage index plus a fraction, for a pinned distance. */
export function progressAt(pinned: number, travel: number, last: number) {
  return RAIL_DWELL + (pinned / travel) * (last - 2 * RAIL_DWELL);
}

/** The pinned distance at which the story reaches a progress. */
export function pinnedFor(progress: number, travel: number, last: number) {
  return clamp(
    ((progress - RAIL_DWELL) / (last - 2 * RAIL_DWELL)) * travel,
    0,
    travel
  );
}

/** The progress a frame (a stage index) rests at. The first and last frames
 *  rest at the ends of the scroll, which are a dwell short of their index. */
export function frameProgress(index: number, last: number) {
  return clamp(index, RAIL_DWELL, last - RAIL_DWELL);
}

/** The frame nearest a progress. */
export function nearestFrame(progress: number, last: number) {
  return clamp(Math.round(progress), 0, last);
}

/**
 * How far the scroll has gone from the frame it is nearest, as a share of
 * the hold around that frame, -1 to 1 (W15l). Around every frame the story
 * holds the scene still for a quarter of a screen; this is how far into
 * that hold the scroll has gone, so the page can answer the finger from its
 * first pixel (a lean toward the next scene, the type following) instead of
 * an inch and a half of nothing (operator 2026-10-14: "I have to move my
 * finger a good inch and a half, maybe two inches, before the bar at the
 * top... even begins responding"). Past the hold it stays at its end, where
 * the move itself has taken over. It turns round in the middle of a move,
 * where the nearest frame changes; the camera's lean is past by then and
 * both scenes' type is faded out, so nothing shows it. (W15o tried reading
 * it from the frame the scroll set out from instead, and the camera then
 * leaned out of the scene it was arriving at and swung back after landing.)
 * The scene steps do not read it: they show the scroll itself
 * (`frameCoord`).
 */
export function scrollIntent(progress: number, last: number): number {
  const frame = frameProgress(nearestFrame(progress, last), last);
  return clamp((progress - frame) / RAIL_DWELL, -1, 1);
}

/**
 * Where the scroll is in scenes, linear between the scroll positions the
 * frames rest at: 1.5 is halfway from the second scene to the third. What
 * the scene steps show (W15o): the scroll itself, so they move one way
 * under one-way movement and never wait out a hold.
 */
export function frameCoord(progress: number, last: number): number {
  if (progress <= frameProgress(0, last)) return 0;
  for (let i = 0; i < last; i += 1) {
    const from = frameProgress(i, last);
    const to = frameProgress(i + 1, last);
    if (progress <= to) return i + (progress - from) / (to - from);
  }
  return last;
}

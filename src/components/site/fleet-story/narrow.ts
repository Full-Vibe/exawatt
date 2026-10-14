/**
 * The study's one measure of "narrow" (ENG-031 W15h). The camera frames the
 * world differently on a phone, the reading column moves to the foot of the
 * stage, and the open panel docks differently; all three must agree, or text
 * and subject collide in the band of window shapes where they would not. A
 * viewport is narrow when it is portrait, which is exactly what the CSS
 * `portrait:` variant tests; the stage is the viewport less the site header,
 * so the stage test is the same comparison with the header added back.
 */

/** The site header the stage pins under: `top-12`. */
export const HEADER_PX = 48;

/** Narrow for a stage of this size under the site header. */
export function isNarrow(
  stageWidth: number,
  stageHeight: number,
  slack = HEADER_PX
): boolean {
  return stageWidth <= stageHeight + slack;
}

/**
 * A stage too short for the full agent card beside its type (W15o): a phone
 * held sideways, a short browser window. There the card in the reading column
 * steps aside and an open agent is the compact card pinned to the stage, as
 * on a phone, and the Project names keep to the scenes inside one Project.
 */
const SHORT_BELOW = 520;

export function isShort(stageHeight: number): boolean {
  return stageHeight < SHORT_BELOW;
}

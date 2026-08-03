/**
 * Natural width — what a chip WANTS to be, measured in a way that cannot
 * echo what the layout engine already told it to be (ENG-016 D45).
 *
 * The ribbon assigns every chip an explicit width so titles truncate
 * instead of overflowing. That makes the obvious measurement — read the
 * element's box — a closed loop: the engine hands the DOM a width, the DOM
 * hands the same number back, and the "measurement" silently degrades into
 * an echo of whatever estimate seeded it. A Project name past the estimate
 * then truncates permanently with nothing able to correct it, and the bug
 * is invisible because the numbers all look plausible.
 *
 * So natural width is built from PARTS that are content-sized by
 * construction:
 *
 *   - the container's own padding and gaps (style, not layout output)
 *   - each sibling of the flexible element (icons and badges: intrinsic)
 *   - the flexible element's `scrollWidth`, which is its untruncated
 *     content width regardless of the box it was given
 *
 * Nothing here reads the container's assigned box, so the result is a true
 * lower bound on "wide enough to show everything".
 */

/**
 * @param container the chip's inner chrome — the flex row being measured
 * @param flexible  the child that truncates (a label); its `scrollWidth`
 *                  supplies the untruncated content width
 * @param extra     borders or anything outside the container's box model
 */
export function naturalContentWidth(
  container: HTMLElement,
  flexible: HTMLElement | null,
  extra = 0
): number | null {
  if (!flexible || !container.isConnected) return null;
  const style = getComputedStyle(container);
  const gap = Number.parseFloat(style.columnGap || '0') || 0;
  const children = Array.from(container.children) as HTMLElement[];
  if (children.length === 0) return null;
  const siblings = children.reduce(
    (total, child) =>
      total +
      (child === flexible ? 0 : child.getBoundingClientRect().width),
    0
  );
  const width =
    (Number.parseFloat(style.paddingLeft) || 0) +
    (Number.parseFloat(style.paddingRight) || 0) +
    gap * Math.max(0, children.length - 1) +
    siblings +
    // `scrollWidth` is an INTEGER: a label whose text is really 50.4px wide
    // reports 50, so sizing the chip to it hands the text 50px and the
    // renderer draws an ellipsis the content did not need. Every Project
    // name in the ribbon was quietly truncating by a fraction of a pixel.
    // Reserve the rounding.
    flexible.scrollWidth +
    1 +
    extra;
  return width > extra ? Math.ceil(width) : null;
}

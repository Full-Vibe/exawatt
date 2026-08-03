import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { naturalContentWidth } from './natural-width';

const realGetComputedStyle = globalThis.getComputedStyle;

beforeEach(() => {
  globalThis.getComputedStyle = (() => ({
    columnGap: '4px',
    paddingLeft: '6px',
    paddingRight: '6px',
  })) as unknown as typeof globalThis.getComputedStyle;
});
afterEach(() => {
  globalThis.getComputedStyle = realGetComputedStyle;
});

const el = (width: number, scrollWidth = width) =>
  ({
    scrollWidth,
    isConnected: true,
    getBoundingClientRect: () => ({ width }),
  }) as unknown as HTMLElement;

/** A flex row whose BOX is deliberately unrelated to its content — exactly
 *  the situation the ribbon creates by assigning every chip a width. */
function chip({
  assigned,
  labelText,
  labelBox,
  siblings,
}: {
  assigned: number;
  labelText: number;
  labelBox: number;
  siblings: number[];
}) {
  const label = el(labelBox, labelText);
  const children = [...siblings.map(width => el(width)), label];
  const container = {
    isConnected: true,
    children,
    getBoundingClientRect: () => ({ width: assigned }),
  } as unknown as HTMLElement;
  return { container, label };
}

describe('naturalContentWidth', () => {
  it('is independent of the width the engine assigned', () => {
    // The invariant that makes this a measurement rather than an echo:
    // same content, wildly different assigned boxes, identical answer.
    const narrow = chip({
      assigned: 40,
      labelText: 90,
      labelBox: 20,
      siblings: [10, 12],
    });
    const wide = chip({
      assigned: 400,
      labelText: 90,
      labelBox: 300,
      siblings: [10, 12],
    });
    expect(naturalContentWidth(narrow.container, narrow.label, 2)).toBe(
      naturalContentWidth(wide.container, wide.label, 2)
    );
  });

  it('sums padding, gaps, intrinsic siblings and the untruncated label', () => {
    const c = chip({
      assigned: 999,
      labelText: 90,
      labelBox: 10,
      siblings: [10, 12],
    });
    // 6 + 6 padding, three children so two 4px gaps, siblings 10 + 12,
    // label 90 untruncated, plus 2 for the chip's borders
    expect(naturalContentWidth(c.container, c.label, 2)).toBe(
      6 + 6 + 8 + 22 + 90 + 2
    );
  });

  it('grows with the content, so a longer name can always fit', () => {
    const short = chip({
      assigned: 120,
      labelText: 40,
      labelBox: 40,
      siblings: [10],
    });
    const long = chip({
      assigned: 120,
      labelText: 400,
      labelBox: 40,
      siblings: [10],
    });
    expect(naturalContentWidth(long.container, long.label, 2)).toBeGreaterThan(
      naturalContentWidth(short.container, short.label, 2)!
    );
  });

  it('returns null when there is nothing measurable', () => {
    const c = chip({ assigned: 100, labelText: 0, labelBox: 0, siblings: [] });
    expect(naturalContentWidth(c.container, null, 2)).toBeNull();
  });
});

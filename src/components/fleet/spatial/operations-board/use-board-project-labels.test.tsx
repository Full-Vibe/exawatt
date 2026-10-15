import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ZONE_LABEL_TIER_POLICY } from './operations-board-label-tier';
import { useBoardProjectLabels } from './use-board-project-labels';

const zone = (width: number) => ({
  rect: { x: 0, y: 0, width, height: width },
});
describe('shared Project label sizing', () => {
  it('uses the actual minimum width, including Projects wider than the empty-board fallback', () => {
    const width = 40;
    const { result, rerender } = renderHook(
      ({ zones }) => useBoardProjectLabels(zones),
      { initialProps: { zones: [zone(width), zone(width * 2)] } }
    );
    const store = result.current.store;
    act(() =>
      result.current.onZoomChange(
        (ZONE_LABEL_TIER_POLICY.fullAbovePx + 1) / width
      )
    );
    expect(store.get()).toBe('full');
    rerender({ zones: [zone(width / 2), zone(width * 2)] });
    expect(result.current.store).toBe(store);
    expect(store.get()).toBe('compact');
    rerender({ zones: [] });
    expect(store.get()).toBe('compact');
  });
});

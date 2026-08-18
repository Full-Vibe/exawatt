import { describe, expect, it } from 'vitest';
import {
  ZONE_LABEL_TIER_POLICY,
  createZoneLabelTierStore,
  nextZoneLabelTier,
} from './operations-board-label-tier';

describe('zone label tier', () => {
  it('holds its tier inside the hysteresis band', () => {
    // Between the two thresholds the tier keeps whatever it was, so a camera
    // resting near the boundary never flickers.
    const mid =
      (ZONE_LABEL_TIER_POLICY.compactBelowPx + ZONE_LABEL_TIER_POLICY.fullAbovePx) /
      2;
    expect(nextZoneLabelTier('full', mid)).toBe('full');
    expect(nextZoneLabelTier('compact', mid)).toBe('compact');
  });

  it('flips only past the far threshold in each direction', () => {
    expect(nextZoneLabelTier('full', ZONE_LABEL_TIER_POLICY.compactBelowPx - 1)).toBe('compact');
    expect(nextZoneLabelTier('compact', ZONE_LABEL_TIER_POLICY.fullAbovePx + 1)).toBe('full');
    expect(nextZoneLabelTier('full', ZONE_LABEL_TIER_POLICY.compactBelowPx)).toBe('full');
    expect(nextZoneLabelTier('compact', ZONE_LABEL_TIER_POLICY.fullAbovePx)).toBe('compact');
  });

  it('notifies subscribers only when the tier actually changes', () => {
    // The rig writes zoom every frame of every flight. If each write notified,
    // the labels would re-render per frame -- the cost this store exists to
    // remove.
    const store = createZoneLabelTierStore('full');
    store.setZoom(30);
    store.setMinZoneWidth(20); // 600px, still full
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    for (let zoom = 30; zoom >= 12; zoom -= 0.5) store.setZoom(zoom); // 600px -> 240px
    expect(store.get()).toBe('compact');
    expect(notified).toBe(1);
    for (let zoom = 12; zoom < 30; zoom += 0.5) store.setZoom(zoom);
    expect(store.get()).toBe('full');
    expect(notified).toBe(2);
  });

  it('re-evaluates when the smallest zone changes width', () => {
    const store = createZoneLabelTierStore('full');
    store.setZoom(10);
    store.setMinZoneWidth(20); // 200px -> compact
    expect(store.get()).toBe('compact');
    store.setMinZoneWidth(40); // 400px -> full
    expect(store.get()).toBe('full');
  });
});

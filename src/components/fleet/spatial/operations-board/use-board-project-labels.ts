'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SpatialBoardProjectZone } from '@exawatt/ui-model';
import { createZoneLabelTierStore } from './operations-board-label-tier';

/** Both views measure the same Project footprint. The empty-board fallback
 * is not a cap: large Projects retain their names at their actual zoom. */
export function useBoardProjectLabels(
  zones: readonly Pick<SpatialBoardProjectZone, 'rect'>[]
) {
  const [store] = useState(() => createZoneLabelTierStore('full'));
  const width = zones.length
    ? zones.reduce(
        (minimum, zone) => Math.min(minimum, zone.rect.width),
        Infinity
      )
    : 24;
  useEffect(() => store.setMinZoneWidth(width), [store, width]);
  const onZoomChange = useCallback(
    (zoom: number) => store.setZoom(zoom),
    [store]
  );
  return { store, onZoomChange };
}

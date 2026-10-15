'use client';

import { lazy, type ComponentType, type ComponentProps } from 'react';
import type { FleetView, FleetMaterial } from '@exawatt/core/desktop-bridge';
import type { SpatialBoardProjection } from '@exawatt/ui-model';
import type { OperationsBoardCanvas } from './operations-board-canvas';

type BoardViewProps = ComponentProps<typeof OperationsBoardCanvas> & {
  material?: FleetMaterial;
  sourceMarks?: Readonly<Record<string, string>>;
};

interface BoardView {
  id: FleetView;
  Canvas: ComponentType<BoardViewProps>;
  projections: readonly SpatialBoardProjection[];
}

// Only this registry chooses a renderer. Neither renderer reads preferences,
// and a v1 visit never imports the tile renderer or its material implementation.
const VIEWS: Record<FleetView, BoardView> = {
  v1: {
    id: 'v1',
    Canvas: lazy(() =>
      import('./operations-board-canvas').then(module => ({
        default: module.OperationsBoardCanvas,
      }))
    ),
    projections: ['top-down', 'fixed-angle'],
  },
  v2: {
    id: 'v2',
    Canvas: lazy(() =>
      import('./tiles/operations-board-tiles-canvas').then(module => ({
        default: module.OperationsBoardTilesCanvas,
      }))
    ),
    projections: ['fixed-angle'],
  },
};

export function boardViewFor(view: FleetView): BoardView {
  return VIEWS[view];
}

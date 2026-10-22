'use client';
import type { ComponentProps } from 'react';
import type { CrustMaterialId } from '@/components/tiles/crust-materials';
import type { OperationsBoardCanvas } from '../operations-board-canvas';
export type BoardTileMaterial = CrustMaterialId;
export type BoardCameraPreset = 'perspective' | 'low' | 'overhead';
export type OperationsBoardTilesProps = ComponentProps<
  typeof OperationsBoardCanvas
> & {
  material?: BoardTileMaterial;
  greybox?: boolean;
  sourceMarks?: Readonly<Record<string, string>>;
  cameraPreset?: BoardCameraPreset;
  recenterToken?: number;
};
export { LatticeCanvas as OperationsBoardTilesCanvas } from './board-lattice-canvas';

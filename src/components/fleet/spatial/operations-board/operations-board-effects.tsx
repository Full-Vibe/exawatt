'use client';

import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import type { SpatialThemeSnapshot } from '../spatial-theme';

/**
 * Postprocessing for the Operations Board (ENG-004 V2.4). Heaviest import in
 * the spatial bundle — loaded lazily and gated by low-power mode. The high
 * luminance threshold keeps zone plates, grid, and DOM chrome crisp; only the
 * emissive status cores and accent edges (toneMapped={false}) bloom.
 */
export default function OperationsBoardEffects({
  bloom,
}: {
  bloom: SpatialThemeSnapshot['bloom'];
}) {
  return (
    <EffectComposer multisampling={4}>
      <Bloom
        luminanceThreshold={bloom.threshold}
        luminanceSmoothing={0.24}
        intensity={bloom.strength}
        radius={bloom.radius}
        mipmapBlur
      />
      <Vignette offset={0.26} darkness={0.44} />
    </EffectComposer>
  );
}

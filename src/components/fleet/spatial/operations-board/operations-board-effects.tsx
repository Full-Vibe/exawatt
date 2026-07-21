'use client';

import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';

/**
 * Postprocessing for the Operations Board (ENG-004 V2.4). Heaviest import in
 * the spatial bundle — loaded lazily and gated by low-power mode. The high
 * luminance threshold keeps zone plates, grid, and DOM chrome crisp; only the
 * emissive status cores and accent edges (toneMapped={false}) bloom.
 */
export default function OperationsBoardEffects() {
  return (
    <EffectComposer multisampling={4}>
      <Bloom
        luminanceThreshold={0.62}
        luminanceSmoothing={0.24}
        intensity={0.5}
        radius={0.6}
        mipmapBlur
      />
      <Vignette offset={0.26} darkness={0.44} />
    </EffectComposer>
  );
}

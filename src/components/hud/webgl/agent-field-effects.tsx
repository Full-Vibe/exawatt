import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';

/** Heavy postprocessing boundary — imported lazily and omitted on low power. */
export function AgentFieldEffects() {
  return (
    <EffectComposer>
      <Bloom
        luminanceThreshold={0.64}
        luminanceSmoothing={0.2}
        intensity={0.72}
        radius={0.5}
        mipmapBlur
      />
      <Vignette eskil={false} offset={0.3} darkness={0.52} />
    </EffectComposer>
  );
}

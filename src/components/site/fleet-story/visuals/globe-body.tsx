'use client';

/**
 * The dark globe under every option (ENG-031 W15): a matte sphere plus a
 * faint graticule, so even a one-agent slice reads as a piece of something
 * round. Decorative: never raycast.
 */

import { SPHERE_CENTER, SPHERE_RADIUS } from '../sphere';
import type { Palette } from './shared';

export function GlobeBody({
  palette,
  graticule = 0.1,
}: {
  palette: Palette;
  graticule?: number;
}) {
  return (
    <>
      <mesh position={SPHERE_CENTER} raycast={() => null}>
        <sphereGeometry args={[SPHERE_RADIUS - 0.25, 96, 64]} />
        <meshStandardMaterial
          color={palette.body}
          roughness={0.95}
          metalness={0.05}
        />
      </mesh>
      {graticule > 0 ? (
        <mesh position={SPHERE_CENTER} raycast={() => null}>
          <sphereGeometry args={[SPHERE_RADIUS - 0.2, 48, 32]} />
          <meshBasicMaterial
            color={palette.grid}
            wireframe
            transparent
            opacity={graticule}
            depthWrite={false}
          />
        </mesh>
      ) : null}
    </>
  );
}

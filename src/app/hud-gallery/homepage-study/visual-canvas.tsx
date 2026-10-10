'use client';

/**
 * The one canvas (ENG-031 W15). Client-only chunk; the page's HTML never
 * carries a WebGL context. Switching the visual option remounts the scene
 * under the same canvas; the story drive and anchors are the parent's refs,
 * so the switch keeps the reader's place.
 */

import { Canvas } from '@react-three/fiber';
import type { RefObject } from 'react';
import type { SpatialThemeSnapshot } from '@/components/fleet/spatial/spatial-theme';
import type { FleetModel } from './fleet-model';
import type { StoryDrive, VisualAnchor, VisualId } from './visual-contract';
import type { CrustMaterialId } from './visuals/crust-materials';
import type { CrustSignalId } from './visuals/crust-signal';
import type { EnvironmentKind } from './visuals/environment';
import { CrustVisual } from './visuals/crust-visual';
import { DomeVisual } from './visuals/dome-visual';
import { LidarVisual } from './visuals/lidar-visual';
import { MercuryVisual } from './visuals/mercury-visual';
import { PrismVisual } from './visuals/prism-visual';

export function VisualCanvas({
  visual,
  model,
  theme,
  drive,
  anchor,
  reducedMotion,
  visible,
  material,
  marks,
  signal,
  light,
  closeUp,
  onExpand,
  onHoverChange,
}: {
  visual: VisualId;
  material: CrustMaterialId;
  marks: boolean;
  signal: CrustSignalId;
  light?: EnvironmentKind;
  closeUp?: boolean;
  model: FleetModel;
  theme: SpatialThemeSnapshot;
  drive: RefObject<StoryDrive>;
  anchor: VisualAnchor;
  reducedMotion: boolean;
  visible: boolean;
  onExpand?: () => void;
  onHoverChange: (agent: number) => void;
}) {
  const VISUAL_COMPONENTS = {
    crust: CrustVisual,
    lidar: LidarVisual,
    dome: DomeVisual,
    prism: PrismVisual,
    mercury: MercuryVisual,
  } as const;
  const Visual = VISUAL_COMPONENTS[visual];
  return (
    <Canvas
      className="absolute inset-0"
      style={{ position: 'absolute' }}
      frameloop={visible ? 'always' : 'never'}
      dpr={[1, 1.5]}
      camera={{ fov: 42, near: 0.5, far: 400, position: [0, 30, 40] }}
      gl={{
        antialias: true,
        powerPreference: 'high-performance',
        alpha: false,
      }}
      aria-hidden
    >
      <Visual
        key={`${visual}-${material}`}
        model={model}
        material={material}
        marks={marks}
        signal={signal}
        light={light}
        closeUp={closeUp}
        theme={theme}
        drive={drive}
        anchor={anchor}
        reducedMotion={reducedMotion}
        onExpand={onExpand}
        onHoverChange={onHoverChange}
      />
    </Canvas>
  );
}

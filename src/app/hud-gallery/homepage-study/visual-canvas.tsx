'use client';

/**
 * The one canvas (ENG-031 W15). Client-only chunk; the page's HTML never
 * carries a WebGL context. The camera rig lives here, above the visual, so
 * switching the visual or the material swaps what is drawn in place and
 * never restarts the camera (operator 2026-10-12: "changing visuals should
 * just swap the agent types in place"). The story drive and anchors are the
 * parent's refs, so the switch keeps the reader's place too.
 */

import { Canvas } from '@react-three/fiber';
import { useRef, type RefObject } from 'react';
import type { SpatialThemeSnapshot } from '@/components/fleet/spatial/spatial-theme';
import type { FleetModel } from './fleet-model';
import type { NamesId } from './names';
import type { StoryDrive, VisualAnchor, VisualId } from './visual-contract';
import { CameraRig } from './visuals/camera-rig';
import type { CrustMarkId } from './visuals/crust-marks';
import type { CrustMaterialId } from './visuals/crust-materials';
import type { CrustMotion } from './visuals/crust-motion';
import type { CrustShapeId } from './visuals/crust-shape';
import type { CrustSignalId } from './visuals/crust-signal';
import type { EnvironmentKind } from './visuals/environment';
import { CrustVisual } from './visuals/crust-visual';
import { DomeVisual } from './visuals/dome-visual';
import { LidarVisual } from './visuals/lidar-visual';
import { MercuryVisual } from './visuals/mercury-visual';
import { PrismVisual } from './visuals/prism-visual';

const VISUAL_COMPONENTS = {
  crust: CrustVisual,
  lidar: LidarVisual,
  dome: DomeVisual,
  prism: PrismVisual,
  mercury: MercuryVisual,
} as const;

export function VisualCanvas({
  visual,
  model,
  theme,
  drive,
  anchor,
  reducedMotion,
  visible,
  material,
  mark,
  shape,
  motion,
  signal,
  light,
  closeUp,
  onExpand,
  expandable,
  sound,
  names,
  onHoverChange,
  onSelect,
}: {
  visual: VisualId;
  material: CrustMaterialId;
  mark: CrustMarkId;
  shape: CrustShapeId;
  motion: CrustMotion;
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
  expandable?: boolean;
  sound?: boolean;
  names?: NamesId;
  onHoverChange: (agent: number) => void;
  onSelect: (agent: number) => void;
}) {
  const Visual = VISUAL_COMPONENTS[visual];
  const shownRef = useRef(1);
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
      <CameraRig
        model={model}
        drive={drive}
        reducedMotion={reducedMotion}
        shownRef={shownRef}
        closeUp={closeUp}
      />
      <Visual
        key={visual}
        model={model}
        shownRef={shownRef}
        material={material}
        mark={mark}
        shape={shape}
        motion={motion}
        signal={signal}
        light={light}
        closeUp={closeUp}
        theme={theme}
        drive={drive}
        anchor={anchor}
        reducedMotion={reducedMotion}
        onExpand={onExpand}
        expandable={expandable}
        sound={sound}
        names={names}
        onHoverChange={onHoverChange}
        onSelect={onSelect}
      />
    </Canvas>
  );
}

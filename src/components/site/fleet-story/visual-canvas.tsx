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
import { useRef, type ComponentType, type RefObject } from 'react';
import type { SpatialThemeSnapshot } from '@/components/fleet/spatial/spatial-theme';
import type { FleetModel } from './fleet-model';
import type { NamesId } from './names';
import type { PressSoundSetting } from '@/components/tiles/press-sounds';
import type { StoryDrive, VisualAnchor, VisualProps } from './visual-contract';
import { CameraRig } from './visuals/camera-rig';
import type { CrustMarkId } from './visuals/crust-marks';
import type { CrustMaterialId } from '@/components/tiles/crust-materials';
import type { CrustMotion } from '@/components/tiles/crust-motion';
import type { CrustShapeId } from '@/components/tiles/crust-shape';
import type { CrustSignalId } from '@/components/tiles/crust-signal';
import type { EnvironmentKind } from '@/components/tiles/environment';
import { CrustVisual } from './visuals/crust-visual';
import { useHostRenderPolicy } from '@/lib/host-power/use-host-render-policy';

export function VisualCanvas({
  Visual = CrustVisual,
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
  /** What draws the fleet: Crust, unless the study swaps in a candidate. A
   *  different visual is a different component, so it mounts fresh while
   *  the camera above it keeps its place. */
  Visual?: ComponentType<VisualProps>;
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
  sound?: PressSoundSetting;
  names?: NamesId;
  onHoverChange: (agent: number) => void;
  onSelect: (agent: number) => void;
}) {
  const shownRef = useRef(1);
  // The story keeps its own continuous loop; it reads the same visibility,
  // lock and sleep facts as every other canvas to decide whether to run it.
  const { renderAllowed } = useHostRenderPolicy();
  return (
    <Canvas
      className="absolute inset-0"
      style={{ position: 'absolute' }}
      frameloop={visible && renderAllowed ? 'always' : 'never'}
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

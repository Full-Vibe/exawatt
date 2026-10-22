'use client';

import { Canvas, useThree } from '@react-three/fiber';
import { CameraControls, Html, Line } from '@react-three/drei';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box3,
  Vector3,
  type WebGLRenderer,
  type Scene,
  type Camera,
} from 'three';
import type { OperationsBoardTilesProps } from '@/components/fleet/spatial/operations-board/tiles/operations-board-tiles-canvas';
import { BoardDisplayResolution } from '@/components/fleet/spatial/operations-board/operations-board-canvas';
import {
  spatialProjectIdentityColor,
  spatialColorWithAlpha,
} from '@/components/fleet/spatial/spatial-theme';
import {
  useLowPowerMode,
  useReducedMotion,
} from '@/components/fleet/spatial/operations-board/operations-board-env';
import {
  createAmbientFrameScheduler,
  resolveAmbientCadence,
  type AmbientMotion,
} from '@/components/fleet/spatial/operations-board/operations-board-ambient';
import { useHostRenderPolicy } from '@/lib/host-power/use-host-render-policy';
import { TileRenderer } from '@/components/tiles/tile-renderer';
import type { TileFrame } from '@/components/tiles/tile-contract';
import { DEFAULT_MOTION } from '@/components/tiles/crust-motion';
import { HARNESS_MARK_PATHS } from '@/components/workspace/harness-icons';
import { harnessMarkTone } from '@/components/workspace/harness-mark-tones';
import { qualityModel } from './model';

const MARKS = { paths: HARNESS_MARK_PATHS, tone: harnessMarkTone };
const EMPTY = new Set<string>();
const STILL = {
  sheen: false,
  breathe: false,
  wander: false,
  pulse: false,
  spin: false,
  lift: 'still',
} as const;
const GROUND_FRAME: TileFrame = {
  focusId: null,
  selection: EMPTY,
  tileAgent: () => false,
};
const readGround = () => GROUND_FRAME;
const readClock = () => performance.now() / 1000;
export type QualityCamera = 'perspective' | 'low' | 'overhead';
type QualityProps = OperationsBoardTilesProps & {
  cameraPreset?: QualityCamera;
  recenterToken?: number;
};

/** Review-only native XZ composition; the production board remains unchanged. */
export function QualityCanvas(props: QualityProps) {
  const reduced = useReducedMotion();
  const lowPower = useLowPowerMode();
  const host = useHostRenderPolicy();
  const cadence = resolveAmbientCadence({
    reduced,
    lowPower,
    visible: host.ambientAllowed,
    onBattery: host.onBattery,
  });
  const [scheduler] = useState(createAmbientFrameScheduler);
  useEffect(() => () => scheduler.dispose(), [scheduler]);
  const ambient = useMemo<AmbientMotion>(
    () => ({
      cadence,
      requestFrame: invalidate => scheduler.request(cadence, invalidate),
    }),
    [cadence, scheduler]
  );
  return (
    <Canvas
      frameloop={host.renderAllowed ? 'demand' : 'never'}
      dpr={[1, 2]}
      camera={{ position: [0, 30, 30], fov: 38, near: 0.1, far: 2000 }}
      gl={{
        antialias: true,
        preserveDrawingBuffer: props.preserveDrawingBuffer,
      }}
      style={{ touchAction: 'none' }}
      data-board-view="quality-study"
      data-board-material={props.material}
      onPointerMissed={props.onBackground}
      onCreated={({ gl, scene, camera }) => {
        // Hide only WebGL pixels; Html's sibling command targets stay accessible.
        gl.domElement.setAttribute('aria-hidden', 'true');
        (
          gl.domElement as HTMLCanvasElement & {
            boardEvidence: { gl: WebGLRenderer; scene: Scene; camera: Camera };
          }
        ).boardEvidence = { gl, scene, camera };
      }}
    >
      <color attach="background" args={[props.theme.canvas]} />
      <BoardDisplayResolution lowPower={lowPower} />
      <QualityScene
        {...props}
        reduced={reduced}
        ambient={ambient}
        transmission={
          !lowPower && !host.onBattery && !props.theme.reducedTransparency
        }
      />
    </Canvas>
  );
}

function QualityScene({
  layout,
  theme,
  material = 'gummy',
  sourceMarks = {},
  onDrillProject,
  onSelectAgent,
  onSelectDelegationChild,
  multiSelection,
  reduced,
  ambient,
  transmission,
  cameraPreset = 'perspective',
  recenterToken = 0,
}: QualityProps & {
  reduced: boolean;
  ambient: AmbientMotion;
  transmission: boolean;
}) {
  const invalidate = useThree(state => state.invalidate);
  const size = useThree(state => state.size);
  const camera = useThree(state => state.camera);
  const gl = useThree(state => state.gl);
  const controls = useRef<CameraControls>(null);
  const model = useMemo(
    () => qualityModel(layout, sourceMarks),
    [layout, sourceMarks]
  );
  const groundTheme = useMemo(
    () => ({ ...theme, zone: theme.zoneHover, grid: theme.gridMajor }),
    [theme]
  );
  const agentIds = useMemo(
    () =>
      new Set(model.tiles.filter(tile => tile.agentId).map(tile => tile.id)),
    [model]
  );
  const frame = useMemo<TileFrame>(
    () => ({
      focusId: null,
      selection: multiSelection ?? EMPTY,
      tileAgent: id => agentIds.has(id),
    }),
    [multiSelection, agentIds]
  );
  const readFrame = useCallback(() => frame, [frame]);
  const onMotionFrame = useCallback(
    (settling: boolean, working: boolean) => {
      if (settling || working) ambient.requestFrame(invalidate);
    },
    [ambient, invalidate]
  );
  useEffect(() => invalidate(), [invalidate, theme, ambient, frame, model]);
  useEffect(() => {
    const rig = controls.current;
    if (!rig) return;
    const { x, y, width, height } = model.bounds;
    const box = new Box3(
      new Vector3(x - 1, -0.3, y - 2),
      new Vector3(x + width + 1, 1, y + height + 1)
    );
    // Measure the box in the selected camera basis, then let CameraControls
    // solve its frustum fit. Fitting overhead before tilting clips front rows.
    void rig.rotateTo(
      cameraPreset === 'overhead' ? 0 : -0.12,
      cameraPreset === 'overhead' ? 0.04 : cameraPreset === 'low' ? 1.0 : 0.8,
      false
    );
    rig.update(0);
    camera.updateMatrixWorld();
    const extent = box
      .clone()
      .applyMatrix4(camera.matrixWorldInverse)
      .getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    void rig.moveTo(center.x, center.y, center.z, false);
    void rig.dollyTo(
      rig.getDistanceToFitBox(extent.x * 1.1, extent.y * 1.12, extent.z),
      false
    );
    gl.domElement.setAttribute('data-camera-ready', cameraPreset);
    invalidate();
  }, [
    model.bounds,
    camera,
    cameraPreset,
    recenterToken,
    size.width,
    size.height,
    gl,
    invalidate,
  ]);
  const select = (id: string | null) => {
    const target = model.targets.find(item => item.tile.agentId === id);
    if (target?.agentId) onSelectAgent(target.agentId);
    else if (target?.parentAgentId) {
      if (target.childId && onSelectDelegationChild)
        onSelectDelegationChild(target.parentAgentId, target.childId);
      else onSelectAgent(target.parentAgentId);
    }
  };
  return (
    <>
      <CameraControls
        ref={controls}
        makeDefault
        minPolarAngle={0.02}
        maxPolarAngle={1.25}
        minDistance={4}
        maxDistance={700}
        smoothTime={reduced ? 0 : 0.22}
        onUpdate={() => invalidate()}
      />
      <group scale={[1, 0.3, 1]}>
        <TileRenderer
          tiles={model.ground}
          surface="plane"
          theme={groundTheme}
          material="glazed"
          shape="hex"
          detail="coarse"
          mark="off"
          motion={STILL}
          signal="paint"
          readFrame={readGround}
          marks={MARKS}
          reducedMotion
          lighting={false}
          interactive={false}
          transmission={false}
          staticInstances
        />
      </group>
      <TileRenderer
        tiles={model.tiles}
        surface="plane"
        theme={theme}
        material={material}
        shape="rounded"
        detail={model.tiles.length > 200 ? 'coarse' : 'full'}
        mark="relief"
        motion={{ ...DEFAULT_MOTION, lift: 'still' }}
        signal="paint"
        light="studio"
        readFrame={readFrame}
        readClock={readClock}
        marks={MARKS}
        reducedMotion={reduced || ambient.cadence === 'parked'}
        calmAttention
        requestFrame={invalidate}
        onMotionFrame={onMotionFrame}
        transmission={transmission && model.tiles.length < 700}
        onSelect={select}
      />
      {model.tethers.length > 0 && (
        <Line
          points={model.tethers}
          segments
          color={theme.labelMuted}
          lineWidth={1}
          transparent
          opacity={0.35}
          toneMapped={false}
          depthWrite={false}
          raycast={() => null}
        />
      )}
      {model.territories.map(({ zone, rect }) => (
        <Html
          key={zone.id}
          position={[rect.x + rect.width / 2, 0.1, rect.y - 0.8]}
          center
          zIndexRange={[30, 0]}
        >
          <button
            data-board-zone={zone.id}
            disabled={zone.isAggregate}
            onPointerDown={event => event.stopPropagation()}
            onClick={event => {
              event.stopPropagation();
              onDrillProject(zone.id);
            }}
            aria-label={`Open Project ${zone.label}`}
            className="flex w-max items-center gap-2 rounded-md px-2 py-1 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{
              color: theme.label,
              background: spatialColorWithAlpha(theme.canvas, 0.9),
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background: spatialProjectIdentityColor(theme, zone.id),
              }}
            />
            {zone.label}
            <span
              className="font-mono text-chrome-meta font-normal"
              style={{ color: theme.labelMuted }}
            >
              {zone.agentCount}
            </span>
          </button>
        </Html>
      ))}
      {model.targets.map(target => (
        <Html
          key={target.tile.id}
          position={[target.tile.x, 0.65, target.tile.y]}
          center
          distanceFactor={24}
          zIndexRange={[20, 0]}
        >
          <button
            data-quality-agent={target.tile.id}
            aria-label={target.label}
            title={target.label}
            aria-pressed={
              target.agentId ? multiSelection?.has(target.agentId) : undefined
            }
            onPointerDown={event => event.stopPropagation()}
            onClick={event => {
              event.stopPropagation();
              return target.agentId
                ? onSelectAgent(target.agentId)
                : target.parentAgentId
                  ? target.childId && onSelectDelegationChild
                    ? onSelectDelegationChild(
                        target.parentAgentId,
                        target.childId
                      )
                    : onSelectAgent(target.parentAgentId)
                  : undefined;
            }}
            className="group relative grid h-8 w-8 place-items-center rounded-full text-chrome-label outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{ color: theme.label }}
          >
            {target.overflow > 0 ? (
              <span className="rounded bg-background px-1 font-mono">
                +{target.overflow}
              </span>
            ) : target.stopped ? (
              <span className="rounded bg-background px-1 text-chrome-meta">
                Stopped
              </span>
            ) : null}
            <span className="pointer-events-none absolute top-full mt-2 hidden w-max max-w-64 rounded-md border border-border bg-background px-3 py-2 text-left text-chrome-label group-hover:block group-focus-visible:block">
              {target.label}
            </span>
          </button>
        </Html>
      ))}
    </>
  );
}

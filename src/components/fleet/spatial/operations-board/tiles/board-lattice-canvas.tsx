'use client';

import { Canvas, useThree } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type WebGLRenderer, type Scene, type Camera } from 'three';
import type { OperationsBoardTilesProps } from '@/components/fleet/spatial/operations-board/tiles/operations-board-tiles-canvas';
import {
  BoardDisplayResolution,
  PaintOnTheme,
  exposeFrameDemand,
} from '@/components/fleet/spatial/operations-board/operations-board-canvas';
import {
  spatialProjectIdentityColor,
  spatialColorWithAlpha,
} from '@/components/fleet/spatial/spatial-theme';
import {
  useLowPowerMode,
  useReducedMotion,
} from '@/components/fleet/spatial/operations-board/operations-board-env';
import {
  FrameDemandRoot,
  useAmbientCadence,
  useCanvasFrames,
  useFrameDemand,
  useFramePolicy,
  useFrameScheduler,
} from '@/lib/frame-demand/frame-demand';
import { useHostRenderPolicy } from '@/lib/host-power/use-host-render-policy';
import { TileRenderer } from '@/components/tiles/tile-renderer';
import type { TileFrame } from '@/components/tiles/tile-contract';
import { DEFAULT_MOTION } from '@/components/tiles/crust-motion';
import { HARNESS_MARK_PATHS } from '@/components/workspace/harness-icons';
import { harnessMarkTone } from '@/components/workspace/harness-mark-tones';
import { boardLatticeModel } from './board-lattice-model';
import { LatticeCamera } from './board-lattice-camera';
import { createBoardHoverStore } from '../operations-board-hover';
import { usePressSound } from '@/components/tiles/use-press-sound';
import { useTileEmergence } from './use-tile-emergence';
import { MATERIAL_SOUND } from '@/components/tiles/press-sounds';

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
type LatticeProps = OperationsBoardTilesProps;

/** Accepted Fleet v2: a single XZ address mapping for bodies, sockets and input. */
export function LatticeCanvas(props: LatticeProps) {
  const reduced = useReducedMotion();
  const lowPower = useLowPowerMode();
  // Battery also withholds transmission below; it never lowers resolution.
  const host = useHostRenderPolicy();
  const frames = useCanvasFrames(useFramePolicy({ reduced, lowPower }));
  return (
    <Canvas
      frameloop={frames.frameloop}
      dpr={[1, 2]}
      camera={{ position: [0, 30, 30], fov: 38, near: 0.1, far: 2000 }}
      gl={{
        antialias: true,
        preserveDrawingBuffer: props.preserveDrawingBuffer,
      }}
      style={{ touchAction: 'none' }}
      data-board-view="v2"
      data-board-material={props.material}
      onCreated={({ gl, scene, camera }) => {
        // Hide only WebGL pixels; Html's sibling command targets stay accessible.
        gl.domElement.setAttribute('aria-hidden', 'true');
        (
          gl.domElement as HTMLCanvasElement & {
            boardEvidence: { gl: WebGLRenderer; scene: Scene; camera: Camera };
          }
        ).boardEvidence = { gl, scene, camera };
        exposeFrameDemand(gl.domElement, frames.scheduler);
        if (process.env.NODE_ENV !== 'production') {
          Object.assign(window, {
            __EVAL_GL__: gl,
            __EVAL_SCENE__: scene,
            __EVAL_CAM__: camera,
          });
        }
      }}
    >
      <FrameDemandRoot scheduler={frames.scheduler}>
        <color attach="background" args={[props.theme.canvas]} />
        <PaintOnTheme theme={props.theme} />
        <BoardDisplayResolution lowPower={lowPower} />
        <LatticeScene
          {...props}
          reduced={reduced}
          transmission={
            !lowPower && !host.onBattery && !props.theme.reducedTransparency
          }
        />
      </FrameDemandRoot>
    </Canvas>
  );
}

function LatticeScene({
  layout,
  theme,
  material: chosenMaterial = 'gummy',
  greybox = false,
  sourceMarks = {},
  onDrillProject,
  onSelectAgent,
  onSelectDelegationChild,
  multiSelection,
  reduced,
  transmission,
  ...commands
}: LatticeProps & {
  reduced: boolean;
  transmission: boolean;
}) {
  const material = greybox ? 'matte' : chosenMaterial;
  const frames = useFrameScheduler();
  const cadence = useAmbientCadence();
  const narrow = useThree(state => state.size.width < 600);

  const { rendered, getTracker } = useTileEmergence(layout.pieces, reduced);
  const model = useMemo(
    () =>
      boardLatticeModel(
        {
          ...layout,
          pieces: [
            ...layout.pieces.filter(
              piece =>
                piece.kind !== 'agent' || piece.sessionState === 'stopped'
            ),
            ...rendered,
          ],
        },
        sourceMarks
      ),
    [layout, sourceMarks, rendered]
  );
  const records = useRef(new Map<string, (typeof model.tiles)[number]>());
  for (const tile of model.tiles)
    if (!tile.id.startsWith('population:')) records.current.set(tile.id, tile);
  const detailedTiles = useMemo(() => {
    const live = model.tiles.filter(tile => !tile.id.startsWith('population:'));
    const ids = new Set(live.map(tile => tile.id));
    return [
      ...live,
      ...rendered
        .filter(piece => !ids.has(piece.id))
        .flatMap(piece => {
          const tile = records.current.get(piece.id);
          return tile ? [tile] : [];
        }),
    ];
  }, [model, rendered]);
  useEffect(() => {
    const retained = new Set([
      ...detailedTiles.map(tile => tile.id),
      ...getTracker().retiring(performance.now()),
    ]);
    for (const id of records.current.keys())
      if (!retained.has(id)) records.current.delete(id);
  }, [detailedTiles, getTracker]);
  const populationTiles = useMemo(
    () => model.tiles.filter(tile => tile.id.startsWith('population:')),
    [model]
  );
  const displayTiles = useMemo(
    () =>
      greybox
        ? detailedTiles.map(tile => ({
            ...tile,
            status: undefined,
            mark: undefined,
          }))
        : detailedTiles,
    [greybox, detailedTiles]
  );
  const displayPopulation = useMemo(
    () =>
      greybox
        ? populationTiles.map(tile => ({ ...tile, status: undefined }))
        : populationTiles,
    [greybox, populationTiles]
  );
  const groundTheme = useMemo(
    () => ({ ...theme, zone: theme.zoneHover, grid: theme.gridMajor }),
    [theme]
  );
  const agentIds = useMemo(
    () =>
      new Set(detailedTiles.filter(tile => tile.agentId).map(tile => tile.id)),
    [detailedTiles]
  );
  const frame = useMemo<TileFrame>(
    () => ({
      focusId: commands.selectedDelegationUnitId ?? layout.selectedAgentId,
      selection: multiSelection ?? EMPTY,
      tileAgent: id => agentIds.has(id),
      tileScale: id =>
        layout.pieces.find(piece => piece.id === id)?.sessionState === 'stopped'
          ? 1
          : getTracker().scaleOf(id, performance.now()),
      tileEmphasis: id =>
        !layout.focusedProjectId ||
        model.tileProjects.get(id) === layout.focusedProjectId
          ? 1
          : 0.12,
    }),
    [
      multiSelection,
      getTracker,
      layout.pieces,
      agentIds,
      layout.focusedProjectId,
      layout.selectedAgentId,
      commands.selectedDelegationUnitId,
      model.tileProjects,
    ]
  );
  const [hover] = useState(createBoardHoverStore);
  const play = usePressSound(greybox ? false : MATERIAL_SOUND[material]);
  const press = useCallback(
    (id: string | null) => {
      const previous = hover.get().pressedAgentId;
      if (previous === id) return;
      hover.setPressed(id);
      if (previous) play('release');
      if (id) play('press');
    },
    [hover, play]
  );
  useEffect(() => hover.subscribe(() => frames.request()), [hover, frames]);
  const paintedFrame = useRef<TileFrame>({ focusId: null, selection: EMPTY });
  const readFrame = useCallback(() => {
    const result = paintedFrame.current;
    Object.assign(result, frame);
    result.hoveredId = hover.get().agentId;
    result.pressedId = hover.get().pressedAgentId;
    return result;
  }, [frame, hover]);
  const populationFrame = useRef<TileFrame>({
    focusId: null,
    selection: EMPTY,
  });
  const readPopulation = useCallback(() => {
    const frame = populationFrame.current;
    frame.hoveredId = hover.get().agentId;
    frame.pressedId = hover.get().pressedAgentId;
    return frame;
  }, [hover]);
  // Status churn and working motion are ambient: they follow the canvas's
  // cadence. Emergence paints through the tracker's own deadline.
  const tileMotion = useFrameDemand('ambient', 'tiles');
  const onMotionFrame = useCallback(
    (settling: boolean, working: boolean) =>
      tileMotion.set(settling || working),
    [tileMotion]
  );
  const requestFrame = frames.request;
  useEffect(() => frames.request(), [frames, frame, model]);
  return (
    <>
      <LatticeCamera
        {...commands}
        layout={model.presentation}
        population={populationTiles}
        tileProjects={model.tileProjects}
        hover={hover}
        press={press}
        onDrillProject={onDrillProject}
        reduced={reduced}
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
        tiles={displayTiles}
        surface="plane"
        theme={theme}
        material={material}
        shape="rounded"
        detail="full"
        mark="relief"
        motion={{ ...DEFAULT_MOTION, lift: 'still' }}
        signal="paint"
        light="studio"
        readFrame={readFrame}
        readClock={readClock}
        marks={MARKS}
        reducedMotion={reduced || cadence === 'parked'}
        calmAttention
        requestFrame={requestFrame}
        onMotionFrame={onMotionFrame}
        transmission={transmission && detailedTiles.length < 700}
        interactive={false}
      />
      <TileRenderer
        tiles={displayPopulation}
        surface="plane"
        theme={theme}
        material={material}
        shape="rounded"
        detail="coarse"
        mark="off"
        motion={STILL}
        signal="paint"
        readFrame={readPopulation}
        marks={MARKS}
        reducedMotion
        lighting={false}
        interactive={false}
        transmission={false}
        staticInstances
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
            data-board-zone-tier={narrow ? 'nano' : 'full'}
            data-board-zone={zone.id}
            data-board-work-counts={JSON.stringify(zone.statusCounts)}
            disabled={zone.isAggregate}
            onPointerDown={event => event.stopPropagation()}
            onClick={event => {
              event.stopPropagation();
              if (event.shiftKey && commands.onToggleZoneSelect)
                commands.onToggleZoneSelect(zone.id);
              else onDrillProject(zone.id);
            }}
            aria-label={`Open Project ${zone.label}`}
            className="flex w-max items-center gap-2 rounded-md px-2 py-1 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{
              opacity:
                layout.focusedProjectId && layout.focusedProjectId !== zone.id
                  ? 0.4
                  : 1,
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
            {!narrow && zone.label}
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
            data-lattice-unit={target.tile.id}
            data-board-work={
              target.stopped ? 'stopped' : (target.tile.status ?? 'unreported')
            }
            data-board-agent={target.agentId ?? undefined}
            data-board-status-light={target.reading}
            data-board-session-state={
              target.agentId ? (target.stopped ? 'stopped' : 'live') : undefined
            }
            data-board-delegation-parent={target.parentAgentId}
            data-board-delegation-unit={
              target.parentAgentId ? target.tile.id : undefined
            }
            aria-current={
              target.agentId && layout.selectedAgentId === target.agentId
                ? true
                : undefined
            }
            aria-label={target.label}
            title={target.label}
            aria-pressed={
              target.agentId ? multiSelection?.has(target.agentId) : undefined
            }
            onPointerEnter={() => hover.setAgent(target.tile.agentId ?? null)}
            onPointerLeave={() => {
              if (hover.get().agentId === target.tile.agentId)
                hover.setAgent(null);
              if (hover.get().pressedAgentId === target.tile.agentId)
                press(null);
            }}
            onFocus={() => hover.setAgent(target.tile.agentId ?? null)}
            onBlur={() => {
              if (hover.get().agentId === target.tile.agentId)
                hover.setAgent(null);
              if (hover.get().pressedAgentId === target.tile.agentId)
                press(null);
            }}
            onPointerDown={event => {
              event.stopPropagation();
              if (event.button === 0) press(target.tile.agentId ?? null);
            }}
            onPointerUp={() => press(null)}
            onPointerCancel={() => press(null)}
            onKeyDown={event => {
              if (!event.repeat && (event.key === 'Enter' || event.key === ' '))
                press(target.tile.agentId ?? null);
            }}
            onKeyUp={() => press(null)}
            onClick={event => {
              event.stopPropagation();
              if (
                event.shiftKey &&
                target.agentId &&
                commands.onToggleAgentSelect
              ) {
                commands.onToggleAgentSelect(target.agentId);
                return;
              }
              const project = model.tileProjects.get(target.tile.id);
              if (layout.altitude === 'fleet' && project) {
                onDrillProject(project);
                return;
              }
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
            className="group relative grid h-12 w-12 place-items-center rounded-full text-chrome-label outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

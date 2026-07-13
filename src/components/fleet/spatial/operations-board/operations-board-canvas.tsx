'use client';

import { Instances, Instance, Html, Line, useCursor } from '@react-three/drei';
import {
  Canvas,
  type ThreeEvent,
  useFrame,
  useThree,
} from '@react-three/fiber';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as THREE from 'three';
import type {
  SpatialBoardLayout,
  SpatialBoardPiece,
  SpatialBoardProjection,
  SpatialBoardProjectZone,
  SpatialBoardRect,
} from '@exawatt/ui-model';

const BOARD_COLOR = {
  background: '#101418',
  plane: '#13191d',
  grid: '#20282e',
  gridMajor: '#2d373e',
  zone: '#182025',
  zoneHover: '#202a30',
  border: '#43515a',
  borderSelected: '#75c8bd',
  working: '#67b88a',
  blocked: '#e46e64',
  reviewing: '#d5ad63',
  idle: '#727c84',
  complete: '#7194a8',
  error: '#e46e64',
} as const;

const PROJECT_TINTS = [
  '#1a2528',
  '#20232a',
  '#25231f',
  '#20262a',
  '#22252b',
] as const;

function statusColor(status: SpatialBoardPiece['status']): string {
  return BOARD_COLOR[status];
}

function projectTint(projectId: string): string {
  let hash = 0;
  for (let index = 0; index < projectId.length; index++) {
    hash = (hash * 31 + projectId.charCodeAt(index)) >>> 0;
  }
  return PROJECT_TINTS[hash % PROJECT_TINTS.length]!;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

function useLowPowerMode(): boolean {
  const [lowPower, setLowPower] = useState(false);
  useEffect(() => {
    setLowPower((navigator.hardwareConcurrency || 8) <= 4);
  }, []);
  return lowPower;
}

export interface OperationsBoardHandle {
  recenter(): void;
  restoreViewport(viewport: OperationsBoardViewport): void;
  focusProject(projectId: string): void;
  focusAgent(agentId: string): void;
  enterSession(agentId: string): void;
  zoom(steps: number): void;
  pan(dx: number, dy: number): void;
  nudge(dx: number, dy: number, dollySteps: number, orbitRadians: number): void;
}

interface CameraTarget {
  x: number;
  y: number;
  zoom: number;
  tilt: number;
}

export interface OperationsBoardViewport {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

function rectCenter(rect: SpatialBoardRect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: -(rect.y + rect.height / 2) };
}

function BoardCameraRig({
  layout,
  projection,
  reduced,
  controllerRef,
  onViewportChange,
}: {
  layout: SpatialBoardLayout;
  projection: SpatialBoardProjection;
  reduced: boolean;
  controllerRef: { current: OperationsBoardHandle | null };
  onViewportChange?: (viewport: OperationsBoardViewport) => void;
}) {
  const { size, invalidate } = useThree();
  const get = useThree(state => state.get);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const initialTilt = projection === 'fixed-angle' ? 1 : 0;
  const target = useRef<CameraTarget>({
    x: 0,
    y: 0,
    zoom: 1,
    tilt: initialTilt,
  });
  const current = useRef<CameraTarget>({
    x: 0,
    y: 0,
    zoom: 1,
    tilt: initialTilt,
  });
  const fitZoom = useRef(1);
  const initialized = useRef(false);

  const notifyViewport = useCallback(
    (value: CameraTarget) => {
      onViewportChange?.({
        centerX: value.x,
        centerY: -value.y,
        width: size.width / Math.max(value.zoom, 0.001),
        height: size.height / Math.max(value.zoom, 0.001),
      });
    },
    [onViewportChange, size.height, size.width]
  );

  const applyCamera = useCallback(
    (value: CameraTarget) => {
      const ortho =
        cameraRef.current ?? (get().camera as THREE.OrthographicCamera);
      cameraRef.current = ortho;
      ortho.position.set(
        value.x + value.tilt * 18,
        value.y - value.tilt * 22,
        100 - value.tilt * 24
      );
      ortho.up.set(0, 1, 0);
      ortho.lookAt(value.x, value.y, 0);
      ortho.zoom = value.zoom * (1 - value.tilt * 0.08);
      ortho.updateProjectionMatrix();
    },
    [get]
  );

  const snapToTarget = useCallback(() => {
    current.current.x = target.current.x;
    current.current.y = target.current.y;
    current.current.zoom = target.current.zoom;
    current.current.tilt = target.current.tilt;
    applyCamera(current.current);
    notifyViewport(current.current);
  }, [applyCamera, notifyViewport]);

  const announceTargetViewport = useCallback(() => {
    notifyViewport(target.current);
  }, [notifyViewport]);

  const targetForRect = useCallback(
    (rect: SpatialBoardRect) => {
      const paddedWidth = Math.max(18, rect.width + 8);
      const paddedHeight = Math.max(14, rect.height + 8);
      const zoom = Math.max(
        0.35,
        Math.min(size.width / paddedWidth, size.height / paddedHeight)
      );
      const center = rectCenter(rect);
      fitZoom.current = zoom;
      target.current.x = center.x;
      target.current.y = center.y;
      target.current.zoom = zoom;
      announceTargetViewport();
    },
    [announceTargetViewport, size.height, size.width]
  );

  useLayoutEffect(() => {
    targetForRect(layout.cameraBounds);
    if (!initialized.current || reduced) {
      snapToTarget();
      initialized.current = true;
    }
    invalidate();
  }, [invalidate, layout.cameraBounds, reduced, snapToTarget, targetForRect]);

  useEffect(() => {
    target.current.tilt = projection === 'fixed-angle' ? 1 : 0;
    announceTargetViewport();
    if (reduced) snapToTarget();
    invalidate();
  }, [announceTargetViewport, invalidate, projection, reduced, snapToTarget]);

  useEffect(() => {
    const span = () => Math.max(layout.bounds.width, layout.bounds.height, 24);
    const focusRect = (rect: SpatialBoardRect) => {
      targetForRect(rect);
      if (reduced) snapToTarget();
      invalidate();
    };
    const cameraChanged = () => {
      announceTargetViewport();
      if (reduced) snapToTarget();
      invalidate();
    };
    controllerRef.current = {
      recenter() {
        focusRect(layout.cameraBounds);
      },
      restoreViewport(viewport) {
        target.current.x = viewport.centerX;
        target.current.y = -viewport.centerY;
        target.current.zoom = Math.max(
          0.001,
          Math.min(size.width / viewport.width, size.height / viewport.height)
        );
        cameraChanged();
      },
      focusProject(projectId) {
        const zone = layout.zones.find(entry => entry.id === projectId);
        if (zone) focusRect(zone.rect);
      },
      focusAgent(agentId) {
        const piece = layout.pieces.find(entry => entry.agentId === agentId);
        if (!piece) return;
        focusRect({
          x: piece.x - 6,
          y: piece.y - 6,
          width: 12,
          height: 12,
        });
      },
      enterSession(agentId) {
        const piece = layout.pieces.find(entry => entry.agentId === agentId);
        if (!piece) return;
        focusRect({
          x: piece.x - 2.5,
          y: piece.y - 2.5,
          width: 5,
          height: 5,
        });
      },
      zoom(steps) {
        const min = fitZoom.current * 0.55;
        const max = fitZoom.current * 4.5;
        target.current.zoom = THREE.MathUtils.clamp(
          target.current.zoom * Math.exp(steps * 0.18),
          min,
          max
        );
        cameraChanged();
      },
      pan(dx, dy) {
        target.current.x += dx * span();
        target.current.y -= dy * span();
        cameraChanged();
      },
      nudge(dx, dy, dollySteps) {
        target.current.x += dx * span();
        target.current.y -= dy * span();
        if (dollySteps) {
          const min = fitZoom.current * 0.55;
          const max = fitZoom.current * 4.5;
          target.current.zoom = THREE.MathUtils.clamp(
            target.current.zoom * Math.exp(dollySteps * 1.7),
            min,
            max
          );
        }
        cameraChanged();
      },
    };
    return () => {
      controllerRef.current = null;
    };
  }, [
    announceTargetViewport,
    controllerRef,
    invalidate,
    layout.bounds.height,
    layout.bounds.width,
    layout.cameraBounds,
    layout.pieces,
    layout.zones,
    reduced,
    size.height,
    size.width,
    snapToTarget,
    targetForRect,
  ]);

  useFrame((state, delta) => {
    if (reduced) return;
    const ortho =
      cameraRef.current ?? (state.camera as THREE.OrthographicCamera);
    cameraRef.current = ortho;
    const nextX = THREE.MathUtils.damp(
      current.current.x,
      target.current.x,
      11,
      delta
    );
    const nextY = THREE.MathUtils.damp(
      current.current.y,
      target.current.y,
      11,
      delta
    );
    const nextZoom = THREE.MathUtils.damp(
      current.current.zoom,
      target.current.zoom,
      11,
      delta
    );
    const nextTilt = THREE.MathUtils.damp(
      current.current.tilt,
      target.current.tilt,
      11,
      delta
    );
    const moving =
      Math.abs(nextX - target.current.x) > 0.001 ||
      Math.abs(nextY - target.current.y) > 0.001 ||
      Math.abs(nextZoom - target.current.zoom) > 0.001 ||
      Math.abs(nextTilt - target.current.tilt) > 0.001;
    current.current.x = moving ? nextX : target.current.x;
    current.current.y = moving ? nextY : target.current.y;
    current.current.zoom = moving ? nextZoom : target.current.zoom;
    current.current.tilt = moving ? nextTilt : target.current.tilt;
    applyCamera(current.current);
    notifyViewport(current.current);
    if (moving) state.invalidate();
  });

  return null;
}

function gridGeometry(
  bounds: SpatialBoardRect,
  step: number,
  major: boolean
): THREE.BufferGeometry {
  const margin = 30;
  const minX = Math.floor((bounds.x - margin) / step) * step;
  const maxX = Math.ceil((bounds.x + bounds.width + margin) / step) * step;
  const minY = Math.floor((bounds.y - margin) / step) * step;
  const maxY = Math.ceil((bounds.y + bounds.height + margin) / step) * step;
  const points: number[] = [];
  for (let x = minX; x <= maxX; x += step) {
    const index = Math.round(x / step);
    if ((index % 5 === 0) !== major) continue;
    points.push(x, -minY, -1, x, -maxY, -1);
  }
  for (let y = minY; y <= maxY; y += step) {
    const index = Math.round(y / step);
    if ((index % 5 === 0) !== major) continue;
    points.push(minX, -y, -1, maxX, -y, -1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(points, 3)
  );
  return geometry;
}

function BoardGrid({ bounds }: { bounds: SpatialBoardRect }) {
  const minor = useMemo(() => gridGeometry(bounds, 2, false), [bounds]);
  const major = useMemo(() => gridGeometry(bounds, 2, true), [bounds]);
  useEffect(
    () => () => {
      minor.dispose();
      major.dispose();
    },
    [major, minor]
  );
  const planeWidth = Math.max(120, bounds.width + 80);
  const planeHeight = Math.max(90, bounds.height + 80);
  const center = rectCenter(bounds);
  return (
    <>
      <mesh position={[center.x, center.y, -1.2]} raycast={() => null}>
        <planeGeometry args={[planeWidth, planeHeight]} />
        <meshBasicMaterial color={BOARD_COLOR.plane} />
      </mesh>
      <lineSegments geometry={minor} raycast={() => null}>
        <lineBasicMaterial
          color={BOARD_COLOR.grid}
          transparent
          opacity={0.58}
        />
      </lineSegments>
      <lineSegments geometry={major} raycast={() => null}>
        <lineBasicMaterial
          color={BOARD_COLOR.gridMajor}
          transparent
          opacity={0.72}
        />
      </lineSegments>
    </>
  );
}

function ZoneOutline({ zone }: { zone: SpatialBoardProjectZone }) {
  const geometry = useMemo(() => {
    const points = [
      new THREE.Vector3(-0.5, -0.5, 0),
      new THREE.Vector3(0.5, -0.5, 0),
      new THREE.Vector3(0.5, 0.5, 0),
      new THREE.Vector3(-0.5, 0.5, 0),
    ];
    return new THREE.BufferGeometry().setFromPoints(points);
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const center = rectCenter(zone.rect);
  return (
    <lineLoop
      geometry={geometry}
      position={[center.x, center.y, 0.35]}
      scale={[zone.rect.width, zone.rect.height, 1]}
      raycast={() => null}
    >
      <lineBasicMaterial
        color={zone.selected ? BOARD_COLOR.borderSelected : BOARD_COLOR.border}
      />
    </lineLoop>
  );
}

function ZoneLayer({
  zones,
  onDrillProject,
}: {
  zones: SpatialBoardProjectZone[];
  onDrillProject: (projectId: string) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  useCursor(hovered != null);
  return (
    <>
      <Instances limit={32} range={zones.length}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial />
        {zones.map(zone => {
          const center = rectCenter(zone.rect);
          const interactive = !zone.isAggregate;
          return (
            <Instance
              key={zone.id}
              position={[center.x, center.y, 0]}
              scale={[zone.rect.width, zone.rect.height, 0.5]}
              color={
                hovered === zone.id
                  ? BOARD_COLOR.zoneHover
                  : projectTint(zone.id)
              }
              onPointerOver={event => {
                if (!interactive) return;
                event.stopPropagation();
                setHovered(zone.id);
              }}
              onPointerOut={() => setHovered(null)}
              onClick={(event: ThreeEvent<MouseEvent>) => {
                if (!interactive || event.delta > 5) return;
                event.stopPropagation();
                onDrillProject(zone.id);
              }}
            />
          );
        })}
      </Instances>
      {zones.map(zone => (
        <ZoneOutline key={zone.id} zone={zone} />
      ))}
    </>
  );
}

function ProjectHealthRail({ zone }: { zone: SpatialBoardProjectZone }) {
  const total = Math.max(zone.agentCount, 1);
  const segments = [
    ['working', zone.statusCounts.working],
    ['reviewing', zone.statusCounts.reviewing],
    ['blocked', zone.statusCounts.blocked + zone.statusCounts.error],
    ['idle', zone.statusCounts.idle + zone.statusCounts.complete],
  ] as const;
  return (
    <span className="mt-1 flex h-[3px] w-full overflow-hidden bg-[oklch(0.22_0.008_220)]">
      {segments.map(([status, count]) =>
        count > 0 ? (
          <span
            key={status}
            style={{
              width: `${(count / total) * 100}%`,
              background: BOARD_COLOR[status],
            }}
          />
        ) : null
      )}
    </span>
  );
}

function ProjectControls({
  zones,
  altitude,
  onDrillProject,
}: {
  zones: SpatialBoardProjectZone[];
  altitude: SpatialBoardLayout['altitude'];
  onDrillProject: (projectId: string) => void;
}) {
  return zones.map(zone => {
    const position: [number, number, number] = [
      zone.rect.x + 1.5,
      -(zone.rect.y + 1.35),
      0.8,
    ];
    const content = (
      <>
        <span className="flex items-baseline justify-between gap-3">
          <span className="max-w-[9.5rem] truncate text-[11px] font-semibold tracking-[-0.01em] text-[oklch(0.91_0.008_210)]">
            {zone.label}
          </span>
          <span className="font-mono text-[9px] tabular-nums text-[oklch(0.65_0.015_210)]">
            {zone.agentCount}A
          </span>
        </span>
        <span className="mt-0.5 flex gap-2 font-mono text-[9px] tabular-nums text-[oklch(0.64_0.012_210)]">
          <span>
            {zone.agentCount === 0
              ? 'No agents yet'
              : `${zone.activeCount} active`}
          </span>
          {zone.blockedCount > 0 && (
            <span className="text-[oklch(0.72_0.13_28)]">
              {zone.blockedCount} blocked
            </span>
          )}
        </span>
        <ProjectHealthRail zone={zone} />
      </>
    );
    return (
      <Html key={zone.id} position={position} style={{ pointerEvents: 'auto' }}>
        {altitude === 'fleet' && !zone.isAggregate ? (
          <button
            type="button"
            data-board-zone={zone.id}
            aria-label={`Open Project ${zone.label}`}
            onClick={() => onDrillProject(zone.id)}
            className="w-44 border border-[oklch(0.36_0.014_210)] bg-[oklch(0.15_0.009_215/0.96)] px-2.5 py-2 text-left shadow-[0_8px_22px_oklch(0.06_0.01_220/0.42)] outline-none transition-[border-color,background-color,transform] duration-150 hover:border-[oklch(0.61_0.08_185)] hover:bg-[oklch(0.18_0.012_210/0.98)] active:translate-y-px focus-visible:border-[oklch(0.72_0.1_185)] focus-visible:ring-2 focus-visible:ring-[oklch(0.72_0.1_185/0.35)]"
          >
            {content}
          </button>
        ) : (
          <div className="w-44 border border-[oklch(0.32_0.012_210)] bg-[oklch(0.15_0.009_215/0.94)] px-2.5 py-2 text-left">
            {content}
          </div>
        )}
      </Html>
    );
  });
}

function AgentPieceLayer({
  pieces,
  altitude,
  onSelectAgent,
}: {
  pieces: SpatialBoardPiece[];
  altitude: SpatialBoardLayout['altitude'];
  onSelectAgent: (agentId: string) => void;
}) {
  const visible = pieces.filter(piece => piece.visible);
  const solid = visible.filter(piece => piece.sessionState !== 'stopped');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const pieceGeometry = useMemo(() => {
    const geometry = new THREE.CylinderGeometry(0.5, 0.5, 0.28, 8);
    geometry.rotateX(Math.PI / 2);
    return geometry;
  }, []);
  useEffect(() => () => pieceGeometry.dispose(), [pieceGeometry]);
  useCursor(hoveredId != null);
  const selected = visible.find(piece => piece.selected);
  return (
    <>
      <Instances geometry={pieceGeometry} limit={256} range={solid.length}>
        <meshBasicMaterial />
        {solid.map(piece => {
          const interactive = piece.kind === 'agent' && altitude !== 'fleet';
          return (
            <Instance
              key={piece.id}
              position={[piece.x, -piece.y, 0.65]}
              scale={[piece.size, piece.size, 1]}
              color={statusColor(piece.status)}
              onPointerOver={event => {
                if (!interactive) return;
                event.stopPropagation();
                setHoveredId(piece.id);
              }}
              onPointerOut={() => setHoveredId(null)}
              onClick={(event: ThreeEvent<MouseEvent>) => {
                if (!interactive || !piece.agentId || event.delta > 5) return;
                event.stopPropagation();
                onSelectAgent(piece.agentId);
              }}
            />
          );
        })}
      </Instances>
      <StoppedAgentOutlines pieces={visible} />
      {selected && (
        <mesh position={[selected.x, -selected.y, 0.7]} raycast={() => null}>
          <ringGeometry
            args={[selected.size * 0.58, selected.size * 0.72, 8]}
          />
          <meshBasicMaterial color={BOARD_COLOR.borderSelected} />
        </mesh>
      )}
      {visible
        .filter(piece => piece.kind === 'aggregate')
        .map(piece => (
          <Html
            key={`count:${piece.id}`}
            position={[piece.x, -piece.y, 1]}
            center
            style={{ pointerEvents: 'none' }}
          >
            <span className="font-mono text-[10px] font-semibold tabular-nums text-[oklch(0.96_0.005_210)]">
              {piece.count}
            </span>
          </Html>
        ))}
    </>
  );
}

/** One dashed Line2 draw for every stopped Session-backed Agent. The DOM
 * controls remain the interaction/a11y owner; this layer is visual state. */
function StoppedAgentOutlines({ pieces }: { pieces: SpatialBoardPiece[] }) {
  const geometry = useMemo(() => {
    const points: Array<[number, number, number]> = [];
    const vertexColors: THREE.Color[] = [];
    for (const piece of pieces) {
      if (piece.kind !== 'agent' || piece.sessionState !== 'stopped') continue;
      const radius = piece.size * 0.52;
      const color = new THREE.Color(statusColor(piece.status));
      for (let edge = 0; edge < 8; edge += 1) {
        const from = (edge / 8) * Math.PI * 2 + Math.PI / 8;
        const to = ((edge + 1) / 8) * Math.PI * 2 + Math.PI / 8;
        points.push(
          [
            piece.x + Math.cos(from) * radius,
            -piece.y + Math.sin(from) * radius,
            0.72,
          ],
          [
            piece.x + Math.cos(to) * radius,
            -piece.y + Math.sin(to) * radius,
            0.72,
          ]
        );
        vertexColors.push(color, color);
      }
    }
    return { points, vertexColors };
  }, [pieces]);

  if (geometry.points.length === 0) return null;
  return (
    <Line
      points={geometry.points}
      vertexColors={geometry.vertexColors}
      segments
      dashed
      dashSize={0.08}
      gapSize={0.11}
      lineWidth={1.35}
      transparent
      opacity={0.78}
      depthWrite={false}
      raycast={() => null}
    />
  );
}

function AgentControls({
  pieces,
  altitude,
  onSelectAgent,
}: {
  pieces: SpatialBoardPiece[];
  altitude: SpatialBoardLayout['altitude'];
  onSelectAgent: (agentId: string) => void;
}) {
  if (altitude === 'fleet') return null;
  return pieces
    .filter(piece => piece.kind === 'agent' && piece.visible && piece.agentId)
    .map(piece => {
      const always = piece.labelVisibility === 'always';
      return (
        <Html
          key={`control:${piece.id}`}
          position={[piece.x, -piece.y, 1.2]}
          center
          style={{ pointerEvents: 'auto' }}
        >
          <button
            type="button"
            data-board-agent={piece.agentId}
            data-board-session-state={piece.sessionState}
            aria-label={`${piece.label}, ${piece.status}${piece.sessionState === 'stopped' ? ', stopped session' : ''}`}
            onClick={() => onSelectAgent(piece.agentId!)}
            className="group relative grid h-11 w-11 place-items-center border border-transparent bg-transparent outline-none transition-[border-color,transform] duration-150 active:translate-y-px focus-visible:border-[oklch(0.72_0.1_185)] focus-visible:ring-2 focus-visible:ring-[oklch(0.72_0.1_185/0.4)]"
          >
            <span
              className={`pointer-events-none absolute left-1/2 top-[calc(100%+3px)] w-16 -translate-x-1/2 truncate border border-[oklch(0.3_0.012_210)] bg-[oklch(0.13_0.008_215/0.96)] px-1 py-1 text-center text-[9px] font-medium text-[oklch(0.88_0.01_210)] shadow-[0_6px_16px_oklch(0.06_0.01_220/0.4)] transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 sm:w-28 sm:px-1.5 sm:text-[10px] ${always ? 'opacity-100' : 'opacity-0'}`}
            >
              {piece.label}
            </span>
          </button>
        </Html>
      );
    });
}

export function OperationsBoardCanvas({
  layout,
  projection,
  controllerRef,
  onViewportChange,
  onDrillProject,
  onSelectAgent,
  onBackground,
  preserveDrawingBuffer = false,
}: {
  layout: SpatialBoardLayout;
  projection: SpatialBoardProjection;
  controllerRef: { current: OperationsBoardHandle | null };
  onViewportChange?: (viewport: OperationsBoardViewport) => void;
  onDrillProject: (projectId: string) => void;
  onSelectAgent: (agentId: string) => void;
  onBackground: () => void;
  preserveDrawingBuffer?: boolean;
}) {
  const reduced = useReducedMotion();
  const lowPower = useLowPowerMode();
  const visibleZones = layout.zones.filter(zone => zone.visible);
  return (
    <Canvas
      orthographic
      frameloop="demand"
      dpr={lowPower ? [1, 1.25] : [1, 2]}
      camera={{ position: [0, 0, 100], zoom: 1, near: 0.1, far: 200 }}
      gl={{ antialias: true, preserveDrawingBuffer }}
      onPointerMissed={event => {
        if (event.type === 'click' && event.target instanceof HTMLCanvasElement)
          onBackground();
      }}
      onCreated={({ gl, scene, camera }) => {
        if (process.env.NODE_ENV !== 'production') {
          const target = window as typeof window & {
            __EVAL_GL__?: THREE.WebGLRenderer;
            __EVAL_SCENE__?: THREE.Scene;
            __EVAL_CAM__?: THREE.Camera;
          };
          target.__EVAL_GL__ = gl;
          target.__EVAL_SCENE__ = scene;
          target.__EVAL_CAM__ = camera;
        }
      }}
      aria-hidden="true"
    >
      <color attach="background" args={[BOARD_COLOR.background]} />
      <BoardCameraRig
        layout={layout}
        projection={projection}
        reduced={reduced}
        controllerRef={controllerRef}
        onViewportChange={onViewportChange}
      />
      <BoardGrid bounds={layout.bounds} />
      <ZoneLayer zones={visibleZones} onDrillProject={onDrillProject} />
      <AgentPieceLayer
        pieces={layout.pieces}
        altitude={layout.altitude}
        onSelectAgent={onSelectAgent}
      />
      <ProjectControls
        zones={visibleZones}
        altitude={layout.altitude}
        onDrillProject={onDrillProject}
      />
      <AgentControls
        pieces={layout.pieces}
        altitude={layout.altitude}
        onSelectAgent={onSelectAgent}
      />
    </Canvas>
  );
}

'use client';

import { Instances, Instance, Html, Line, useCursor } from '@react-three/drei';
import {
  Canvas,
  type ThreeEvent,
  useFrame,
  useThree,
} from '@react-three/fiber';
import {
  Suspense,
  lazy,
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
import {
  STATUS_LIGHT_ACTIVE_ROTATION_SECONDS,
  STATUS_LIGHT_META,
  statusLightStateForAgentStatus,
  type StatusLightState,
} from '@/components/status-light/protocol';
import {
  computePopulationDotField,
  POPULATION_STATUS_ORDER,
} from './population-dots';

const OperationsBoardEffects = lazy(() => import('./operations-board-effects'));

const BOARD_COLOR = {
  background: '#0e1216',
  plane: '#12181d',
  grid: '#28323a',
  gridMajor: '#39454e',
  zoneHover: '#232d33',
  border: '#43515a',
  borderSelected: '#75c8bd',
} as const;

const PIECE_BODY = '#263139';

/** Per-project accent hues for zone edges — muted neon, no reds. */
const PROJECT_ACCENTS = [
  '#4fd8c4',
  '#5aa7e8',
  '#b8a76a',
  '#9a8fe8',
  '#6fc487',
  '#5ac4d8',
] as const;

function statusColor(status: SpatialBoardPiece['status']): string {
  return STATUS_LIGHT_META[statusLightStateForAgentStatus(status)].color;
}

function hashId(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index++) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function projectAccent(projectId: string): string {
  return PROJECT_ACCENTS[hashId(projectId) % PROJECT_ACCENTS.length]!;
}

const zoneFillCache = new Map<string, string>();
/** Zone plate fill: the project accent pulled far down toward the board, so
 *  each sector reads as a distinct lit plate without competing with pieces. */
function zoneFill(projectId: string): string {
  const cached = zoneFillCache.get(projectId);
  if (cached) return cached;
  const color = new THREE.Color(projectAccent(projectId));
  // The lit lambert plate roughly doubles perceived brightness — keep the
  // accent contribution tiny so plates stay dark with a readable hue whisper.
  color.multiplyScalar(0.05);
  color.add(new THREE.Color('#0c1114'));
  const fill = `#${color.getHexString()}`;
  zoneFillCache.set(projectId, fill);
  return fill;
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

/** V2.4 ambient-motion gate: pulses/rotation run only while the tab is
 *  visible and motion is welcome. Hidden tab or reduced motion ⇒ park. */
function usePageVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
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

/** Camera speeds (damp lambda): FLIGHT for semantic moves (altitude change,
 *  drill, recenter — slower, reads as travel), NUDGE for direct manipulation
 *  (keys/wheel/drag — tight, immediate acknowledgment). */
const FLIGHT_LAMBDA = 5.5;
const NUDGE_LAMBDA = 13;

function BoardCameraRig({
  layout,
  projection,
  reduced,
  controllerRef,
  onViewportChange,
  onZoomChange,
}: {
  layout: SpatialBoardLayout;
  projection: SpatialBoardProjection;
  reduced: boolean;
  controllerRef: { current: OperationsBoardHandle | null };
  onViewportChange?: (viewport: OperationsBoardViewport) => void;
  onZoomChange?: (zoom: number) => void;
}) {
  const { size, invalidate, gl } = useThree();
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
  const lambda = useRef(FLIGHT_LAMBDA);
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
      onZoomChange?.(value.zoom);
    },
    [get, onZoomChange]
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
      lambda.current = FLIGHT_LAMBDA;
      announceTargetViewport();
    },
    [announceTargetViewport, size.height, size.width]
  );

  useLayoutEffect(() => {
    targetForRect(layout.cameraBounds);
    if (!initialized.current || reduced) {
      snapToTarget();
      initialized.current = true;
      // Arrival dolly (V2.4): enter the board slightly wide and ease in, so
      // regime entry reads as descending onto the map instead of a hard cut.
      if (!reduced) {
        current.current.zoom = target.current.zoom * 0.82;
        applyCamera(current.current);
      }
    }
    invalidate();
  }, [
    applyCamera,
    invalidate,
    layout.cameraBounds,
    reduced,
    snapToTarget,
    targetForRect,
  ]);

  useEffect(() => {
    target.current.tilt = projection === 'fixed-angle' ? 1 : 0;
    lambda.current = FLIGHT_LAMBDA;
    announceTargetViewport();
    if (reduced) snapToTarget();
    invalidate();
  }, [announceTargetViewport, invalidate, projection, reduced, snapToTarget]);

  // Direct pointer navigation (V2.4): drag pans; trackpad scroll pans;
  // pinch (ctrl/meta + wheel) zooms anchored at the cursor. All of it moves
  // the same damped target the keyboard glide uses — one input model.
  useEffect(() => {
    const element = gl.domElement;
    const clampZoom = (zoom: number) =>
      THREE.MathUtils.clamp(
        zoom,
        fitZoom.current * 0.55,
        fitZoom.current * 4.5
      );
    const worldAt = (clientX: number, clientY: number) => {
      const rect = element.getBoundingClientRect();
      const zoom = Math.max(current.current.zoom, 0.001);
      return {
        x: current.current.x + (clientX - rect.left - rect.width / 2) / zoom,
        y: current.current.y + (rect.height / 2 - (clientY - rect.top)) / zoom,
      };
    };
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 && event.button !== 1) return;
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      element.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      const zoom = Math.max(current.current.zoom, 0.001);
      target.current.x -= (event.clientX - lastX) / zoom;
      target.current.y += (event.clientY - lastY) / zoom;
      lastX = event.clientX;
      lastY = event.clientY;
      lambda.current = NUDGE_LAMBDA;
      element.style.cursor = 'grabbing';
      announceTargetViewport();
      if (reduced) snapToTarget();
      invalidate();
    };
    const endDrag = (event: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      element.style.cursor = '';
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const zoom = Math.max(current.current.zoom, 0.001);
      if (event.ctrlKey || event.metaKey) {
        const anchor = worldAt(event.clientX, event.clientY);
        const nextZoom = clampZoom(
          target.current.zoom * Math.exp(-event.deltaY * 0.012)
        );
        const ratio = target.current.zoom / nextZoom;
        target.current.x = anchor.x - (anchor.x - target.current.x) * ratio;
        target.current.y = anchor.y - (anchor.y - target.current.y) * ratio;
        target.current.zoom = nextZoom;
      } else {
        target.current.x += event.deltaX / zoom;
        target.current.y -= event.deltaY / zoom;
      }
      lambda.current = NUDGE_LAMBDA;
      announceTargetViewport();
      if (reduced) snapToTarget();
      invalidate();
    };
    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', endDrag);
    element.addEventListener('pointercancel', endDrag);
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', endDrag);
      element.removeEventListener('pointercancel', endDrag);
      element.removeEventListener('wheel', onWheel);
    };
  }, [announceTargetViewport, gl, invalidate, reduced, snapToTarget]);

  useEffect(() => {
    const span = () => Math.max(layout.bounds.width, layout.bounds.height, 24);
    const focusRect = (rect: SpatialBoardRect) => {
      targetForRect(rect);
      if (reduced) snapToTarget();
      invalidate();
    };
    const cameraChanged = () => {
      lambda.current = NUDGE_LAMBDA;
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
    const speed = lambda.current;
    const nextX = THREE.MathUtils.damp(
      current.current.x,
      target.current.x,
      speed,
      delta
    );
    const nextY = THREE.MathUtils.damp(
      current.current.y,
      target.current.y,
      speed,
      delta
    );
    const nextZoom = THREE.MathUtils.damp(
      current.current.zoom,
      target.current.zoom,
      speed,
      delta
    );
    const nextTilt = THREE.MathUtils.damp(
      current.current.tilt,
      target.current.tilt,
      speed,
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
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const maxRadius = Math.max(Math.hypot(maxX - centerX, maxY - centerY), 1);
  const base = new THREE.Color(
    major ? BOARD_COLOR.gridMajor : BOARD_COLOR.grid
  );
  const points: number[] = [];
  const colors: number[] = [];
  const scratch = new THREE.Color();
  const SEGMENT = step * 5;
  // Segmented lines with vertex colors: brightness falls off radially from
  // the board center so the grid melts into the dark instead of ending at a
  // hard rectangle. (lineBasicMaterial has no per-vertex alpha; a color fade
  // into the near-black background is visually identical.)
  const pushPoint = (x: number, y: number) => {
    points.push(x, -y, -1);
    const falloff = Math.max(
      0,
      1 - Math.hypot(x - centerX, y - centerY) / maxRadius
    );
    scratch.copy(base).multiplyScalar(0.18 + 0.82 * falloff * falloff);
    colors.push(scratch.r, scratch.g, scratch.b);
  };
  for (let x = minX; x <= maxX; x += step) {
    const index = Math.round(x / step);
    if ((index % 5 === 0) !== major) continue;
    for (let y = minY; y < maxY; y += SEGMENT) {
      pushPoint(x, y);
      pushPoint(x, Math.min(y + SEGMENT, maxY));
    }
  }
  for (let y = minY; y <= maxY; y += step) {
    const index = Math.round(y / step);
    if ((index % 5 === 0) !== major) continue;
    for (let x = minX; x < maxX; x += SEGMENT) {
      pushPoint(x, y);
      pushPoint(Math.min(x + SEGMENT, maxX), y);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(points, 3)
  );
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
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
  const planeWidth = Math.max(160, bounds.width + 120);
  const planeHeight = Math.max(120, bounds.height + 120);
  const center = rectCenter(bounds);
  return (
    <>
      <mesh position={[center.x, center.y, -1.2]} raycast={() => null}>
        <planeGeometry args={[planeWidth, planeHeight]} />
        <meshBasicMaterial color={BOARD_COLOR.plane} />
      </mesh>
      <lineSegments geometry={minor} raycast={() => null}>
        <lineBasicMaterial vertexColors transparent opacity={0.6} />
      </lineSegments>
      <lineSegments geometry={major} raycast={() => null}>
        <lineBasicMaterial vertexColors transparent opacity={0.78} />
      </lineSegments>
    </>
  );
}

/** All zone edges in ONE Line2 draw: per-vertex accent colors carry each
 *  Project's hue; selection/hover brighten their zone's vertices. The bright
 *  states cross the bloom threshold (toneMapped={false}) and glow. */
function ZoneEdges({
  zones,
  hoveredId,
}: {
  zones: SpatialBoardProjectZone[];
  hoveredId: string | null;
}) {
  const { points, colors } = useMemo(() => {
    const points: Array<[number, number, number]> = [];
    const colors: THREE.Color[] = [];
    for (const zone of zones) {
      const accent = new THREE.Color(
        zone.selected ? BOARD_COLOR.borderSelected : projectAccent(zone.id)
      );
      accent.multiplyScalar(
        zone.selected ? 1.5 : hoveredId === zone.id ? 1.15 : 0.72
      );
      const { x, y, width, height } = zone.rect;
      const z = 0.35;
      const corners: Array<[number, number, number]> = [
        [x, -y, z],
        [x + width, -y, z],
        [x + width, -(y + height), z],
        [x, -(y + height), z],
      ];
      for (let edge = 0; edge < 4; edge += 1) {
        points.push(corners[edge]!, corners[(edge + 1) % 4]!);
        colors.push(accent, accent);
      }
    }
    return { points, colors };
  }, [hoveredId, zones]);
  if (points.length === 0) return null;
  return (
    <Line
      points={points}
      vertexColors={colors}
      segments
      lineWidth={1.4}
      toneMapped={false}
      transparent
      opacity={0.95}
      depthWrite={false}
      raycast={() => null}
    />
  );
}

/** Mount-keyed entrance: zones fade up quickly; the parent keys this layer
 *  by semantic address so descent/ascent re-choreographs (never data ticks). */
function ZoneLayer({
  zones,
  reduced,
  onDrillProject,
  onHover,
  hoveredId,
}: {
  zones: SpatialBoardProjectZone[];
  reduced: boolean;
  onDrillProject: (projectId: string) => void;
  onHover: (zoneId: string | null) => void;
  hoveredId: string | null;
}) {
  const materialRef = useRef<THREE.MeshLambertMaterial>(null);
  const entrance = useRef(reduced ? 1 : 0);
  useCursor(hoveredId != null);
  useFrame((state, delta) => {
    const material = materialRef.current;
    if (!material) return;
    if (entrance.current >= 1) {
      material.opacity = 1;
      return;
    }
    entrance.current = Math.min(
      1,
      entrance.current + Math.min(delta, 0.05) * 4
    );
    material.opacity = entrance.current;
    state.invalidate();
  });
  return (
    <>
      <Instances limit={32} range={zones.length}>
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial
          ref={materialRef}
          transparent
          opacity={reduced ? 1 : 0}
        />
        {zones.map(zone => {
          const center = rectCenter(zone.rect);
          const interactive = !zone.isAggregate;
          return (
            <Instance
              key={zone.id}
              position={[center.x, center.y, 0]}
              scale={[zone.rect.width, zone.rect.height, 0.62]}
              color={
                hoveredId === zone.id
                  ? BOARD_COLOR.zoneHover
                  : zoneFill(zone.id)
              }
              onPointerOver={event => {
                if (!interactive) return;
                event.stopPropagation();
                onHover(zone.id);
              }}
              onPointerOut={() => onHover(null)}
              onClick={(event: ThreeEvent<MouseEvent>) => {
                if (!interactive || event.delta > 5) return;
                event.stopPropagation();
                onDrillProject(zone.id);
              }}
            />
          );
        })}
      </Instances>
      <ZoneEdges zones={zones} hoveredId={hoveredId} />
    </>
  );
}

function ProjectHealthRail({ zone }: { zone: SpatialBoardProjectZone }) {
  const total = Math.max(zone.agentCount, 1);
  const segments: Array<[StatusLightState, number]> = [
    ['active', zone.statusCounts.working + zone.statusCounts.reviewing],
    ['needs-you', zone.statusCounts.blocked],
    ['fault', zone.statusCounts.error],
    ['result', zone.statusCounts.complete],
    ['off', zone.statusCounts.idle],
  ];
  return (
    <span className="mt-1 flex h-[3px] w-full overflow-hidden bg-[oklch(0.22_0.008_220)]">
      {segments.map(([status, count]) =>
        count > 0 ? (
          <span
            key={status}
            style={{
              width: `${(count / total) * 100}%`,
              background: STATUS_LIGHT_META[status].color,
            }}
          />
        ) : null
      )}
    </span>
  );
}

/** Zone-label budget (V3.1): full cards only when the zone's projected size
 *  can afford them; below that a one-line chip keeps identity, count, and the
 *  drill affordance while the population field stays visible. */
export type ZoneLabelTier = 'full' | 'compact';

function ProjectControls({
  zones,
  altitude,
  labelTier,
  onDrillProject,
}: {
  zones: SpatialBoardProjectZone[];
  altitude: SpatialBoardLayout['altitude'];
  labelTier: ZoneLabelTier;
  onDrillProject: (projectId: string) => void;
}) {
  return zones.map(zone => {
    const position: [number, number, number] = [
      zone.rect.x + 1.5,
      -(zone.rect.y + 1.35),
      0.8,
    ];
    const accent = projectAccent(zone.id);
    if (labelTier === 'compact' && altitude === 'fleet') {
      const compactContent = (
        <span className="flex items-baseline gap-2">
          <span className="max-w-[7.5rem] truncate text-[10px] font-semibold tracking-[-0.01em] text-[oklch(0.9_0.008_210)]">
            {zone.label}
          </span>
          <span className="font-mono text-[9px] tabular-nums text-[oklch(0.65_0.015_210)]">
            {zone.agentCount}
          </span>
          {zone.blockedCount > 0 && (
            <span className="font-mono text-[9px] tabular-nums text-[oklch(0.72_0.13_28)]">
              {zone.blockedCount}!
            </span>
          )}
        </span>
      );
      return (
        <Html
          key={zone.id}
          position={position}
          style={{ pointerEvents: 'auto' }}
        >
          {!zone.isAggregate ? (
            <button
              type="button"
              data-board-zone={zone.id}
              aria-label={`Open Project ${zone.label}`}
              onClick={() => onDrillProject(zone.id)}
              style={{ borderLeftColor: accent }}
              className="board-control-enter border border-l-2 border-[oklch(0.34_0.014_210)] bg-[oklch(0.14_0.009_215/0.94)] px-1.5 py-0.5 text-left outline-none transition-[border-color,background-color] duration-150 hover:border-[oklch(0.61_0.08_185)] hover:bg-[oklch(0.18_0.012_210/0.98)] focus-visible:border-[oklch(0.72_0.1_185)] focus-visible:ring-2 focus-visible:ring-[oklch(0.72_0.1_185/0.35)]"
            >
              {compactContent}
            </button>
          ) : (
            <div
              style={{ borderLeftColor: accent }}
              className="board-control-enter border border-l-2 border-[oklch(0.3_0.012_210)] bg-[oklch(0.14_0.009_215/0.92)] px-1.5 py-0.5 text-left"
            >
              {compactContent}
            </div>
          )}
        </Html>
      );
    }
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
            style={{ borderLeftColor: accent }}
            className="board-control-enter w-44 border border-l-2 border-[oklch(0.36_0.014_210)] bg-[oklch(0.15_0.009_215/0.96)] px-2.5 py-2 text-left shadow-[0_8px_22px_oklch(0.06_0.01_220/0.42)] outline-none transition-[border-color,background-color,transform] duration-150 hover:border-[oklch(0.61_0.08_185)] hover:bg-[oklch(0.18_0.012_210/0.98)] active:translate-y-px focus-visible:border-[oklch(0.72_0.1_185)] focus-visible:ring-2 focus-visible:ring-[oklch(0.72_0.1_185/0.35)]"
          >
            {content}
          </button>
        ) : (
          <div
            style={{ borderLeftColor: accent }}
            className="board-control-enter w-44 border border-l-2 border-[oklch(0.32_0.012_210)] bg-[oklch(0.15_0.009_215/0.94)] px-2.5 py-2 text-left"
          >
            {content}
          </div>
        )}
      </Html>
    );
  });
}

function checkGeometry(): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.15, 0.01);
  shape.lineTo(-0.06, -0.08);
  shape.lineTo(0.16, 0.14);
  shape.lineTo(0.11, 0.18);
  shape.lineTo(-0.06, 0.02);
  shape.lineTo(-0.11, 0.06);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

function crossGeometry(): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.16, -0.11);
  shape.lineTo(-0.11, -0.16);
  shape.lineTo(0, -0.05);
  shape.lineTo(0.11, -0.16);
  shape.lineTo(0.16, -0.11);
  shape.lineTo(0.05, 0);
  shape.lineTo(0.16, 0.11);
  shape.lineTo(0.11, 0.16);
  shape.lineTo(0, 0.05);
  shape.lineTo(-0.11, 0.16);
  shape.lineTo(-0.16, 0.11);
  shape.lineTo(-0.05, 0);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

/**
 * Batched spatial sibling of the DOM StatusLight. Project identity stays on
 * zone edges; every Agent piece carries one exact protocol color and shape.
 * Only Active rotors invalidate the demand loop, at the shared DOM cadence.
 */
function StatusMarkLayer({
  pieces,
  active,
}: {
  pieces: SpatialBoardPiece[];
  active: boolean;
}) {
  const rotorRefs = useRef(new Map<string, THREE.Object3D>());
  const agentPieces = pieces.filter(piece => piece.kind === 'agent');
  const byState = (state: StatusLightState) =>
    agentPieces.filter(
      piece => statusLightStateForAgentStatus(piece.status) === state
    );
  const off = byState('off');
  const rotating = byState('active');
  const result = byState('result');
  const needsYou = byState('needs-you');
  const fault = byState('fault');
  const signalDisks = [...result, ...needsYou, ...fault];
  const geometries = useMemo(
    () => ({
      ring: new THREE.RingGeometry(0.18, 0.28, 32),
      offSegment: new THREE.RingGeometry(0.21, 0.27, 8, 1, 0, Math.PI / 4),
      rotor: new THREE.CircleGeometry(0.2, 24, -Math.PI / 2, Math.PI),
      signal: new THREE.CircleGeometry(0.28, 28),
      check: checkGeometry(),
      dot: new THREE.CircleGeometry(0.07, 16),
      cross: crossGeometry(),
    }),
    []
  );
  useEffect(
    () => () => {
      for (const geometry of Object.values(geometries)) geometry.dispose();
    },
    [geometries]
  );

  useFrame((state, delta) => {
    if (rotorRefs.current.size === 0) return;
    if (!active) {
      for (const rotor of rotorRefs.current.values()) rotor.rotation.z = 0;
      return;
    }
    const step =
      (Math.min(delta, 0.05) * Math.PI * 2) /
      STATUS_LIGHT_ACTIVE_ROTATION_SECONDS;
    for (const rotor of rotorRefs.current.values()) {
      rotor.rotation.z = (rotor.rotation.z - step) % (Math.PI * 2);
    }
    state.invalidate();
  });

  const instance = (piece: SpatialBoardPiece) => ({
    position: [piece.x, -piece.y, 0.94] as [number, number, number],
    scale: [piece.size, piece.size, 1] as [number, number, number],
    color: statusColor(piece.status),
  });

  return (
    <>
      {rotating.length > 0 && (
        <Instances
          geometry={geometries.ring}
          limit={256}
          range={rotating.length}
          renderOrder={2}
        >
          <meshBasicMaterial
            toneMapped={false}
            transparent
            opacity={0.98}
            depthWrite={false}
          />
          {rotating.map(piece => (
            <Instance
              {...instance(piece)}
              key={`status-ring:${piece.id}`}
              raycast={() => null}
            />
          ))}
        </Instances>
      )}
      {signalDisks.length > 0 && (
        <Instances
          geometry={geometries.signal}
          limit={256}
          range={signalDisks.length}
          renderOrder={2}
        >
          <meshBasicMaterial
            toneMapped={false}
            transparent
            opacity={0.98}
            depthWrite={false}
          />
          {signalDisks.map(piece => (
            <Instance
              {...instance(piece)}
              key={`status-signal:${piece.id}`}
              raycast={() => null}
            />
          ))}
        </Instances>
      )}
      {off.length > 0 && (
        <Instances
          geometry={geometries.offSegment}
          limit={1024}
          range={off.length * 4}
          renderOrder={2}
        >
          <meshBasicMaterial
            toneMapped={false}
            transparent
            opacity={0.48}
            depthWrite={false}
          />
          {off.flatMap(piece =>
            [0, 1, 2, 3].map(segment => (
              <Instance
                {...instance(piece)}
                key={`status-off-${segment}:${piece.id}`}
                rotation={[0, 0, segment * (Math.PI / 2)]}
                raycast={() => null}
              />
            ))
          )}
        </Instances>
      )}
      {rotating.length > 0 && (
        <Instances
          geometry={geometries.rotor}
          limit={256}
          range={rotating.length}
          renderOrder={2}
        >
          <meshBasicMaterial
            toneMapped={false}
            transparent
            opacity={0.84}
            depthWrite={false}
          />
          {rotating.map(piece => (
            <Instance
              {...instance(piece)}
              key={`status-rotor:${piece.id}`}
              ref={(target: THREE.Object3D | null) => {
                if (target) rotorRefs.current.set(piece.id, target);
                else rotorRefs.current.delete(piece.id);
              }}
              raycast={() => null}
            />
          ))}
        </Instances>
      )}
      {result.length > 0 && (
        <Instances
          geometry={geometries.check}
          limit={256}
          range={result.length}
          renderOrder={3}
        >
          <meshBasicMaterial
            color={PIECE_BODY}
            toneMapped={false}
            transparent
            opacity={0.98}
            depthWrite={false}
          />
          {result.map(piece => (
            <Instance
              {...instance(piece)}
              color={PIECE_BODY}
              key={`status-check:${piece.id}`}
              position={[piece.x, -piece.y, 0.97]}
              raycast={() => null}
            />
          ))}
        </Instances>
      )}
      {needsYou.length > 0 && (
        <Instances
          geometry={geometries.dot}
          limit={256}
          range={needsYou.length}
          renderOrder={3}
        >
          <meshBasicMaterial
            color={PIECE_BODY}
            toneMapped={false}
            transparent
            opacity={0.98}
            depthWrite={false}
          />
          {needsYou.map(piece => (
            <Instance
              {...instance(piece)}
              color={PIECE_BODY}
              key={`status-dot:${piece.id}`}
              position={[piece.x, -piece.y, 0.97]}
              raycast={() => null}
            />
          ))}
        </Instances>
      )}
      {fault.length > 0 && (
        <Instances
          geometry={geometries.cross}
          limit={256}
          range={fault.length}
          renderOrder={3}
        >
          <meshBasicMaterial
            color={PIECE_BODY}
            toneMapped={false}
            transparent
            opacity={0.98}
            depthWrite={false}
          />
          {fault.map(piece => (
            <Instance
              {...instance(piece)}
              color={PIECE_BODY}
              key={`status-cross:${piece.id}`}
              position={[piece.x, -piece.y, 0.97]}
              raycast={() => null}
            />
          ))}
        </Instances>
      )}
    </>
  );
}

/** Animated selection: an accent reticle that eases in on selection and
 *  slowly rotates while ambient motion is welcome. Keyed by the selected
 *  piece so a selection change replays the ease-in. */
function SelectionRing({
  piece,
  active,
  reduced,
}: {
  piece: SpatialBoardPiece;
  active: boolean;
  reduced: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const entrance = useRef(reduced ? 1 : 0);
  const points = useMemo(() => {
    const result: Array<[number, number, number]> = [];
    const SEGMENTS = 48;
    for (let index = 0; index <= SEGMENTS; index += 1) {
      const angle = (index / SEGMENTS) * Math.PI * 2;
      result.push([Math.cos(angle) * 0.66, Math.sin(angle) * 0.66, 0]);
    }
    return result;
  }, []);
  useFrame((state, delta) => {
    const target = group.current;
    if (!target) return;
    const clamped = Math.min(delta, 0.05);
    let animating = false;
    if (entrance.current < 1) {
      entrance.current = Math.min(1, entrance.current + clamped * 5);
      animating = true;
    }
    const scale = piece.size * (1.25 - 0.25 * entrance.current);
    target.scale.setScalar(scale);
    if (active) {
      target.rotation.z += clamped * 0.5;
      animating = true;
    }
    if (animating) state.invalidate();
  });
  return (
    <group ref={group} position={[piece.x, -piece.y, 0.78]}>
      <Line
        points={points}
        color={BOARD_COLOR.borderSelected}
        lineWidth={1.6}
        dashed
        dashSize={0.22}
        gapSize={0.09}
        toneMapped={false}
        transparent
        opacity={0.95}
        depthWrite={false}
        raycast={() => null}
      />
    </group>
  );
}

function AgentPieceLayer({
  pieces,
  altitude,
  reduced,
  ambient,
  onSelectAgent,
}: {
  pieces: SpatialBoardPiece[];
  altitude: SpatialBoardLayout['altitude'];
  reduced: boolean;
  ambient: boolean;
  onSelectAgent: (agentId: string) => void;
}) {
  // Aggregate pieces render as the instanced population dot field (V3.1),
  // never as per-piece bodies or DOM count labels.
  const visible = pieces.filter(
    piece => piece.visible && piece.kind === 'agent'
  );
  const solid = visible.filter(piece => piece.sessionState !== 'stopped');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const bodyMat = useRef<THREE.MeshLambertMaterial>(null);
  const bodyRefs = useRef(new Map<string, THREE.Object3D>());
  const entranceClock = useRef<number | null>(reduced ? null : 0);
  const pieceGeometry = useMemo(() => {
    const geometry = new THREE.CylinderGeometry(0.5, 0.56, 0.34, 8);
    geometry.rotateX(Math.PI / 2);
    return geometry;
  }, []);
  useEffect(
    () => () => {
      pieceGeometry.dispose();
    },
    [pieceGeometry]
  );
  useCursor(hoveredId != null);

  // Entrance choreography (V2.4): pieces scale in with a slotIndex stagger
  // while the materials fade up. Runs once per MOUNT (the layer is keyed by
  // semantic address), then hands scale authority back to the props.
  useFrame((state, delta) => {
    if (entranceClock.current === null) {
      if (bodyMat.current) bodyMat.current.opacity = 1;
      return;
    }
    entranceClock.current += Math.min(delta, 0.05);
    const elapsed = entranceClock.current;
    let settled = true;
    for (const piece of solid) {
      const local = THREE.MathUtils.clamp(
        (elapsed - piece.slotIndex * 0.045) / 0.34,
        0,
        1
      );
      const eased = 1 - Math.pow(1 - local, 3);
      const bodyScale = piece.size * (0.4 + 0.6 * eased);
      bodyRefs.current.get(piece.id)?.scale.set(bodyScale, bodyScale, 1);
      if (local < 1) settled = false;
    }
    const fade = THREE.MathUtils.clamp(elapsed / 0.3, 0, 1);
    if (bodyMat.current) bodyMat.current.opacity = fade;
    if (settled && fade >= 1) {
      entranceClock.current = null;
      return;
    }
    state.invalidate();
  });

  const selected = visible.find(piece => piece.selected);
  return (
    <>
      <Instances geometry={pieceGeometry} limit={256} range={solid.length}>
        <meshLambertMaterial
          ref={bodyMat}
          transparent
          opacity={reduced ? 1 : 0}
        />
        {solid.map(piece => {
          const interactive = piece.kind === 'agent' && altitude !== 'fleet';
          return (
            <Instance
              key={piece.id}
              ref={(instance: THREE.Object3D | null) => {
                if (instance) bodyRefs.current.set(piece.id, instance);
                else bodyRefs.current.delete(piece.id);
              }}
              position={[piece.x, -piece.y, 0.65]}
              scale={[piece.size, piece.size, 1]}
              color={PIECE_BODY}
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
      <StatusMarkLayer pieces={solid} active={ambient} />
      <StoppedAgentOutlines pieces={visible} />
      {selected && (
        <SelectionRing
          key={selected.id}
          piece={selected}
          active={ambient}
          reduced={reduced}
        />
      )}
    </>
  );
}

const noopRaycast = () => null;

/** One exact protocol color per population status (module scope — never
 *  allocated per frame). */
const DOT_STATUS_COLORS = POPULATION_STATUS_ORDER.map(
  status => new THREE.Color(statusColor(status))
);

/**
 * Demo-scale population field (V3.1): every aggregate piece expands into
 * per-agent status dots packed inside its zone, drawn as ONE InstancedMesh
 * for the whole board. No per-agent React elements or DOM labels; zone DOM
 * controls remain the interaction and exact-count owners. Static at rest so
 * the demand loop still parks.
 */
function PopulationDotLayer({
  zones,
  pieces,
  reduced,
}: {
  zones: SpatialBoardProjectZone[];
  pieces: SpatialBoardPiece[];
  reduced: boolean;
}) {
  const invalidate = useThree(state => state.invalidate);
  const field = useMemo(
    () => computePopulationDotField(zones, pieces),
    [pieces, zones]
  );
  // Buffer capacity grows in power-of-two buckets so live ticks reuse the
  // same GPU buffers; the mesh remounts only when the bucket changes.
  const capacity = useMemo(() => {
    let size = 64;
    while (size < field.count) size *= 2;
    return size;
  }, [field.count]);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const entrance = useRef(reduced ? 1 : 0);
  const scratch = useMemo(() => new THREE.Object3D(), []);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.count = field.count;
    for (let index = 0; index < field.count; index++) {
      scratch.position.set(field.x[index]!, -field.y[index]!, 0.7);
      scratch.scale.setScalar(field.size[index]!);
      scratch.updateMatrix();
      mesh.setMatrixAt(index, scratch.matrix);
      mesh.setColorAt(index, DOT_STATUS_COLORS[field.status[index]!]!);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    invalidate();
  }, [field, invalidate, scratch]);

  useFrame((state, delta) => {
    const material = materialRef.current;
    if (!material) return;
    if (entrance.current >= 1) {
      material.opacity = 0.92;
      return;
    }
    entrance.current = Math.min(
      1,
      entrance.current + Math.min(delta, 0.05) * 3.5
    );
    material.opacity = 0.92 * entrance.current;
    state.invalidate();
  });

  if (field.count === 0) return null;
  return (
    <instancedMesh
      key={capacity}
      ref={meshRef}
      args={[undefined, undefined, capacity]}
      frustumCulled={false}
      raycast={noopRaycast}
      // Transparent-sort tie-break: dots and zone plates are both
      // origin-anchored instanced meshes, so painter sorting cannot order
      // them by depth. Explicit renderOrder keeps dots above plates in both
      // projections (status marks use 2/3).
      renderOrder={1}
    >
      <circleGeometry args={[0.5, 6]} />
      <meshBasicMaterial
        ref={materialRef}
        toneMapped={false}
        transparent
        opacity={reduced ? 0.92 : 0}
        depthWrite={false}
      />
    </instancedMesh>
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
      const lightState = statusLightStateForAgentStatus(piece.status);
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
            data-board-status-light={lightState}
            aria-label={`${piece.label}, ${STATUS_LIGHT_META[lightState].label}${piece.sessionState === 'stopped' ? ', stopped session' : ''}`}
            onClick={() => onSelectAgent(piece.agentId!)}
            className="board-control-enter group relative grid h-11 w-11 place-items-center border border-transparent bg-transparent outline-none transition-[border-color,transform] duration-150 active:translate-y-px focus-visible:border-[oklch(0.72_0.1_185)] focus-visible:ring-2 focus-visible:ring-[oklch(0.72_0.1_185/0.4)]"
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
  const pageVisible = usePageVisible();
  const ambient = !reduced && !lowPower && pageVisible;
  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null);
  const visibleZones = layout.zones.filter(zone => zone.visible);
  // Zone-label budget: full cards only when a zone's projected width can
  // afford them. Hysteresis keeps the tier stable through damped zoom, and
  // the state only flips at a boundary crossing (never per frame).
  const [labelTier, setLabelTier] = useState<ZoneLabelTier>('full');
  const labelTierRef = useRef<ZoneLabelTier>('full');
  const zoneWidthRef = useRef(24);
  zoneWidthRef.current = visibleZones[0]?.rect.width ?? 24;
  const handleZoomChange = useCallback((zoom: number) => {
    const projectedPx = zoneWidthRef.current * zoom;
    const next: ZoneLabelTier =
      labelTierRef.current === 'full'
        ? projectedPx < 250
          ? 'compact'
          : 'full'
        : projectedPx > 290
          ? 'full'
          : 'compact';
    if (next !== labelTierRef.current) {
      labelTierRef.current = next;
      setLabelTier(next);
    }
  }, []);
  // Semantic address key: a new altitude (or focused Project) re-runs the
  // entrance choreography; live data ticks never do.
  const choreoKey = `${layout.altitude}:${layout.focusedProjectId ?? '~'}`;
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
      {/* Soft key + fill: gives zone plates and piece bodies a readable
          top/side split in the fixed-angle projection. */}
      <ambientLight intensity={1.15} />
      <directionalLight position={[26, 42, 80]} intensity={0.65} />
      <BoardCameraRig
        layout={layout}
        projection={projection}
        reduced={reduced}
        controllerRef={controllerRef}
        onViewportChange={onViewportChange}
        onZoomChange={handleZoomChange}
      />
      <BoardGrid bounds={layout.bounds} />
      <ZoneLayer
        key={`zones:${choreoKey}`}
        zones={visibleZones}
        reduced={reduced}
        onDrillProject={onDrillProject}
        onHover={setHoveredZoneId}
        hoveredId={hoveredZoneId}
      />
      <AgentPieceLayer
        key={`pieces:${choreoKey}`}
        pieces={layout.pieces}
        altitude={layout.altitude}
        reduced={reduced}
        ambient={ambient}
        onSelectAgent={onSelectAgent}
      />
      <PopulationDotLayer
        key={`dots:${choreoKey}`}
        zones={layout.zones}
        pieces={layout.pieces}
        reduced={reduced}
      />
      <ProjectControls
        zones={visibleZones}
        altitude={layout.altitude}
        labelTier={labelTier}
        onDrillProject={onDrillProject}
      />
      <AgentControls
        pieces={layout.pieces}
        altitude={layout.altitude}
        onSelectAgent={onSelectAgent}
      />
      {!lowPower && (
        <Suspense fallback={null}>
          <OperationsBoardEffects />
        </Suspense>
      )}
    </Canvas>
  );
}

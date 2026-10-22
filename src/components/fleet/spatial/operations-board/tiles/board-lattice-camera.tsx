'use client';

import { CameraControls } from '@react-three/drei';
import CameraControlsImpl from 'camera-controls';
import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Box3, Plane, Raycaster, Vector2, Vector3 } from 'three';
import type { SpatialBoardRect } from '@exawatt/ui-model';
import type { OperationsBoardTilesProps } from './operations-board-tiles-canvas';
import type { TileInstance } from '@/components/tiles/tile-contract';
import type { BoardHoverStore } from '../operations-board-hover';
import type { OperationsBoardHandle } from '../operations-board-camera-rig';
import {
  BOARD_TRANSITION_MS,
  boardTransitionEase,
  mixBoardZoom,
} from '../operations-board-transition';

import {
  altitudeHandoffActive,
  claimAltitudeHandoff,
  normalizeHandoffKey,
  ALTITUDE_HANDOFF_POSE_EVENT,
  ALTITUDE_HANDOFF_FALLBACK_EVENT,
  ALTITUDE_HANDOFF_CROSSFADE_MS,
  ALTITUDE_HANDOFF_HOLD_MS,
} from '@/components/nav/altitude-handoff';

const ACTION = CameraControlsImpl.ACTION;
const buttons = {
  left: ACTION.NONE,
  middle: ACTION.TRUCK,
  right: ACTION.ROTATE,
  wheel: ACTION.NONE,
};
const touches = {
  one: ACTION.TOUCH_TRUCK,
  two: ACTION.TOUCH_DOLLY_TRUCK,
  three: ACTION.NONE,
};

/** Perspective counterpart of the v1 camera handle. Layout coordinates are
 * already the v2 lattice: minimap, bands, keyboard and projected DOM agree. */
export function LatticeCamera({
  layout,
  population,
  hover,
  press,
  onDrillProject,
  tileProjects,
  reduced,
  controllerRef,
  onControllerReady,
  onViewportChange,
  onBackground,
  onBandSelect,
  bandOverlayRef,
  followSelection = true,
  touchSelectionMode = false,
  onManualCameraInput,
  cameraPreset = 'perspective',
  recenterToken = 0,
}: Pick<
  OperationsBoardTilesProps,
  | 'layout'
  | 'controllerRef'
  | 'onControllerReady'
  | 'onViewportChange'
  | 'onBackground'
  | 'onBandSelect'
  | 'bandOverlayRef'
  | 'followSelection'
  | 'touchSelectionMode'
  | 'onManualCameraInput'
  | 'cameraPreset'
  | 'recenterToken'
> & {
  reduced: boolean;
  population: readonly TileInstance[];
  hover: BoardHoverStore;
  press: (id: string | null) => void;
  onDrillProject: (id: string) => void;
  tileProjects: ReadonlyMap<string, string>;
}) {
  const { camera, gl, size, invalidate } = useThree();
  const rig = useRef<CameraControlsImpl>(null);
  const current = useRef({
    layout,
    onViewportChange,
    onBackground,
    onBandSelect,
    onManualCameraInput,
    followSelection,
    touchSelectionMode,
  });
  current.current = {
    layout,
    onViewportChange,
    onBackground,
    onBandSelect,
    onManualCameraInput,
    followSelection,
    touchSelectionMode,
  };
  const populationInput = useRef({
    population,
    hover,
    press,
    onDrillProject,
    tileProjects,
  });
  populationInput.current = {
    population,
    hover,
    press,
    onDrillProject,
    tileProjects,
  };
  const scratch = useMemo(
    () => ({
      target: new Vector3(),
      position: new Vector3(),
      ray: new Raycaster(),
      ndc: new Vector2(),
      point: new Vector3(),
      plane: new Plane(new Vector3(0, 1, 0), 0),
    }),
    []
  );
  const flight = useRef<{
    start: number;
    from: Vector3;
    to: Vector3;
    distance: number;
    destination: number;
    theta: number;
    phi: number;
  } | null>(null);
  const arrival = useRef('');
  const mounted = useRef(false);
  const semantic = useRef('');
  const entry = useRef(false);
  const fit = useCallback(
    (rect: SpatialBoardRect, key = '') => {
      const control = rig.current;
      if (!control || (key && arrival.current === key)) return;
      arrival.current = key;
      const box = new Box3(
        new Vector3(rect.x - 1, -0.3, rect.y - 2),
        new Vector3(rect.x + rect.width + 1, 1, rect.y + rect.height + 1)
      );
      camera.updateMatrixWorld();
      const extent = box
        .clone()
        .applyMatrix4(camera.matrixWorldInverse)
        .getSize(new Vector3());
      const to = box.getCenter(new Vector3());
      const destination = control.getDistanceToFitBox(
        extent.x * 1.1,
        extent.y * 1.12,
        extent.z
      );
      if (reduced || !mounted.current) {
        flight.current = null;
        void control.moveTo(to.x, to.y, to.z, false);
        void control.dollyTo(destination, false);
      } else {
        flight.current = {
          start: performance.now(),
          from: control.getTarget(new Vector3()),
          to,
          distance: control.distance,
          destination,
          theta: control.azimuthAngle,
          phi: control.polarAngle,
        };
      }
      mounted.current = true;
      invalidate();
    },
    [camera, invalidate, reduced]
  );
  const report = useCallback(() => {
    const control = rig.current;
    if (!control) return;
    camera.updateMatrixWorld();
    scratch.plane.set(scratch.plane.normal, 0);
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const x of [-1, 1])
      for (const y of [-1, 1]) {
        scratch.ndc.set(x, y);
        scratch.ray.setFromCamera(scratch.ndc, camera);
        if (scratch.ray.ray.intersectPlane(scratch.plane, scratch.point)) {
          minX = Math.min(minX, scratch.point.x);
          maxX = Math.max(maxX, scratch.point.x);
          minZ = Math.min(minZ, scratch.point.z);
          maxZ = Math.max(maxZ, scratch.point.z);
        }
      }
    if (!Number.isFinite(minX + maxX + minZ + maxZ)) return;
    control.getTarget(scratch.target);
    const viewport = {
      perspective: {
        target: [scratch.target.x, scratch.target.y, scratch.target.z] as [
          number,
          number,
          number,
        ],
        distance: control.distance,
        azimuth: control.azimuthAngle,
        polar: control.polarAngle,
      },
      centerX: (minX + maxX) / 2,
      centerY: (minZ + maxZ) / 2,
      width: maxX - minX,
      height: maxZ - minZ,
      zoom: 1 / control.distance,
    };
    current.current.onViewportChange?.(viewport);
    gl.domElement.setAttribute('data-camera-ready', cameraPreset);
    if (process.env.NODE_ENV !== 'production')
      Object.assign(window, { __EVAL_BOARD_VIEWPORT__: viewport });
  }, [camera, cameraPreset, gl, scratch]);
  useEffect(() => {
    report();
    invalidate();
  }, [size.width, size.height, report, invalidate]);
  useFrame(() => {
    const f = flight.current,
      control = rig.current;
    if (!f || !control) return;
    const t = reduced
      ? 1
      : Math.min(1, (performance.now() - f.start) / BOARD_TRANSITION_MS);
    scratch.target.lerpVectors(f.from, f.to, boardTransitionEase(t));
    scratch.position
      .setFromSphericalCoords(
        mixBoardZoom(f.distance, f.destination, boardTransitionEase(t)),
        f.phi,
        f.theta
      )
      .add(scratch.target);
    void control.setLookAt(
      scratch.position.x,
      scratch.position.y,
      scratch.position.z,
      scratch.target.x,
      scratch.target.y,
      scratch.target.z,
      false
    );
    control.update(0);
    report();
    if (t === 1) flight.current = null;
    else invalidate();
  }, -1);
  const manual = useCallback(() => {
    flight.current = null;
    arrival.current = '';
    current.current.onManualCameraInput?.();
    invalidate();
  }, [invalidate]);
  useEffect(() => {
    const control = rig.current;
    if (!control) return;
    void control.rotateTo(
      cameraPreset === 'overhead' ? 0 : -0.12,
      cameraPreset === 'overhead' ? 0.04 : cameraPreset === 'low' ? 1 : 0.8,
      false
    );
    control.update(0);
    fit(current.current.layout.cameraBounds);
  }, [cameraPreset, recenterToken, fit]);
  const viewportSize = useRef({ width: 0, height: 0 });
  useEffect(() => {
    const previous = viewportSize.current;
    const changed =
      previous.width > 0 &&
      (previous.width !== window.innerWidth ||
        previous.height !== window.innerHeight);
    viewportSize.current = {
      width: window.innerWidth,
      height: window.innerHeight,
    };
    // A window/device resize needs a new fit. An inspector opening inside the
    // same window retains the operator's pose and cannot interrupt selection.
    if (changed) fit(current.current.layout.cameraBounds);
  }, [size.width, size.height, fit]);
  useEffect(() => {
    if (entry.current || !altitudeHandoffActive()) return;
    entry.current = true;
    const snapshot = claimAltitudeHandoff(),
      control = rig.current;
    if (!snapshot || !control || reduced) {
      window.dispatchEvent(new CustomEvent(ALTITUDE_HANDOFF_FALLBACK_EVENT));
      return;
    }
    const activeLayout = current.current.layout;
    const distance = control.distance;
    flight.current = null;
    // Start closer, carry each card's identity into the actual projected
    // territory, then pull back only after the DOM/world crossfade.
    void control.dollyTo(distance / 1.2, false);
    control.update(0);
    camera.updateMatrixWorld();
    report();
    const canvas = gl.domElement.getBoundingClientRect();
    const targets = snapshot.cards.flatMap(card => {
      const zone = activeLayout.zones.find(
        zone => normalizeHandoffKey(zone.label) === card.key
      );
      if (!zone) return [];
      const rect = zone.rect;
      const corners = [
        [rect.x, rect.y],
        [rect.x + rect.width, rect.y],
        [rect.x, rect.y + rect.height],
        [rect.x + rect.width, rect.y + rect.height],
      ].map(([x, y]) => new Vector3(x, 0, y).project(camera));
      const left = Math.min(
        ...corners.map(
          point => canvas.left + ((point.x + 1) * canvas.width) / 2
        )
      );
      const top = Math.min(
        ...corners.map(
          point => canvas.top + ((1 - point.y) * canvas.height) / 2
        )
      );
      const right = Math.max(
        ...corners.map(
          point => canvas.left + ((point.x + 1) * canvas.width) / 2
        )
      );
      const bottom = Math.max(
        ...corners.map(
          point => canvas.top + ((1 - point.y) * canvas.height) / 2
        )
      );
      return [
        {
          key: card.key,
          label: card.label,
          color: card.color,
          from: card.rect,
          to: { left, top, width: right - left, height: bottom - top },
        },
      ];
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        window.dispatchEvent(
          new CustomEvent(ALTITUDE_HANDOFF_POSE_EVENT, {
            detail: { targets, crossfadeMs: ALTITUDE_HANDOFF_CROSSFADE_MS },
          })
        );
        timer = setTimeout(() => {
          entry.current = false;
          // Manual input or a new semantic target always wins over the arrival.
          if (arrival.current === 'entry')
            fit(current.current.layout.cameraBounds);
        }, ALTITUDE_HANDOFF_HOLD_MS);
      });
    });
    arrival.current = 'entry';
    invalidate();
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [camera, fit, gl, invalidate, reduced, report]);
  useEffect(() => {
    const handle: OperationsBoardHandle = {
      recenter: () => fit(current.current.layout.cameraBounds),
      restoreViewport: viewport => {
        const pose = viewport.perspective,
          control = rig.current;
        if (!pose || !control) return;
        flight.current = null;
        semantic.current = `${current.current.layout.altitude}:${current.current.layout.focusedProjectId}:${current.current.layout.selectedAgentId}`;
        void control.rotateTo(pose.azimuth, pose.polar, false);
        void control.moveTo(...pose.target, false);
        void control.dollyTo(pose.distance, false);
        invalidate();
      },
      focusProject: id => {
        const zone = current.current.layout.zones.find(item => item.id === id);
        if (zone) fit(zone.rect, `project:${id}`);
      },
      focusFleet: () => fit(current.current.layout.bounds, 'fleet'),
      focusAgent: (id, force) => {
        if (!force && !current.current.followSelection) return;
        const piece = current.current.layout.pieces.find(
          item => item.agentId === id
        );
        if (!piece) return;
        if (current.current.layout.altitude === 'project' && rig.current) {
          const control = rig.current;
          const key = `agent:${id}`;
          if (arrival.current === key) return;
          arrival.current = key;
          if (reduced) void control.moveTo(piece.x, 0, piece.y, false);
          else
            flight.current = {
              start: performance.now(),
              from: control.getTarget(new Vector3()),
              to: new Vector3(piece.x, 0, piece.y),
              distance: control.distance,
              destination: control.distance,
              theta: control.azimuthAngle,
              phi: control.polarAngle,
            };
          invalidate();
        } else
          fit(
            { x: piece.x - 4, y: piece.y - 4, width: 8, height: 8 },
            `agent:${id}`
          );
      },
      enterSession: id => handle.focusAgent(id, true),
      zoom: steps => {
        manual();
        void rig.current?.dolly(
          steps * (rig.current.distance * 0.12),
          !reduced
        );
      },
      pan: (dx, dy) => {
        manual();
        void rig.current?.truck(dx, dy, !reduced);
      },
      panToBoardPoint: (x, y) => {
        manual();
        void rig.current?.moveTo(x, 0, y, !reduced);
      },
      nudge: (dx, dy, dolly, orbit) => {
        manual();
        void rig.current?.truck(dx, dy, !reduced);
        void rig.current?.dolly(dolly, !reduced);
        void rig.current?.rotate(orbit, 0, !reduced);
      },
    };
    controllerRef.current = handle;
    onControllerReady?.(handle);
    return () => {
      if (controllerRef.current === handle) controllerRef.current = null;
    };
  }, [controllerRef, fit, manual, onControllerReady, reduced, invalidate]);
  useEffect(() => {
    const key = `${layout.altitude}:${layout.focusedProjectId}:${layout.selectedAgentId}`;
    if (semantic.current === key || entry.current) {
      semantic.current = key;
      return;
    }
    semantic.current = key;
    if (layout.selectedAgentId && followSelection)
      controllerRef.current?.focusAgent(layout.selectedAgentId);
    else if (layout.focusedProjectId)
      controllerRef.current?.focusProject(layout.focusedProjectId);
    else if (layout.altitude === 'fleet') controllerRef.current?.focusFleet();
  }, [
    layout.selectedAgentId,
    layout.focusedProjectId,
    layout.altitude,
    followSelection,
    controllerRef,
  ]);
  useEffect(() => {
    const canvas = gl.domElement;
    const fingers = new Set<number>();
    let down: {
      x: number;
      y: number;
      pointer: number;
      band: boolean;
      population?: TileInstance;
    } | null = null;
    const world = (x: number, y: number, elevation = 0) => {
      scratch.plane.set(scratch.plane.normal, -elevation);
      const rect = canvas.getBoundingClientRect();
      scratch.ndc.set(
        ((x - rect.left) / rect.width) * 2 - 1,
        1 - ((y - rect.top) / rect.height) * 2
      );
      camera.updateMatrixWorld();
      scratch.ray.setFromCamera(scratch.ndc, camera);
      return scratch.ray.ray
        .intersectPlane(scratch.plane, scratch.point)
        ?.clone();
    };
    const populationAt = (event: PointerEvent) => {
      const point = world(event.clientX, event.clientY, 0.65);
      if (!point) return undefined;
      return populationInput.current.population.find(
        tile =>
          Math.hypot(tile.x - point.x, tile.y - point.z) <
          (tile.radius ?? 1) * 0.85
      );
    };
    const pointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        fingers.add(event.pointerId);
        if (fingers.size > 1) {
          down = null;
          populationInput.current.press(null);
          if (bandOverlayRef?.current)
            bandOverlayRef.current.style.display = 'none';
          return;
        }
      }
      if (event.button !== 0) return;
      manual();
      const population = populationAt(event);
      const band =
        event.pointerType !== 'touch' || current.current.touchSelectionMode;
      down = {
        x: event.clientX,
        y: event.clientY,
        pointer: event.pointerId,
        band,
        population,
      };
      if (event.pointerType !== 'touch')
        populationInput.current.press(population?.agentId ?? null);
      if (band) canvas.setPointerCapture(event.pointerId);
    };
    const pointerMove = (event: PointerEvent) => {
      if (!down) {
        if (event.pointerType !== 'touch')
          populationInput.current.hover.setAgent(
            populationAt(event)?.agentId ?? null
          );
        return;
      }
      if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5)
        populationInput.current.press(null);
      if (!down.band) return;
      const overlay = bandOverlayRef?.current,
        rect = canvas.getBoundingClientRect();
      if (overlay && current.current.onBandSelect) {
        overlay.style.display = 'block';
        overlay.style.left = `${Math.min(down.x, event.clientX) - rect.left}px`;
        overlay.style.top = `${Math.min(down.y, event.clientY) - rect.top}px`;
        overlay.style.width = `${Math.abs(down.x - event.clientX)}px`;
        overlay.style.height = `${Math.abs(down.y - event.clientY)}px`;
      }
    };
    const finish = (event: PointerEvent) => {
      fingers.delete(event.pointerId);
      const start = down;
      down = null;
      if (bandOverlayRef?.current)
        bandOverlayRef.current.style.display = 'none';
      populationInput.current.press(null);
      if (!start) return;
      if (canvas.hasPointerCapture(start.pointer))
        canvas.releasePointerCapture(start.pointer);
      if (event.type === 'pointercancel') return;
      if (Math.hypot(start.x - event.clientX, start.y - event.clientY) < 5) {
        const project =
          start.population &&
          populationInput.current.tileProjects.get(start.population.id);
        if (
          project &&
          !current.current.layout.zones.find(zone => zone.id === project)
            ?.isAggregate
        )
          populationInput.current.onDrillProject(project);
        else current.current.onBackground();
      } else if (start.band) {
        const rect = canvas.getBoundingClientRect();
        camera.updateMatrixWorld();
        const project = (point: { x: number; y: number }) => {
          scratch.point.set(point.x, 0.65, point.y).project(camera);
          return {
            x: ((scratch.point.x + 1) * rect.width) / 2,
            y: ((1 - scratch.point.y) * rect.height) / 2,
          };
        };
        const layout = current.current.layout;
        // Pick in the same screen rectangle the operator drew. A world-axis
        // bounding box would catch neighboring Agents after orbiting the camera.
        const projected = {
          ...layout,
          pieces: layout.pieces.map(piece => ({ ...piece, ...project(piece) })),
          delegationUnits: layout.delegationUnits.map(unit => ({
            ...unit,
            ...project(unit),
          })),
          zones: layout.zones.map(zone => {
            const center = {
              x: zone.rect.x + zone.rect.width / 2,
              y: zone.rect.y + zone.rect.height / 2,
            };
            const screen = project(center),
              edge = project({ x: center.x + zone.radius, y: center.y });
            const radius = Math.hypot(edge.x - screen.x, edge.y - screen.y);
            return {
              ...zone,
              radius,
              rect: {
                x: screen.x - radius,
                y: screen.y - radius,
                width: radius * 2,
                height: radius * 2,
              },
            };
          }),
        };
        current.current.onBandSelect?.(
          {
            x: Math.min(start.x, event.clientX) - rect.left,
            y: Math.min(start.y, event.clientY) - rect.top,
            width: Math.abs(event.clientX - start.x),
            height: Math.abs(event.clientY - start.y),
          },
          projected
        );
      }
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      manual();
      const control = rig.current;
      if (!control) return;
      if (event.ctrlKey || event.metaKey) {
        // dollyToCursor is handled by CameraControls' native wheel path.
        control.mouseButtons.wheel = ACTION.DOLLY;
      } else {
        control.mouseButtons.wheel = ACTION.NONE;
        const unitsPerPixel = control.distance / Math.max(1, size.height);
        void control.truck(
          -event.deltaX * unitsPerPixel,
          event.deltaY * unitsPerPixel,
          !reduced
        );
      }
      invalidate();
    };
    const leave = () => {
      if (!down) populationInput.current.hover.setAgent(null);
    };
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('pointermove', pointerMove);
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
    canvas.addEventListener('wheel', wheel, { passive: false, capture: true });
    return () => {
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', finish);
      canvas.removeEventListener('pointercancel', finish);
      canvas.removeEventListener('wheel', wheel, true);
    };
  }, [
    bandOverlayRef,
    camera,
    gl,
    invalidate,
    manual,
    reduced,
    scratch,
    size.height,
  ]);
  return (
    <CameraControls
      ref={rig}
      makeDefault
      minPolarAngle={0.02}
      maxPolarAngle={1.25}
      minDistance={4}
      maxDistance={700}
      smoothTime={reduced ? 0 : 0.16}
      mouseButtons={buttons}
      touches={touchSelectionMode ? { ...touches, one: ACTION.NONE } : touches}
      dollyToCursor
      onControlStart={manual}
      onUpdate={() => {
        report();
        invalidate();
      }}
    />
  );
}

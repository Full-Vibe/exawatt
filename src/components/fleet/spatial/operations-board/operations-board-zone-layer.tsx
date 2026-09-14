'use client';

/**
 * Project zones: board grid, zone plates and edges, selection emphasis, and
 * the zone label chips' world anchors. Focus recession dims plates here;
 * status lights never dim (that rule lives with the mark layers).
 */

import { Instances, Instance, Line, useCursor } from '@react-three/drei';
import {
  type ThreeEvent,
  useFrame,
} from '@react-three/fiber';
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  type ComponentRef,
} from 'react';
import * as THREE from 'three';
import {
  type SpatialBoardLayout,
  type SpatialBoardProjectZone,
  type SpatialBoardRect,
} from '@exawatt/ui-model';
import {
  useBoardFocusRecession,
} from './operations-board-field';
import {
  spatialProjectIdentityColor,
  spatialProjectZoneFill,
  type SpatialThemeSnapshot,
} from '../spatial-theme';
import {
  boardRectCenter as rectCenter,
} from './operations-board-camera';
import { mixHexColors } from '@/lib/appearance/color';
import type {
  BoardProjectEmphasis,
} from './operations-board-presentation';
import { FOCUS_RECESSION_MIX } from './operations-board-materials';
import {
  useBoardHoverSlice,
  type BoardHoverStore,
} from './operations-board-hover';

function gridGeometry(
  bounds: SpatialBoardRect,
  step: number,
  major: boolean,
  theme: SpatialThemeSnapshot
): THREE.BufferGeometry {
  const margin = 30;
  const minX = Math.floor((bounds.x - margin) / step) * step;
  const maxX = Math.ceil((bounds.x + bounds.width + margin) / step) * step;
  const minY = Math.floor((bounds.y - margin) / step) * step;
  const maxY = Math.ceil((bounds.y + bounds.height + margin) / step) * step;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const maxRadius = Math.max(Math.hypot(maxX - centerX, maxY - centerY), 1);
  const base = new THREE.Color(major ? theme.gridMajor : theme.grid);
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

export const BoardGrid = memo(function BoardGrid({
  bounds,
  theme,
}: {
  bounds: SpatialBoardRect;
  theme: SpatialThemeSnapshot;
}) {
  const minor = useMemo(
    () => gridGeometry(bounds, 2, false, theme),
    [bounds, theme]
  );
  const major = useMemo(
    () => gridGeometry(bounds, 2, true, theme),
    [bounds, theme]
  );
  useEffect(
    () => () => {
      minor.dispose();
      major.dispose();
    },
    [major, minor]
  );
  return (
    <>
      <lineSegments geometry={minor} raycast={() => null}>
        <lineBasicMaterial vertexColors transparent opacity={0.6} />
      </lineSegments>
      <lineSegments geometry={major} raycast={() => null}>
        <lineBasicMaterial vertexColors transparent opacity={0.78} />
      </lineSegments>
    </>
  );
});

/** All circular Project edges in ONE Line2 draw: per-vertex accent colors carry each
 *  Project's hue, while selection replaces identity with the theme's
 *  selection role. Concrete sRGB values enter Three's color-managed working
 *  space once. */
function ZoneEdges({
  zones,
  projectEmphasis,
  theme,
}: {
  zones: SpatialBoardProjectZone[];
  projectEmphasis: BoardProjectEmphasis;
  theme: SpatialThemeSnapshot;
}) {
  const { points, colors } = useMemo(() => {
    const points: Array<[number, number, number]> = [];
    const colors: THREE.Color[] = [];
    const hasSelection = zones.some(zone => zone.selected);
    for (const zone of zones) {
      const base = zone.selected
        ? theme.selection
        : spatialProjectIdentityColor(theme, zone.id);
      const accent = new THREE.Color(
        projectEmphasis === 'focus' && hasSelection && !zone.selected
          ? mixHexColors(base, theme.canvas, 0.42)
          : base
      );
      const center = rectCenter(zone.rect);
      const z = 0.35;
      const segments = 64;
      for (let edge = 0; edge < segments; edge += 1) {
        const from = (edge / segments) * Math.PI * 2;
        const to = ((edge + 1) / segments) * Math.PI * 2;
        points.push(
          [
            center.x + Math.cos(from) * zone.radius,
            center.y + Math.sin(from) * zone.radius,
            z,
          ],
          [
            center.x + Math.cos(to) * zone.radius,
            center.y + Math.sin(to) * zone.radius,
            z,
          ]
        );
        colors.push(accent, accent);
      }
    }
    return { points, colors };
  }, [projectEmphasis, theme, zones]);
  if (points.length === 0) return null;
  return (
    <Line
      points={points}
      vertexColors={colors}
      segments
      lineWidth={1.4}
      toneMapped={false}
      transparent
      opacity={1}
      depthWrite={false}
      raycast={() => null}
    />
  );
}

/**
 * Reviewable selected-Project emphasis. It is deliberately a sibling of the
 * shipped edge draw rather than a replacement: Project identity remains on
 * the zone edge, while selection gets the dedicated action/focus channel.
 * One selected Project means one additional Line2 draw at most.
 */
function ProjectSelectionRing({
  zone,
  treatment,
  reduced,
  theme,
}: {
  zone: SpatialBoardProjectZone;
  treatment: Exclude<BoardProjectEmphasis, 'current'>;
  reduced: boolean;
  theme: SpatialThemeSnapshot;
}) {
  const group = useRef<THREE.Group>(null);
  const line = useRef<ComponentRef<typeof Line>>(null);
  const points = useMemo(() => {
    const result: Array<[number, number, number]> = [];
    for (let index = 0; index <= 64; index += 1) {
      const angle = (index / 64) * Math.PI * 2;
      result.push([Math.cos(angle), Math.sin(angle), 0]);
    }
    return result;
  }, []);
  const center = rectCenter(zone.rect);
  const radius = zone.radius * (treatment === 'lift' ? 1.045 : 1.03);
  useFrame((state, delta) => {
    const target = group.current;
    const material = line.current?.material;
    if (!target || !material) return;
    const clamped = Math.min(delta, 0.05);
    const nextScale = reduced
      ? 1
      : THREE.MathUtils.damp(target.scale.x, 1, 12, clamped);
    const targetOpacity = treatment === 'focus' ? 0.72 : 0.88;
    const nextOpacity = reduced
      ? targetOpacity
      : THREE.MathUtils.damp(material.opacity, targetOpacity, 12, clamped);
    target.scale.setScalar(nextScale);
    material.opacity = nextOpacity;
    if (
      Math.abs(nextScale - 1) > 0.001 ||
      Math.abs(nextOpacity - targetOpacity) > 0.002
    ) {
      state.invalidate();
    }
  });
  return (
    <group
      ref={group}
      position={[center.x, center.y, 0.76]}
      scale={reduced ? 1 : 1.08}
    >
      <Line
        ref={line}
        points={points}
        color={theme.selection}
        lineWidth={treatment === 'lift' ? 2.6 : 2.1}
        toneMapped={false}
        transparent
        opacity={reduced ? (treatment === 'focus' ? 0.72 : 0.88) : 0}
        depthWrite={false}
        raycast={() => null}
        scale={radius}
      />
    </group>
  );
}

/** Mount-keyed entrance: zones fade up quickly; the parent keys this layer
 *  by semantic address so descent/ascent re-choreographs (never data ticks). */
export const ZoneLayer = memo(function ZoneLayer({
  zones,
  altitude,
  focusedProjectId,
  reduced,
  onDrillProject,
  onToggleZoneSelect,
  hover,
  projectEmphasis,
  theme,
}: {
  zones: SpatialBoardProjectZone[];
  altitude: SpatialBoardLayout['altitude'];
  focusedProjectId: string | null;
  reduced: boolean;
  onDrillProject: (projectId: string) => void;
  onToggleZoneSelect?: (zoneId: string) => void;
  hover: BoardHoverStore;
  projectEmphasis: BoardProjectEmphasis;
  theme: SpatialThemeSnapshot;
}) {
  const hoveredId = useBoardHoverSlice(hover, state => state.zoneId);
  const materialRef = useRef<THREE.MeshLambertMaterial>(null);
  const entrance = useRef(reduced ? 1 : 0);
  const plateRefs = useRef(
    new Map<string, THREE.Object3D & { color?: THREE.Color }>()
  );
  const zoneIds = useMemo(() => zones.map(zone => zone.id), [zones]);
  const recession = useBoardFocusRecession(
    zoneIds,
    altitude,
    focusedProjectId,
    reduced
  );
  const recessionScratch = useMemo(
    () => ({ a: new THREE.Color(), b: new THREE.Color() }),
    []
  );
  const hasSelectedZone = zones.some(zone => zone.selected);
  const lastRecession = useRef(new Map<string, number>());
  const geometry = useMemo(() => {
    const next = new THREE.CylinderGeometry(0.5, 0.5, 1, 64);
    next.rotateX(Math.PI / 2);
    return next;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useCursor(hoveredId != null);
  useFrame((state, delta) => {
    const material = materialRef.current;
    if (!material) return;
    // Focus recession: a neighbour's plate mixes toward the board. Sampled
    // from the shared clock so it arrives with the camera; written only when
    // it changed so a resting board costs nothing.
    const now = performance.now();
    let receding = false;
    for (const zone of zones) {
      const plate = plateRefs.current.get(zone.id);
      if (!plate?.color) continue;
      const semanticAmount = recession(zone.id, now);
      const studyAmount =
        projectEmphasis === 'focus' && hasSelectedZone && !zone.selected
          ? 0.32
          : 0;
      const amount = Math.max(semanticAmount, studyAmount);
      const previous = lastRecession.current.get(zone.id);
      if (previous !== undefined && Math.abs(previous - amount) < 0.002)
        continue;
      lastRecession.current.set(zone.id, amount);
      const base =
        hoveredId === zone.id
          ? theme.zoneHover
          : spatialProjectZoneFill(theme, zone.id);
      recessionScratch.a.set(base);
      recessionScratch.b.set(theme.canvas);
      plate.color.copy(
        recessionScratch.a.lerp(
          recessionScratch.b,
          amount * FOCUS_RECESSION_MIX
        )
      );
      if (semanticAmount > 0.001 && semanticAmount < 0.999) receding = true;
    }
    let lifting = false;
    for (const zone of zones) {
      const plate = plateRefs.current.get(zone.id);
      if (!plate) continue;
      const selectedLift = projectEmphasis === 'lift' && zone.selected;
      const targetZ = selectedLift ? 0.18 : 0;
      const targetScale = selectedLift ? 1.025 : 1;
      if (reduced) {
        plate.position.z = targetZ;
        plate.scale.set(
          zone.rect.width * targetScale,
          zone.rect.height * targetScale,
          0.62
        );
        continue;
      }
      plate.position.z = THREE.MathUtils.damp(
        plate.position.z,
        targetZ,
        12,
        Math.min(delta, 0.05)
      );
      plate.scale.x = THREE.MathUtils.damp(
        plate.scale.x,
        zone.rect.width * targetScale,
        12,
        Math.min(delta, 0.05)
      );
      plate.scale.y = THREE.MathUtils.damp(
        plate.scale.y,
        zone.rect.height * targetScale,
        12,
        Math.min(delta, 0.05)
      );
      if (
        Math.abs(plate.position.z - targetZ) > 0.001 ||
        Math.abs(plate.scale.x - zone.rect.width * targetScale) > 0.002 ||
        Math.abs(plate.scale.y - zone.rect.height * targetScale) > 0.002
      ) {
        lifting = true;
      }
    }
    if (receding || lifting) state.invalidate();
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
      <Instances geometry={geometry} limit={32} range={zones.length}>
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
              ref={(instance: THREE.Object3D | null) => {
                if (instance) plateRefs.current.set(zone.id, instance);
                else {
                  plateRefs.current.delete(zone.id);
                  lastRecession.current.delete(zone.id);
                }
              }}
              position={[center.x, center.y, 0]}
              scale={[zone.rect.width, zone.rect.height, 0.62]}
              color={
                hoveredId === zone.id
                  ? theme.zoneHover
                  : spatialProjectZoneFill(theme, zone.id)
              }
              onPointerOver={event => {
                if (!interactive) return;
                event.stopPropagation();
                lastRecession.current.delete(zone.id);
                hover.setZone(zone.id);
              }}
              onPointerOut={() => {
                lastRecession.current.delete(zone.id);
                hover.setZone(null);
              }}
              onClick={(event: ThreeEvent<MouseEvent>) => {
                if (!interactive || event.delta > 5) return;
                event.stopPropagation();
                // Shift-click toggles the zone's Agents in the multi-selection
                // (V3.2) — the same verb the zone's DOM control carries.
                if (event.shiftKey && onToggleZoneSelect) {
                  onToggleZoneSelect(zone.id);
                } else {
                  onDrillProject(zone.id);
                }
              }}
            />
          );
        })}
      </Instances>
      <ZoneEdges
        zones={zones}
        projectEmphasis={projectEmphasis}
        theme={theme}
      />
      {projectEmphasis !== 'current' &&
        zones
          .filter(zone => zone.selected)
          .map(zone => (
            <ProjectSelectionRing
              key={`project-selection:${zone.id}`}
              zone={zone}
              treatment={projectEmphasis}
              reduced={reduced}
              theme={theme}
            />
          ))}
    </>
  );
});

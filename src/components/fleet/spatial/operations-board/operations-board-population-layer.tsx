'use client';

/**
 * Aggregate population rendering above individual scale: instanced dots and
 * their status marks. Same status vocabulary as the individual layers, drawn
 * from the shared materials module so aggregation never invents a color.
 */

import {
  useFrame,
  useThree,
} from '@react-three/fiber';
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import * as THREE from 'three';
import {
  type SpatialBoardLayout,
  type SpatialBoardLens,
  type SpatialBoardPiece,
  type SpatialBoardProjectZone,
} from '@exawatt/ui-model';
import {
  STATUS_LIGHT_ACTIVE_ROTATION_SECONDS,
} from '@/components/status-light/protocol';
import {
  computePopulationDotField,
  POPULATION_STATUS_ORDER,
  type PopulationDotField,
} from './population-dots';
import {
  spatialPressureColor,
  spatialStatusColor,
  type SpatialThemeSnapshot,
} from '../spatial-theme';
import { BURN_RAMP_STEPS, noopRaycast } from './operations-board-materials';

/**
 * Quad size for a population status mark, as a multiple of the unit it marks.
 *
 * A glyph has to sit inside the HEXAGON, and a hexagon's flat edges are only
 * `0.866` of its circumradius from the centre — so the usable half-extent is
 * about `0.43 x size`, not `0.5`. The previous `1.42` was set against the
 * circle marks, which are inscribed and looked right; the check and cross
 * reach into the quad's corners and visibly overhung their hexes at every
 * aggregate tier. The glyph coordinates below share one reach so this single
 * number governs all of them.
 */
const POPULATION_MARK_SCALE = 1.2;

function PopulationStatusMarks({
  field,
  lens,
  ambient,
  theme,
}: {
  field: ReturnType<typeof computePopulationDotField>;
  lens: SpatialBoardLens;
  ambient: boolean;
  theme: SpatialThemeSnapshot;
}) {
  const invalidate = useThree(state => state.invalidate);
  const capacity = useMemo(() => {
    let size = 64;
    while (size < field.count) size *= 2;
    return size;
  }, [field.count]);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const material = useRef<THREE.ShaderMaterial>(null);
  const scratch = useMemo(() => new THREE.Object3D(), []);
  const activeCount = useMemo(() => {
    const reviewing = POPULATION_STATUS_ORDER.indexOf('reviewing');
    const working = POPULATION_STATUS_ORDER.indexOf('working');
    let count = 0;
    for (let index = 0; index < field.count; index += 1) {
      if (field.status[index] === reviewing || field.status[index] === working)
        count += 1;
    }
    return count;
  }, [field]);
  const geometry = useMemo(() => {
    const next = new THREE.PlaneGeometry(1, 1);
    next.setAttribute(
      'instanceState',
      new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1)
    );
    next.setAttribute(
      'instanceMarkColor',
      new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
    );
    return next;
  }, [capacity]);
  const shader = useMemo(
    () => ({
      uniforms: { uPhase: { value: 0 } },
      vertexShader: `
        attribute float instanceState;
        attribute vec3 instanceMarkColor;
        varying vec2 vMarkUv;
        varying float vMarkState;
        varying vec3 vMarkColor;
        void main() {
          vMarkUv = uv - 0.5;
          vMarkState = instanceState;
          vMarkColor = instanceMarkColor;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uPhase;
        varying vec2 vMarkUv;
        varying float vMarkState;
        varying vec3 vMarkColor;
        float segment(vec2 p, vec2 a, vec2 b) {
          vec2 pa = p - a;
          vec2 ba = b - a;
          float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
          return length(pa - ba * h);
        }
        void main() {
          vec2 p = vMarkUv;
          float d = length(p);
          float ink = 0.0;
          float alpha = 0.96;
          if (vMarkState < 0.5) {
            float angle = atan(p.y, p.x);
            ink = abs(d - 0.27) < 0.055 && angle < 2.55 ? 1.0 : 0.0;
            alpha = 0.54;
          } else if (vMarkState < 1.5) {
            float c = cos(uPhase);
            float s = sin(uPhase);
            vec2 rotated = mat2(c, -s, s, c) * p;
            ink = d < 0.31 && rotated.x > -0.02 ? 1.0 : 0.0;
          } else if (vMarkState < 2.5) {
            float check = min(
              segment(p, vec2(-0.23, 0.01), vec2(-0.06, -0.17)),
              segment(p, vec2(-0.06, -0.17), vec2(0.25, 0.19))
            );
            ink = check < 0.05 ? 1.0 : 0.0;
          } else if (vMarkState < 3.5) {
            ink = abs(d - 0.27) < 0.055 || d < 0.065 ? 1.0 : 0.0;
          } else {
            float cross = min(
              segment(p, vec2(-0.19, -0.19), vec2(0.19, 0.19)),
              segment(p, vec2(-0.19, 0.19), vec2(0.19, -0.19))
            );
            ink = cross < 0.05 ? 1.0 : 0.0;
          }
          if (ink < 0.5) discard;
          gl_FragColor = vec4(vMarkColor, alpha);
        }
      `,
    }),
    []
  );

  useEffect(() => () => geometry.dispose(), [geometry]);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const states = geometry.getAttribute(
      'instanceState'
    ) as THREE.InstancedBufferAttribute;
    const colors = geometry.getAttribute(
      'instanceMarkColor'
    ) as THREE.InstancedBufferAttribute;
    const stateByStatus = [3, 4, 1, 1, 0, 2] as const;
    mesh.current.count = field.count;
    for (let index = 0; index < field.count; index += 1) {
      scratch.position.set(field.x[index]!, -field.y[index]!, 0.92);
      scratch.scale.setScalar(field.size[index]! * POPULATION_MARK_SCALE);
      scratch.updateMatrix();
      mesh.current.setMatrixAt(index, scratch.matrix);
      states.setX(index, stateByStatus[field.status[index]!]!);
      const color =
        lens === 'burn'
          ? new THREE.Color(
              field.burn[index]! < 0
                ? theme.consumption.unknown
                : spatialPressureColor(theme, field.burn[index]!)
            )
          : new THREE.Color(
              spatialStatusColor(
                theme,
                POPULATION_STATUS_ORDER[field.status[index]!]!
              )
            );
      colors.setXYZ(index, color.r, color.g, color.b);
    }
    mesh.current.instanceMatrix.needsUpdate = true;
    states.needsUpdate = true;
    colors.needsUpdate = true;
    invalidate();
  }, [field, geometry, invalidate, lens, scratch, theme]);

  useFrame((frame, delta) => {
    if (!ambient || activeCount === 0 || !material.current) return;
    material.current.uniforms.uPhase!.value =
      (material.current.uniforms.uPhase!.value -
        (Math.min(delta, 0.05) * Math.PI * 2) /
          STATUS_LIGHT_ACTIVE_ROTATION_SECONDS) %
      (Math.PI * 2);
    frame.invalidate();
  });

  if (field.count === 0) return null;
  return (
    <instancedMesh
      key={capacity}
      ref={mesh}
      args={[geometry, undefined, capacity]}
      frustumCulled={false}
      raycast={noopRaycast}
      renderOrder={2}
    >
      <shaderMaterial
        ref={material}
        args={[shader]}
        transparent
        depthWrite={false}
      />
    </instancedMesh>
  );
}
/**
 * Demo-scale population field (V3.1): every aggregate piece expands into
 * per-agent status dots packed inside its zone, drawn as ONE InstancedMesh
 * for the whole board. No per-agent React elements or DOM labels; zone DOM
 * controls remain the interaction and exact-count owners. Static at rest so
 * the demand loop still parks.
 */
export const PopulationDotLayer = memo(function PopulationDotLayer({
  zones,
  pieces,
  altitude,
  reduced,
  lens,
  theme,
}: {
  zones: SpatialBoardProjectZone[];
  pieces: SpatialBoardPiece[];
  altitude: SpatialBoardLayout['altitude'];
  reduced: boolean;
  lens: SpatialBoardLens;
  theme: SpatialThemeSnapshot;
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
  const previousField = useRef<PopulationDotField | null>(null);
  const previousAltitude = useRef(altitude);
  const morph = useRef<{
    progress: number;
    fromX: Float32Array;
    fromY: Float32Array;
    fromSize: Float32Array;
  } | null>(null);
  const scratch = useMemo(() => new THREE.Object3D(), []);
  /** Palette conversion happens once per resolved snapshot, never per unit or
   * frame. Theme changes update the existing mesh's instance colors in place. */
  const burnColors = useMemo(
    () =>
      Array.from(
        { length: BURN_RAMP_STEPS + 1 },
        (_, index) =>
          new THREE.Color(spatialPressureColor(theme, index / BURN_RAMP_STEPS))
      ),
    [theme]
  );
  const burnUnknown = useMemo(
    () => new THREE.Color(theme.consumption.unknown),
    [theme]
  );
  const unitColor = useMemo(() => new THREE.Color(theme.unit), [theme]);
  const geometry = useMemo(() => {
    const next = new THREE.CylinderGeometry(0.5, 0.56, 0.2, 6);
    next.rotateX(Math.PI / 2);
    return next;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const prior = previousField.current;
    const transitioning =
      !reduced && prior !== null && previousAltitude.current !== altitude;
    if (transitioning) {
      const priorIndex = new Map<string, number>();
      for (let index = 0; index < prior.count; index++) {
        priorIndex.set(
          `${prior.zoneIds[prior.zone[index]!]}:${prior.status[index]}:${prior.ordinal[index]}`,
          index
        );
      }
      const centers = new Map(
        zones.map(zone => [
          zone.id,
          {
            x: zone.rect.x + zone.radius,
            y: zone.rect.y + zone.radius,
          },
        ])
      );
      const fromX = new Float32Array(field.count);
      const fromY = new Float32Array(field.count);
      const fromSize = new Float32Array(field.count);
      for (let index = 0; index < field.count; index++) {
        const zoneId = field.zoneIds[field.zone[index]!]!;
        const match = priorIndex.get(
          `${zoneId}:${field.status[index]}:${field.ordinal[index]}`
        );
        const center = centers.get(zoneId);
        fromX[index] =
          match === undefined
            ? (center?.x ?? field.x[index]!)
            : prior.x[match]!;
        fromY[index] =
          match === undefined
            ? (center?.y ?? field.y[index]!)
            : prior.y[match]!;
        fromSize[index] =
          match === undefined ? field.size[index]! * 0.4 : prior.size[match]!;
      }
      morph.current = { progress: 0, fromX, fromY, fromSize };
    } else {
      morph.current = null;
    }
    mesh.count = field.count;
    for (let index = 0; index < field.count; index++) {
      scratch.position.set(
        morph.current?.fromX[index] ?? field.x[index]!,
        -(morph.current?.fromY[index] ?? field.y[index]!),
        0.7
      );
      scratch.scale.setScalar(
        morph.current?.fromSize[index] ?? field.size[index]!
      );
      scratch.updateMatrix();
      mesh.setMatrixAt(index, scratch.matrix);
      // Parallel palettes, one mesh (ENG-008): the burn lens swaps the color
      // source from the D40 status protocol to the FLUX ramp — geometry,
      // packing, and instancing are untouched.
      mesh.setColorAt(
        index,
        lens === 'burn'
          ? field.burn[index]! < 0
            ? burnUnknown
            : burnColors[
                Math.round(
                  Math.max(0, Math.min(1, field.burn[index]!)) * BURN_RAMP_STEPS
                )
              ]!
          : unitColor
      );
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    previousField.current = field;
    previousAltitude.current = altitude;
    invalidate();
  }, [
    altitude,
    burnColors,
    burnUnknown,
    field,
    invalidate,
    lens,
    reduced,
    scratch,
    unitColor,
    zones,
  ]);

  useFrame((state, delta) => {
    const material = materialRef.current;
    if (!material) return;
    let animating = false;
    const activeMorph = morph.current;
    const mesh = meshRef.current;
    if (activeMorph && mesh) {
      activeMorph.progress = Math.min(
        1,
        activeMorph.progress + Math.min(delta, 0.05) * 3.8
      );
      const eased = 1 - Math.pow(1 - activeMorph.progress, 3);
      for (let index = 0; index < field.count; index++) {
        scratch.position.set(
          THREE.MathUtils.lerp(
            activeMorph.fromX[index]!,
            field.x[index]!,
            eased
          ),
          -THREE.MathUtils.lerp(
            activeMorph.fromY[index]!,
            field.y[index]!,
            eased
          ),
          0.7
        );
        scratch.scale.setScalar(
          THREE.MathUtils.lerp(
            activeMorph.fromSize[index]!,
            field.size[index]!,
            eased
          )
        );
        scratch.updateMatrix();
        mesh.setMatrixAt(index, scratch.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      animating = activeMorph.progress < 1;
      if (!animating) morph.current = null;
    }
    if (entrance.current < 1) {
      entrance.current = Math.min(
        1,
        entrance.current + Math.min(delta, 0.05) * 3.5
      );
      material.opacity = 0.92 * entrance.current;
      animating = true;
    } else {
      material.opacity = 0.92;
    }
    if (animating) state.invalidate();
  });

  if (field.count === 0) return null;
  return (
    <>
      <instancedMesh
        key={capacity}
        ref={meshRef}
        args={[geometry, undefined, capacity]}
        frustumCulled={false}
        raycast={noopRaycast}
        renderOrder={1}
      >
        <meshBasicMaterial
          ref={materialRef}
          toneMapped={false}
          transparent
          opacity={reduced ? 0.92 : 0}
          depthWrite={false}
        />
      </instancedMesh>
      {/* Very-far agglomeration preserves D40 shape and exact mass without
          per-agent ambient motion; individual Active hexes own visible work. */}
      <PopulationStatusMarks
        field={field}
        lens={lens}
        ambient={false}
        theme={theme}
      />
    </>
  );
});

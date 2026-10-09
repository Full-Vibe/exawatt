'use client';

import {
  Component,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { CameraControls, Environment, Lightformer } from '@react-three/drei';
import * as THREE from 'three';
import { STATUS_LIGHT_META } from '@/components/status-light/protocol';
import { usePrefersReducedMotion } from '@/lib/motion/use-prefers-reduced-motion';
import { createAmbientFrameScheduler } from '@/components/fleet/spatial/operations-board/operations-board-ambient';
import {
  SITES,
  RADIUS,
  surfaceY,
  agentAt,
  teamOf,
  type WorldStyle,
} from './model';
import { agentGeometry, bodyMaterial, teamGeometry } from './materials';
import { sampleStoryPose, type MotionPort } from './motion';
import styles from './study.module.css';

interface Props {
  kind: WorldStyle;
  count: number;
  selected: number;
  motion: MotionPort;
  links: boolean;
  scan: number;
  approved: boolean;
  wire: boolean;
  onSelect: (id: number) => void;
  onAdd: (id: number) => void;
  onProgress: (progress: number) => void;
}
const NO_RAYCAST = () => {};
const UP = new THREE.Vector3(0, 1, 0);
const COLORS = {
  active: '#d8e8ff',
  'needs-you': '#ffa46c',
  result: '#a1eeaa',
  fault: '#ff697b',
  off: '#606976',
};
const TEAM_COLORS = ['#90baff', '#c1a3f3', '#91d4d5'];
class WorldBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className={styles.fallback}>
        3D isn’t available here. Open Visual lab for the accessible agent list.
      </div>
    ) : (
      this.props.children
    );
  }
}

const Territory = memo(function Territory({
  kind,
  count,
  wire,
}: Pick<Props, 'kind' | 'count' | 'wire'>) {
  const geometry = useMemo(
    () => [0, 1, 2].map(team => teamGeometry(team, 0)),
    []
  );
  const meshes = useRef<(THREE.Mesh | null)[]>([]);
  const getMeshes = useCallback(() => meshes.current, []);
  const transition = useRef({
    elapsed: 1,
    from: [] as Float32Array[],
    to: [] as Float32Array[],
  });
  const reduced = usePrefersReducedMotion();
  const invalidate = useThree(s => s.invalidate);
  useEffect(() => {
    const flight = transition.current;
    flight.elapsed = 0;
    flight.from = [];
    flight.to = [];
    for (let i = 0; i < 3; i++) {
      const geo = getMeshes()[i]?.geometry;
      if (!geo) continue;
      flight.from.push(new Float32Array(geo.attributes.position.array));
      const target = teamGeometry(i, count);
      flight.to.push(new Float32Array(target.attributes.position.array));
      target.dispose();
    }
    invalidate();
  }, [count, invalidate, getMeshes]);
  useEffect(() => () => geometry.forEach(g => g.dispose()), [geometry]);
  useFrame((state, delta) => {
    const flight = transition.current;
    if (flight.elapsed >= 1) return;
    flight.elapsed = reduced
      ? 1
      : Math.min(1, flight.elapsed + Math.min(delta, 0.05) / 0.8);
    const t = 1 - Math.pow(1 - flight.elapsed, 3);
    for (let i = 0; i < 3; i++) {
      const geo = getMeshes()[i]?.geometry;
      if (!geo || !flight.to[i]) continue;
      const positions = geo.attributes.position;
      for (let j = 0; j < positions.array.length; j++)
        positions.array[j] = THREE.MathUtils.lerp(
          flight.from[i][j],
          flight.to[i][j],
          t
        );
      positions.needsUpdate = true;
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
    }
    if (flight.elapsed < 1) state.invalidate();
  });
  return (
    <>
      {geometry.map((geo, i) => (
        <mesh
          key={i}
          ref={el => {
            meshes.current[i] = el;
          }}
          geometry={geo}
          raycast={NO_RAYCAST}
        >
          <meshPhysicalMaterial
            color={
              kind === 'acrylic'
                ? TEAM_COLORS[i]
                : kind === 'mercury'
                  ? '#333c49'
                  : '#293f59'
            }
            metalness={kind === 'mercury' ? 0.92 : 0.32}
            roughness={kind === 'mercury' ? 0.23 : 0.3}
            clearcoat={1}
            clearcoatRoughness={0.14}
            wireframe={wire}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </>
  );
});

const Agents = memo(function Agents({
  kind,
  count,
  selected,
  approved,
  wire,
  motion,
}: Pick<
  Props,
  'kind' | 'count' | 'selected' | 'approved' | 'wire' | 'motion'
>) {
  const bodies = useRef<THREE.InstancedMesh>(null),
    hearts = useRef<THREE.InstancedMesh>(null),
    sockets = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => agentGeometry(kind), [kind]);
  const material = useMemo(() => bodyMaterial(kind, wire), [kind, wire]);
  const statuses = useMemo(
    () => SITES.map(site => agentAt(site.id, approved).state),
    [approved]
  );
  const reduced = usePrefersReducedMotion();
  const invalidate = useThree(s => s.invalidate);
  const cache = useRef({
    dummy: new THREE.Object3D(),
    normal: new THREE.Vector3(),
    color: new THREE.Color(),
    sizes: new Float32Array(SITES.length),
    fromSizes: new Float32Array(SITES.length),
    countElapsed: 1,
    phase: 0,
    emphasis: 0,
    teamEmphasis: 0,
  });
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    cache.current.fromSizes.set(cache.current.sizes);
    cache.current.countElapsed = 0;
  }, [count]);
  useEffect(() => {
    invalidate();
  }, [count, kind, selected, approved, wire, invalidate]);
  useFrame((state, delta) => {
    if (!bodies.current || !hearts.current || !sockets.current) return;
    const c = cache.current;
    c.phase += Math.min(delta, 0.05);
    c.countElapsed = reduced
      ? 1
      : Math.min(1, c.countElapsed + Math.min(delta, 0.05) / 0.8);
    const growth = 1 - Math.pow(1 - c.countElapsed, 3);
    const input = motion.read();
    const emphasis = input.mode === 'lab' && input.focus === 'agent' ? 1 : 0;
    c.emphasis = reduced
      ? emphasis
      : THREE.MathUtils.damp(c.emphasis, emphasis, 8, delta);
    const teamEmphasis = input.mode === 'lab' && input.focus === 'team' ? 1 : 0;
    c.teamEmphasis = reduced
      ? teamEmphasis
      : THREE.MathUtils.damp(c.teamEmphasis, teamEmphasis, 8, delta);
    let moving =
      Math.abs(c.emphasis - emphasis) > 0.001 ||
      Math.abs(c.teamEmphasis - teamEmphasis) > 0.001;
    for (let i = 0; i < SITES.length; i++) {
      const site = SITES[i],
        want = i < count ? 1 : 0;
      c.sizes[i] = THREE.MathUtils.lerp(c.fromSizes[i], want, growth);
      if (Math.abs(c.sizes[i] - want) > 0.001) moving = true;
      const scale = Math.max(0.00001, c.sizes[i]);
      c.normal.set(site.x, site.y + RADIUS, site.z).normalize();
      c.dummy.quaternion.setFromUnitVectors(UP, c.normal);
      c.dummy.rotateY((i % 3) * 0.45 + 0.25);
      c.dummy.position.set(site.x, site.y + 0.62, site.z);
      c.dummy.scale.setScalar(scale);
      c.dummy.updateMatrix();
      bodies.current.setMatrixAt(i, c.dummy.matrix);
      const status = statuses[i];
      const strength =
        (i === selected ? 1 : 1 - c.emphasis * 0.88) *
        (teamOf(i) === teamOf(selected) ? 1 : 1 - c.teamEmphasis * 0.75);
      c.color.set(kind === 'acrylic' ? TEAM_COLORS[teamOf(i)] : '#ffffff');
      c.color.multiplyScalar(strength);
      bodies.current.setColorAt(i, c.color);
      // State has physical structure: one working core, paired attention,
      // stacked results, or fractured fault shards; rest is unlit.
      const pieces =
        status === 'off'
          ? 0
          : status === 'active'
            ? 1
            : status === 'needs-you'
              ? 2
              : 3;
      for (let part = 0; part < 3; part++) {
        const visible = part < pieces ? scale : 0.00001;
        const offset = (part - (pieces - 1) / 2) * 0.11;
        c.dummy.position.set(
          site.x +
            (status === 'needs-you'
              ? offset
              : status === 'fault'
                ? offset * 0.7
                : 0),
          site.y +
            (kind === 'mercury' ? 1.075 : 0.66) +
            (status === 'result' || status === 'fault' ? offset : 0),
          site.z
        );
        c.dummy.scale.set(
          visible * (kind === 'mercury' ? 0.085 : 0.035),
          visible *
            (kind === 'mercury'
              ? 0.012
              : status === 'active'
                ? 0.24
                : status === 'needs-you'
                  ? 0.13
                  : 0.04),
          visible * 0.035
        );
        c.dummy.updateMatrix();
        hearts.current.setMatrixAt(i * 3 + part, c.dummy.matrix);
        c.color.set(COLORS[status]).multiplyScalar(strength);
        hearts.current.setColorAt(i * 3 + part, c.color);
      }
      c.dummy.position.set(site.x, site.y + 0.025, site.z);
      c.dummy.rotateX(Math.PI / 2);
      c.dummy.scale.setScalar(scale * (i === selected ? 1.1 : 1));
      c.dummy.updateMatrix();
      sockets.current.setMatrixAt(i, c.dummy.matrix);
      c.color
        .set(COLORS[status])
        .multiplyScalar(i === selected ? 0.9 : 0.3 * strength);
      sockets.current.setColorAt(i, c.color);
    }
    bodies.current.instanceMatrix.needsUpdate = true;
    hearts.current.instanceMatrix.needsUpdate = true;
    sockets.current.instanceMatrix.needsUpdate = true;
    if (bodies.current.instanceColor)
      bodies.current.instanceColor.needsUpdate = true;
    if (hearts.current.instanceColor)
      hearts.current.instanceColor.needsUpdate = true;
    if (sockets.current.instanceColor)
      sockets.current.instanceColor.needsUpdate = true;
    if (moving) state.invalidate();
  });
  return (
    <>
      <instancedMesh
        ref={bodies}
        args={[geometry, material, SITES.length]}
        raycast={NO_RAYCAST}
        frustumCulled={false}
      />
      <instancedMesh
        ref={hearts}
        args={[undefined, undefined, SITES.length * 3]}
        raycast={NO_RAYCAST}
        frustumCulled={false}
      >
        <octahedronGeometry args={[1, 0]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh
        ref={sockets}
        args={[undefined, undefined, SITES.length]}
        raycast={NO_RAYCAST}
        frustumCulled={false}
      >
        <torusGeometry args={[0.48, 0.014, 6, 48]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <AgentSignal selected={selected} approved={approved} />
    </>
  );
});

function AgentSignal({
  selected,
  approved,
}: Pick<Props, 'selected' | 'approved'>) {
  const group = useRef<THREE.Group>(null);
  const reduced = usePrefersReducedMotion();
  const scheduler = useMemo(() => createAmbientFrameScheduler(), []);
  const invalidate = useThree(s => s.invalidate);
  useEffect(() => {
    const resume = () => {
      if (!document.hidden) invalidate();
    };
    document.addEventListener('visibilitychange', resume);
    return () => document.removeEventListener('visibilitychange', resume);
  }, [invalidate]);
  const phase = useRef(0);
  const state = agentAt(selected, approved).state;
  const site = SITES[selected];
  useEffect(() => () => scheduler.dispose(), [scheduler]);
  useFrame(({ invalidate }, delta) => {
    if (!group.current || reduced || document.hidden || state !== 'active')
      return;
    phase.current += Math.min(delta, 0.1) * 0.8;
    group.current.rotation.y = phase.current;
    scheduler.request('economy', invalidate);
  });
  return (
    <group position={[site.x, site.y + 0.65, site.z]} ref={group}>
      {(state === 'active'
        ? [0]
        : state === 'needs-you'
          ? [0, Math.PI]
          : state === 'result'
            ? [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]
            : state === 'fault'
              ? [0.3, 2.1, 4.5]
              : []
      ).map((a, i) => (
        <mesh
          key={i}
          position={[
            Math.cos(a) * 0.49,
            state === 'fault' ? (i - 1) * 0.13 : 0,
            Math.sin(a) * 0.49,
          ]}
          raycast={NO_RAYCAST}
        >
          <octahedronGeometry
            args={[state === 'needs-you' ? 0.065 : 0.045, 0]}
          />
          <meshBasicMaterial color={COLORS[state]} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

function Survey({ count, scan }: { count: number; scan: number }) {
  const reduced = usePrefersReducedMotion();
  const data = useMemo(() => {
    const positions: number[] = [],
      indices: number[] = [];
    for (const site of SITES)
      for (let j = 0; j < 192; j++) {
        const theta = j * 2.399963229728653;
        const radius = Math.sqrt(j / 192) * 0.69;
        const x = site.x + Math.cos(theta) * radius,
          z = site.z + Math.sin(theta) * radius;
        positions.push(
          x,
          surfaceY(x, z) + Math.sin(x * 0.8) * Math.cos(z * 0.7) * 0.045,
          z
        );
        indices.push(site.id);
      }
    return {
      positions: new Float32Array(positions),
      indices: new Float32Array(indices),
    };
  }, []);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uCount: { value: 0 }, uScan: { value: -20 } },
        vertexShader: `attribute float aIndex; uniform float uCount; uniform float uScan; varying float vAlpha; varying float vScan; void main(){ vAlpha = aIndex < uCount ? 1.0 : 0.0; vScan=exp(-pow((position.z-uScan)*2.5,2.0)); vec4 mv=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mv; gl_PointSize=clamp(42.0/-mv.z,1.6,3.8)+vScan*1.5; }`,
        fragmentShader: `varying float vAlpha; varying float vScan; void main(){float d=length(gl_PointCoord-0.5); if(d>0.5 || vAlpha<0.1) discard; gl_FragColor=vec4(mix(vec3(0.43,0.56,0.6),vec3(0.88,0.96,0.94),vScan), (0.6+vScan*0.4)*smoothstep(0.5,0.2,d));}`,
      }),
    []
  ); // uniforms are updated below; material identity survives fleet growth.
  const materialRef = useRef(material);
  const phase = useRef(10);
  const invalidate = useThree(s => s.invalidate);
  useEffect(() => {
    materialRef.current.uniforms.uCount.value = count + 6;
    invalidate();
  }, [count, material, invalidate]);
  useEffect(() => {
    phase.current = 0;
    invalidate();
  }, [scan, invalidate]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame((state, delta) => {
    if (reduced || phase.current > 3) {
      materialRef.current.uniforms.uScan.value = -20;
      return;
    }
    phase.current += Math.min(delta, 0.05);
    materialRef.current.uniforms.uScan.value = -11 + phase.current * 8;
    state.invalidate();
  });
  return (
    <points material={material} raycast={NO_RAYCAST} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[data.positions, 3]}
        />
        <bufferAttribute attach="attributes-aIndex" args={[data.indices, 1]} />
      </bufferGeometry>
    </points>
  );
}

function ContinuousSurface({ count, wire }: { count: number; wire: boolean }) {
  const geometry = useMemo(() => {
    const vertices: number[] = [],
      normals: number[] = [];
    for (const site of SITES.slice(0, count + 6))
      for (let side = 0; side < 6; side++) {
        const points = [
          [site.x, site.z],
          ...[side, side + 1].map(i => [
            site.x + Math.cos(Math.PI / 6 + (i * Math.PI) / 3) * 0.72,
            site.z + Math.sin(Math.PI / 6 + (i * Math.PI) / 3) * 0.72,
          ]),
        ];
        for (const [x, z] of points.reverse()) {
          const y = surfaceY(x, z);
          vertices.push(x, y - 0.02, z);
          normals.push(x / RADIUS, (y + RADIUS) / RADIUS, z / RADIUS);
        }
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    return geo;
  }, [count]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} raycast={NO_RAYCAST}>
      <meshStandardMaterial
        color="#526168"
        roughness={0.65}
        metalness={0.25}
        wireframe={wire}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function Contours({ count, kind }: { count: number; kind: WorldStyle }) {
  const geometry = useMemo(() => {
    const extent =
      Math.max(...SITES.slice(0, count + 6).map(p => Math.hypot(p.x, p.z))) +
      0.7;
    const vertices: number[] = [];
    for (let radius = 0.8; radius <= extent; radius += 0.7)
      for (let j = 0; j < 160; j++) {
        for (const t of [j / 160, (j + 1) / 160]) {
          const x = Math.cos(t * Math.PI * 2) * radius,
            z = Math.sin(t * Math.PI * 2) * radius;
          vertices.push(x, surfaceY(x, z) + 0.03, z);
        }
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    return geo;
  }, [count]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments geometry={geometry} raycast={NO_RAYCAST}>
      <lineBasicMaterial
        color={kind === 'survey' ? '#687c80' : '#b0babc'}
        transparent
        opacity={kind === 'survey' ? 0.14 : 0.28}
        depthWrite={false}
      />
    </lineSegments>
  );
}

function Connections({ count, selected }: { count: number; selected: number }) {
  const geometry = useMemo(() => {
    const positions: number[] = [];
    for (let i = 1; i < count; i++) {
      const agent = agentAt(i);
      if (
        agent.parent === null ||
        (agent.parent !== selected && i !== selected)
      )
        continue;
      const a = SITES[agent.parent],
        b = SITES[i];
      for (let j = 0; j < 20; j++)
        for (const t of [j / 20, (j + 1) / 20]) {
          const x = THREE.MathUtils.lerp(a.x, b.x, t),
            z = THREE.MathUtils.lerp(a.z, b.z, t);
          positions.push(
            x,
            surfaceY(x, z) + 0.35 + Math.sin(t * Math.PI) * 0.5,
            z
          );
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3)
    );
    return geo;
  }, [count, selected]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments geometry={geometry} raycast={NO_RAYCAST}>
      <lineBasicMaterial
        color="#d4dce0"
        transparent
        opacity={0.75}
        depthWrite={false}
      />
    </lineSegments>
  );
}

type Overlay = () => Map<number, HTMLButtonElement>;
function CameraRig({
  count,
  selected,
  motion,
  overlay,
  onProgress,
}: Pick<Props, 'count' | 'selected' | 'motion' | 'onProgress'> & {
  overlay: Overlay;
}) {
  const controls = useRef<CameraControls>(null);
  const reduced = usePrefersReducedMotion();
  const invalidate = useThree(s => s.invalidate);
  const cache = useRef({
    project: new THREE.Vector3(),
    extent: new THREE.Vector3(),
    pose: { yaw: 0, pitch: 0, zoom: 1, x: 0, y: 0 },
    progress: 0,
    yaw: 0,
    pitch: 0,
    focus: 'fleet',
    count: 0,
    selected: -1,
    elapsed: 1,
    mode: 'story',
    modeElapsed: 1,
    fromLab: 0,
    lab: 0,
    from: new THREE.Vector4(0, 0, 0, 8),
    current: new THREE.Vector4(0, 0, 0, 8),
    target: new THREE.Vector4(0, 0, 0, 8),
  });
  const bounds = useMemo(() => {
    const fleet = new THREE.Box3(),
      team = new THREE.Box3();
    for (const site of SITES.slice(0, count + 3)) {
      const v = new THREE.Vector3(site.x, site.y + 0.5, site.z);
      fleet.expandByPoint(v);
      if (site.id < count && teamOf(site.id) === teamOf(selected))
        team.expandByPoint(v);
    }
    fleet.expandByScalar(0.85);
    team.expandByScalar(0.85);
    return {
      fleet: fleet.getBoundingSphere(new THREE.Sphere()),
      team: team.getBoundingSphere(new THREE.Sphere()),
    };
  }, [count, selected]);
  useEffect(() => motion.subscribe(invalidate), [motion, invalidate]);
  useEffect(() => {
    invalidate();
  }, [bounds, reduced, invalidate]);
  useFrame(({ camera, size, gl, scene }, delta) => {
    const c = controls.current;
    if (!c) return;
    const a = cache.current,
      input = motion.read();
    if (a.mode !== input.mode) {
      a.mode = input.mode;
      a.fromLab = a.lab;
      a.modeElapsed = 0;
    }
    a.modeElapsed = Math.min(1, a.modeElapsed + Math.min(delta, 0.05) / 0.8);
    a.lab = THREE.MathUtils.lerp(
      a.fromLab,
      input.mode === 'lab' ? 1 : 0,
      reduced ? 1 : 1 - Math.pow(1 - a.modeElapsed, 3)
    );
    const targetProgress = input.mode === 'story' ? input.progress : 0;
    a.progress = reduced
      ? targetProgress
      : THREE.MathUtils.damp(a.progress, targetProgress, 12, delta);
    a.yaw = reduced
      ? input.yaw
      : THREE.MathUtils.damp(a.yaw, input.yaw, 16, delta);
    a.pitch = reduced
      ? input.pitch
      : THREE.MathUtils.damp(a.pitch, input.pitch, 16, delta);
    sampleStoryPose(a.progress, a.pose);
    const focus = input.mode === 'story' ? 'fleet' : input.focus;
    const sphere = focus === 'team' ? bounds.team : bounds.fleet;
    const site = SITES[selected];
    const radius = focus === 'agent' ? 1.35 : sphere.radius;
    const fit =
      c.getDistanceToFitSphere(radius) * (size.width < 700 ? 1.02 : 1.2);
    a.target.set(
      focus === 'agent' ? site.x : sphere.center.x,
      focus === 'agent' ? site.y + 0.55 : sphere.center.y,
      focus === 'agent' ? site.z : sphere.center.z,
      fit
    );
    if (
      a.focus !== focus ||
      a.count !== count ||
      a.selected !== (focus === 'fleet' ? -1 : selected)
    ) {
      a.from.copy(a.current);
      a.elapsed = 0;
      a.focus = focus;
      a.count = count;
      a.selected = focus === 'fleet' ? -1 : selected;
    }
    a.elapsed = Math.min(1, a.elapsed + Math.min(delta, 0.05) / 0.8);
    const t = reduced ? 1 : 1 - Math.pow(1 - a.elapsed, 3);
    a.current.lerpVectors(a.from, a.target, t);
    a.current.w = Math.exp(
      THREE.MathUtils.lerp(
        Math.log(Math.max(1, a.from.w)),
        Math.log(a.target.w),
        t
      )
    );
    const distance = a.current.w * THREE.MathUtils.lerp(a.pose.zoom, 1, a.lab);
    void c.moveTo(a.current.x, a.current.y, a.current.z, false);
    void c.rotateTo(
      THREE.MathUtils.lerp(a.pose.yaw, 0.35, a.lab) + a.yaw,
      THREE.MathUtils.clamp(
        THREE.MathUtils.lerp(a.pose.pitch, 0.92, a.lab) + a.pitch,
        0.35,
        1.35
      ),
      false
    );
    void c.dollyTo(distance, false);
    // Focal offset changes composition inside a fixed canvas. It never resizes the scene.
    const worldHeight =
      2 * distance * Math.tan(THREE.MathUtils.degToRad(35 / 2));
    const px = size.width > 700 ? a.pose.x * (1 - a.lab) : 0;
    const py = THREE.MathUtils.lerp(
      size.width < 700 ? 0.38 : a.pose.y,
      size.width < 700 ? 0.23 : 0,
      a.lab
    );
    void c.setFocalOffset(
      px * worldHeight * 0.52,
      -py * worldHeight * 0.28,
      0,
      false
    );
    c.update(0);
    camera.updateMatrixWorld();
    for (const [id, el] of overlay()) {
      const p = SITES[id];
      a.project.set(p.x, p.y + (id < count ? 0.62 : 0.05), p.z).project(camera);
      if (id < count) {
        a.extent.set(p.x, p.y + 1.1, p.z).project(camera);
        const height = Math.max(
          28,
          Math.abs(a.extent.y - a.project.y) * size.height + 12
        );
        el.style.height = `${height}px`;
        el.style.width = `${Math.max(24, height * 0.7)}px`;
      }
      el.style.transform = `translate(-50%,-50%) translate(${(a.project.x * 0.5 + 0.5) * size.width}px,${(-a.project.y * 0.5 + 0.5) * size.height}px)`;
      el.style.visibility =
        a.project.z < 1 &&
        Math.abs(a.project.x) < 1 &&
        Math.abs(a.project.y) < 1
          ? 'visible'
          : 'hidden';
    }
    onProgress(a.progress);
    gl.render(scene, camera);
    if (
      a.elapsed < 1 ||
      a.modeElapsed < 1 ||
      Math.abs(a.progress - targetProgress) > 0.0001 ||
      Math.abs(a.yaw - input.yaw) > 0.0001 ||
      Math.abs(a.pitch - input.pitch) > 0.0001
    )
      invalidate();
  }, 1);
  return (
    <CameraControls
      ref={controls}
      events={false}
      minDistance={0.5}
      maxDistance={100}
    />
  );
}

export default function World(props: Props) {
  const overlay = useRef(new Map<number, HTMLButtonElement>());
  const getOverlay = useCallback(() => overlay.current, []);
  const [ready, setReady] = useState(false);
  const drag = useRef({
    active: false,
    x: 0,
    y: 0,
    startX: 0,
    startY: 0,
    moved: false,
  });
  return (
    <div
      className={styles.world}
      data-world={props.kind}
      data-ready={ready}
      onDragStart={e => e.preventDefault()}
      onPointerDown={e => {
        if (e.button !== 0 || e.pointerType === 'touch') return;
        const d = drag.current;
        d.active = true;
        d.x = d.startX = e.clientX;
        d.y = d.startY = e.clientY;
        d.moved = false;
      }}
      onPointerMove={e => {
        const d = drag.current;
        if (!d.active) return;
        if (
          !d.moved &&
          Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 4
        ) {
          d.moved = true;
          e.currentTarget.setPointerCapture(e.pointerId);
        }
        if (d.moved) {
          props.motion.orbit(
            (d.x - e.clientX) * 0.005,
            (d.y - e.clientY) * 0.003
          );
          e.preventDefault();
        }
        d.x = e.clientX;
        d.y = e.clientY;
      }}
      onPointerUp={e => {
        drag.current.active = false;
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        drag.current.active = false;
        drag.current.moved = false;
      }}
      onClickCapture={e => {
        if (drag.current.moved) {
          e.preventDefault();
          e.stopPropagation();
          drag.current.moved = false;
        }
      }}
    >
      <WorldBoundary>
        <Canvas
          aria-hidden="true"
          frameloop="demand"
          dpr={[1, 1.5]}
          camera={{ position: [5, 12, 14], fov: 35 }}
          gl={{ antialias: true, alpha: true }}
          onCreated={() => setReady(true)}
        >
          <ambientLight intensity={0.6} />
          <directionalLight
            position={[-5, 10, 5]}
            intensity={3}
            color="#eef5ff"
          />
          <directionalLight
            position={[5, 4, -6]}
            intensity={2}
            color="#a7b8e6"
          />
          <Environment resolution={256} frames={1}>
            <mesh>
              <sphereGeometry args={[40, 32, 16]} />
              <meshBasicMaterial color="#728098" side={THREE.BackSide} />
            </mesh>
            <Lightformer
              position={[-5, 5, 3]}
              rotation={[0, Math.PI / 3, 0]}
              scale={[7, 10, 1]}
              intensity={2.5}
              color="#f4f6ff"
            />
            <Lightformer
              position={[5, 3, 1]}
              rotation={[0, -Math.PI / 3, 0]}
              scale={[1, 8, 1]}
              intensity={2}
              color="#bfd9ff"
            />
            <Lightformer
              position={[0, 6, -3]}
              rotation={[Math.PI / 2, 0, 0]}
              scale={[8, 3, 1]}
              intensity={2.5}
            />
            <Lightformer
              position={[0, 1, 6]}
              rotation={[0, Math.PI, 0]}
              scale={[7, 1, 1]}
              intensity={2}
            />
          </Environment>
          {props.kind === 'survey' ? (
            <Survey count={props.count} scan={props.scan} />
          ) : props.kind === 'contour' ? (
            <ContinuousSurface count={props.count} wire={props.wire} />
          ) : (
            <Territory
              kind={props.kind}
              count={props.count}
              wire={props.wire}
            />
          )}
          {(props.kind === 'survey' || props.kind === 'contour') && (
            <Contours count={props.count} kind={props.kind} />
          )}
          <Agents
            kind={props.kind}
            count={props.count}
            selected={props.selected}
            approved={props.approved}
            wire={props.wire}
            motion={props.motion}
          />
          {props.links && (
            <Connections count={props.count} selected={props.selected} />
          )}
          <CameraRig
            count={props.count}
            selected={props.selected}
            motion={props.motion}
            overlay={getOverlay}
            onProgress={props.onProgress}
          />
        </Canvas>
      </WorldBoundary>
      <div className={styles.anchors}>
        {SITES.slice(0, Math.min(100, props.count + 3)).map(site => {
          const ghost = site.id >= props.count,
            agent = agentAt(site.id, props.approved);
          return (
            <button
              key={site.id}
              ref={el => {
                if (el) overlay.current.set(site.id, el);
                else overlay.current.delete(site.id);
              }}
              draggable={false}
              className={`${styles.anchor} ${ghost ? styles.ghost : ''} ${site.id === props.selected && !ghost ? styles.chosen : ''}`}
              data-state={agent.state}
              data-agent={ghost ? undefined : site.id}
              aria-label={
                ghost
                  ? 'Add a demo agent here'
                  : `${agent.name}, ${STATUS_LIGHT_META[agent.state].label}`
              }
              aria-pressed={ghost ? undefined : props.selected === site.id}
              onClick={() =>
                ghost ? props.onAdd(site.id) : props.onSelect(site.id)
              }
            >
              {ghost ? (
                <span className={styles.lamp}>+</span>
              ) : (
                <>
                  <span className={styles.hitRing} />
                  <span className={styles.agentLabel}>
                    {agent.name}
                    <small>{STATUS_LIGHT_META[agent.state].label}</small>
                  </span>
                </>
              )}
            </button>
          );
        })}
      </div>
      {!ready && <div className={styles.fallback}>Preparing your fleet…</div>}
    </div>
  );
}

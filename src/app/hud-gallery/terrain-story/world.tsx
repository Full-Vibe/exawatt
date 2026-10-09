'use client';

import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { CameraControls } from '@react-three/drei';
import * as THREE from 'three';
import { StatusLightMark } from '@/components/status-light/status-light';
import { STATUS_LIGHT_META } from '@/components/status-light/protocol';
import { usePrefersReducedMotion } from '@/lib/motion/use-prefers-reduced-motion';
import { SITES, RADIUS, surfaceY, agentAt, type WorldStyle } from './model';
import styles from './study.module.css';

interface Props {
  kind: WorldStyle;
  count: number;
  selected: number;
  chapter: number;
  angle: number;
  links: boolean;
  scan: number;
  approved: boolean;
  wire: boolean;
  onSelect: (id: number) => void;
  onAdd: (id: number) => void;
}
const UP = new THREE.Vector3(0, 1, 0);
const NO_RAYCAST = () => {};
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

function Terrain({
  kind,
  count,
  wire,
}: Pick<Props, 'kind' | 'count' | 'wire'>) {
  const tiles = useRef<THREE.InstancedMesh>(null);
  const stems = useRef<THREE.InstancedMesh>(null);
  const reduced = usePrefersReducedMotion();
  const cacheRef = useRef({
    dummy: new THREE.Object3D(),
    normal: new THREE.Vector3(),
    color: new THREE.Color(),
    sizes: new Float32Array(SITES.length),
    stems: new Float32Array(SITES.length),
  });
  const invalidate = useThree(s => s.invalidate);
  useEffect(() => {
    invalidate();
  }, [count, kind, wire, invalidate]);
  useFrame((state, delta) => {
    if (!tiles.current || !stems.current) return;
    const cache = cacheRef.current;
    let moving = false;
    for (let i = 0; i < SITES.length; i++) {
      const site = SITES[i];
      const want = i < count + 6 ? 1 : 0;
      cache.sizes[i] = reduced
        ? want
        : THREE.MathUtils.damp(cache.sizes[i], want, 7, delta);
      const unitWant = i < count ? 1 : 0;
      cache.stems[i] = reduced
        ? unitWant
        : THREE.MathUtils.damp(cache.stems[i], unitWant, 8, delta);
      if (
        Math.abs(cache.sizes[i] - want) > 0.001 ||
        Math.abs(cache.stems[i] - unitWant) > 0.001
      )
        moving = true;
      cache.normal.set(site.x, site.y + RADIUS, site.z).normalize();
      cache.dummy.quaternion.setFromUnitVectors(UP, cache.normal);
      cache.dummy.position.set(site.x, site.y - 0.14, site.z);
      cache.dummy.scale.setScalar(Math.max(0.0001, cache.sizes[i]));
      cache.dummy.updateMatrix();
      tiles.current.setMatrixAt(i, cache.dummy.matrix);
      cache.color.set(
        i < count
          ? wire
            ? '#575e62'
            : kind === 'terrace'
              ? '#667176'
              : '#414c51'
          : '#2c363b'
      );
      tiles.current.setColorAt(i, cache.color);
      cache.dummy.position.set(site.x, site.y + 0.11, site.z);
      cache.dummy.scale.setScalar(Math.max(0.0001, cache.stems[i]));
      cache.dummy.updateMatrix();
      stems.current.setMatrixAt(i, cache.dummy.matrix);
    }
    tiles.current.instanceMatrix.needsUpdate = true;
    if (tiles.current.instanceColor)
      tiles.current.instanceColor.needsUpdate = true;
    stems.current.instanceMatrix.needsUpdate = true;
    if (moving) state.invalidate();
  });
  return (
    <>
      <instancedMesh
        ref={tiles}
        args={[undefined, undefined, SITES.length]}
        frustumCulled={false}
        raycast={NO_RAYCAST}
        visible={kind === 'terrace'}
      >
        <cylinderGeometry
          args={[
            kind === 'contour' ? 0.737 : 0.685,
            kind === 'contour' ? 0.737 : 0.62,
            kind === 'terrace' ? 0.26 : 0.055,
            6,
          ]}
        />
        <meshStandardMaterial
          metalness={0.32}
          roughness={0.62}
          wireframe={wire}
        />
      </instancedMesh>
      <instancedMesh
        ref={stems}
        args={[undefined, undefined, SITES.length]}
        frustumCulled={false}
        raycast={NO_RAYCAST}
      >
        <cylinderGeometry args={[0.19, 0.25, 0.18, 24]} />
        <meshStandardMaterial color="#a0a8aa" roughness={0.3} metalness={0.7} />
      </instancedMesh>
    </>
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
  angle,
  chapter,
  overlay,
}: Pick<Props, 'count' | 'angle' | 'chapter'> & { overlay: Overlay }) {
  const controls = useRef<CameraControls>(null);
  const reduced = usePrefersReducedMotion();
  const project = useMemo(() => new THREE.Vector3(), []);
  const bounds = useMemo(() => {
    const box = new THREE.Box3();
    SITES.slice(0, count + 6).forEach(p => {
      box.expandByPoint(new THREE.Vector3(p.x, p.y, p.z));
    });
    box.expandByScalar(0.65);
    return box;
  }, [count]);
  const size = useThree(s => s.size);
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    c.smoothTime = reduced ? 0 : 0.45;
    // fitToBox snaps its fit axes; apply the authored orbit after fitting.
    void c.fitToBox(bounds, !reduced, {
      paddingTop: 0.15,
      paddingBottom: 0.15,
      paddingLeft: 0.15,
      paddingRight: 0.15,
    });
    void c.rotateTo(
      (angle * Math.PI) / 180 +
        (chapter === 2 ? -0.18 : chapter === 1 ? 0.18 : 0),
      chapter === 4 ? 0.62 : 0.86,
      !reduced
    );
  }, [bounds, angle, chapter, reduced, size.width, size.height]);
  useFrame(({ camera, size: viewport }) => {
    const nodes = overlay();
    for (const [id, el] of nodes) {
      const site = SITES[id];
      project.set(site.x, site.y + 0.29, site.z).project(camera);
      el.style.transform = `translate(-50%, -50%) translate(${(project.x * 0.5 + 0.5) * viewport.width}px,${(-project.y * 0.5 + 0.5) * viewport.height}px)`;
      el.style.visibility =
        project.z < 1 && Math.abs(project.x) < 1 && Math.abs(project.y) < 1
          ? 'visible'
          : 'hidden';
    }
  }, 1);
  // Positive priority owns render so projections sample CameraControls' updated camera.
  useFrame(({ gl, scene, camera }) => gl.render(scene, camera), 2);
  return (
    <CameraControls
      ref={controls}
      makeDefault
      minPolarAngle={0.25}
      maxPolarAngle={0.98}
      minDistance={3}
      maxDistance={45}
      mouseButtons={{ left: 1, middle: 0, right: 0, wheel: 0 }}
      touches={{ one: 0, two: 0, three: 0 }}
    />
  );
}

export default function World(props: Props) {
  const overlay = useRef(new Map<number, HTMLButtonElement>());
  const getOverlay = useCallback(() => overlay.current, []);
  const [ready, setReady] = useState(false);
  const reduced = usePrefersReducedMotion();
  return (
    <div className={styles.world} data-world={props.kind} data-ready={ready}>
      <WorldBoundary>
        <Canvas
          aria-hidden="true"
          frameloop="demand"
          dpr={[1, 1.5]}
          camera={{ position: [5, 12, 14], fov: 35 }}
          gl={{ antialias: true, alpha: true }}
          onCreated={() => setReady(true)}
        >
          <ambientLight intensity={1.25} />
          <directionalLight
            position={[-8, 12, 3]}
            intensity={3}
            color="#eceddf"
          />
          <directionalLight
            position={[7, 3, -7]}
            intensity={1.8}
            color="#a3b8c6"
          />
          <Terrain kind={props.kind} count={props.count} wire={props.wire} />
          {props.kind === 'contour' && (
            <ContinuousSurface count={props.count} wire={props.wire} />
          )}
          {props.kind === 'survey' && (
            <Survey count={props.count} scan={props.scan} />
          )}
          {props.kind !== 'terrace' && (
            <Contours count={props.count} kind={props.kind} />
          )}
          {props.links && (
            <Connections count={props.count} selected={props.selected} />
          )}
          <CameraRig
            count={props.count}
            angle={props.angle}
            chapter={props.chapter}
            overlay={getOverlay}
          />
        </Canvas>
      </WorldBoundary>
      <div className={styles.anchors}>
        {SITES.slice(0, Math.min(100, props.count + 3)).map(site => {
          const ghost = site.id >= props.count;
          const agent = agentAt(site.id, props.approved);
          const meta = STATUS_LIGHT_META[agent.state];
          return (
            <button
              key={site.id}
              ref={el => {
                if (el) overlay.current.set(site.id, el);
                else overlay.current.delete(site.id);
              }}
              className={`${styles.anchor} ${ghost ? styles.ghost : ''} ${site.id === props.selected && !ghost ? styles.chosen : ''}`}
              data-state={agent.state}
              data-agent={ghost ? undefined : site.id}
              aria-label={
                ghost ? 'Add a demo agent here' : `${agent.name}, ${meta.label}`
              }
              aria-pressed={ghost ? undefined : props.selected === site.id}
              onClick={() =>
                ghost ? props.onAdd(site.id) : props.onSelect(site.id)
              }
            >
              <span className={styles.lamp}>
                {ghost ? (
                  '+'
                ) : (
                  <StatusLightMark
                    state={agent.state}
                    size={props.count > 30 ? 13 : 17}
                    animated={!reduced}
                  />
                )}
              </span>
              {!ghost && (props.count <= 10 || site.id === props.selected) && (
                <span className={styles.agentLabel}>{agent.name}</span>
              )}
            </button>
          );
        })}
      </div>
      {!ready && <div className={styles.fallback}>Preparing your fleet…</div>}
    </div>
  );
}

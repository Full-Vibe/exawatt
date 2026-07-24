'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  ContactShadows,
  Environment,
  Lightformer,
  RoundedBox,
  useCursor,
} from '@react-three/drei';
import * as THREE from 'three';
import { STATUS_LIGHT_META } from '@/components/status-light/protocol';
import { createKeycapGeometry } from './keyswitch-geometry';

const ACTIVE_BLUE = STATUS_LIGHT_META.active.color;

const MATERIAL_STUDIES = [
  {
    id: 'optic',
    index: '01',
    name: 'Optic PC',
    short: 'Clear',
    description: 'Maximum transmission with crisp internal mechanics.',
    capColor: '#edf8fa',
    attenuationColor: '#d5f2f8',
    transmission: 0.98,
    roughness: 0.045,
    thickness: 0.38,
    innerOpacity: 0.035,
  },
  {
    id: 'satin',
    index: '02',
    name: 'Satin PC',
    short: 'Frosted',
    description: 'Soft diffusion closest to the Work Louder status caps.',
    capColor: '#e6eef0',
    attenuationColor: '#d8edf1',
    transmission: 0.67,
    roughness: 0.3,
    thickness: 0.9,
    innerOpacity: 0.16,
  },
  {
    id: 'smoke',
    index: '03',
    name: 'Smoke PC',
    short: 'Tinted',
    description: 'Deeper contrast and a more industrial, instrument-like read.',
    capColor: '#81939b',
    attenuationColor: '#7eb7ca',
    transmission: 0.78,
    roughness: 0.14,
    thickness: 1.08,
    innerOpacity: 0.2,
  },
] as const;

type MaterialStudy = (typeof MATERIAL_STUDIES)[number];

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

function createSpringGeometry() {
  const turns = 8.5;
  const points = Array.from({ length: 120 }, (_, index) => {
    const t = index / 119;
    const phase = t * Math.PI * 2 * turns;
    return new THREE.Vector3(
      Math.cos(phase) * 0.24,
      THREE.MathUtils.lerp(-0.31, 0.31, t),
      Math.sin(phase) * 0.24
    );
  });
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.TubeGeometry(curve, 144, 0.026, 7, false);
}

function ExposeEvalRenderer() {
  const gl = useThree(state => state.gl);
  const scene = useThree(state => state.scene);
  useEffect(() => {
    const target = window as unknown as {
      __EVAL_GL__?: THREE.WebGLRenderer;
      __EVAL_SCENE__?: THREE.Scene;
    };
    target.__EVAL_GL__ = gl;
    target.__EVAL_SCENE__ = scene;
    return () => {
      if (target.__EVAL_GL__ === gl) delete target.__EVAL_GL__;
      if (target.__EVAL_SCENE__ === scene) delete target.__EVAL_SCENE__;
    };
  }, [gl, scene]);
  return null;
}

function CameraRig() {
  const camera = useThree(state => state.camera);
  const size = useThree(state => state.size);
  useLayoutEffect(() => {
    const aspect = size.width / Math.max(size.height, 1);
    const narrowScale = Math.max(1, 1.58 / aspect);
    camera.position.set(
      7.2 * narrowScale,
      5.4 * narrowScale,
      9.4 * narrowScale
    );
    camera.lookAt(0, 0.72, 0);
    camera.updateProjectionMatrix();
  }, [camera, size.height, size.width]);
  return null;
}

function Spring({ pressed, reduced }: { pressed: boolean; reduced: boolean }) {
  const spring = useRef<THREE.Group>(null);
  const geometry = useMemo(() => createSpringGeometry(), []);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((state, delta) => {
    if (!spring.current) return;
    const target = pressed ? 0.72 : 1;
    if (reduced) {
      spring.current.scale.y = target;
      return;
    }
    spring.current.scale.y = THREE.MathUtils.damp(
      spring.current.scale.y,
      target,
      19,
      delta
    );
    if (Math.abs(spring.current.scale.y - target) > 0.001) state.invalidate();
  });

  return (
    <group ref={spring} position={[0, 0.79, 0]}>
      <mesh geometry={geometry} castShadow>
        <meshStandardMaterial
          color="#d9d5c6"
          metalness={0.92}
          roughness={0.22}
        />
      </mesh>
    </group>
  );
}

function Fastener({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0.29, z]}>
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[0.105, 0.115, 0.075, 24]} />
        <meshStandardMaterial
          color="#171b1d"
          metalness={0.86}
          roughness={0.25}
        />
      </mesh>
      <mesh position={[0, 0.041, 0]}>
        <boxGeometry args={[0.105, 0.009, 0.025]} />
        <meshBasicMaterial color="#050708" />
      </mesh>
    </group>
  );
}

function StatusLegend() {
  return (
    <group position={[0, 2.255, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh>
        <ringGeometry args={[0.235, 0.275, 48]} />
        <meshStandardMaterial
          color="#4e86ae"
          metalness={0.18}
          roughness={0.32}
        />
      </mesh>
      <mesh position={[0, 0, 0.006]} rotation={[0, 0, Math.PI / 2]}>
        <circleGeometry args={[0.205, 32, Math.PI / 2, Math.PI]} />
        <meshStandardMaterial
          color="#4e86ae"
          metalness={0.16}
          roughness={0.34}
        />
      </mesh>
      <mesh position={[0, 0, 0.012]}>
        <circleGeometry args={[0.054, 24]} />
        <meshBasicMaterial color="#b4d7e8" />
      </mesh>
    </group>
  );
}

function Keycap({ study }: { study: MaterialStudy }) {
  const geometry = useMemo(() => createKeycapGeometry(), []);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <group>
      <mesh geometry={geometry} position={[0, 1.86, 0]} castShadow>
        <meshPhysicalMaterial
          attenuationColor={study.attenuationColor}
          attenuationDistance={2.5}
          clearcoat={0.9}
          clearcoatRoughness={Math.max(0.075, study.roughness * 0.52)}
          color={study.capColor}
          depthWrite={false}
          dispersion={study.id === 'optic' ? 0.035 : 0.012}
          ior={1.49}
          opacity={0.99}
          roughness={study.roughness}
          thickness={study.thickness}
          transmission={study.transmission}
          transparent
        />
      </mesh>

      <RoundedBox
        args={[1.52, 0.56, 1.52]}
        position={[0, 1.72, 0]}
        radius={0.13}
        smoothness={5}
        scale={[1, 0.92, 1]}
      >
        <meshPhysicalMaterial
          color={study.capColor}
          depthWrite={false}
          opacity={study.innerOpacity}
          roughness={Math.min(0.48, study.roughness + 0.12)}
          side={THREE.BackSide}
          transparent
          transmission={0.15}
        />
      </RoundedBox>

      <group position={[0, 1.39, 0]}>
        <RoundedBox args={[0.45, 0.3, 0.13]} radius={0.035} smoothness={3}>
          <meshPhysicalMaterial
            color="#d9e8ea"
            opacity={0.72}
            roughness={0.25}
            transparent
            transmission={0.22}
          />
        </RoundedBox>
        <RoundedBox args={[0.13, 0.3, 0.45]} radius={0.035} smoothness={3}>
          <meshPhysicalMaterial
            color="#d9e8ea"
            opacity={0.72}
            roughness={0.25}
            transparent
            transmission={0.22}
          />
        </RoundedBox>
      </group>

      <StatusLegend />
    </group>
  );
}

function SwitchMechanism({
  pressed,
  reduced,
}: {
  pressed: boolean;
  reduced: boolean;
}) {
  const stem = useRef<THREE.Group>(null);

  useFrame((state, delta) => {
    if (!stem.current) return;
    const target = pressed ? -0.12 : 0;
    if (reduced) {
      stem.current.position.y = target;
      return;
    }
    stem.current.position.y = THREE.MathUtils.damp(
      stem.current.position.y,
      target,
      20,
      delta
    );
    if (Math.abs(stem.current.position.y - target) > 0.001) state.invalidate();
  });

  return (
    <group>
      <RoundedBox
        args={[1.48, 0.43, 1.48]}
        position={[0, 0.48, 0]}
        radius={0.12}
        smoothness={5}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial
          color="#12181c"
          metalness={0.24}
          roughness={0.38}
        />
      </RoundedBox>

      <RoundedBox
        args={[1.34, 0.45, 1.34]}
        position={[0, 0.83, 0]}
        radius={0.11}
        smoothness={5}
        castShadow
      >
        <meshPhysicalMaterial
          attenuationColor="#91b7c2"
          attenuationDistance={1.25}
          clearcoat={0.65}
          color="#9db0b6"
          depthWrite={false}
          ior={1.48}
          opacity={0.72}
          roughness={0.16}
          thickness={0.32}
          transmission={0.48}
          transparent
        />
      </RoundedBox>

      <mesh position={[-0.48, 0.67, 0]} castShadow>
        <boxGeometry args={[0.035, 0.46, 0.68]} />
        <meshStandardMaterial
          color="#b67c46"
          metalness={0.88}
          roughness={0.28}
        />
      </mesh>
      <mesh position={[0.48, 0.6, 0]} castShadow>
        <boxGeometry args={[0.035, 0.34, 0.56]} />
        <meshStandardMaterial
          color="#b67c46"
          metalness={0.88}
          roughness={0.28}
        />
      </mesh>

      <Spring pressed={pressed} reduced={reduced} />

      <group ref={stem} position={[0, 0, 0]}>
        <RoundedBox
          args={[0.48, 0.36, 0.14]}
          position={[0, 1.1, 0]}
          radius={0.035}
          smoothness={3}
          castShadow
        >
          <meshStandardMaterial
            color={ACTIVE_BLUE}
            emissive={ACTIVE_BLUE}
            emissiveIntensity={0.48}
            roughness={0.3}
          />
        </RoundedBox>
        <RoundedBox
          args={[0.14, 0.36, 0.48]}
          position={[0, 1.1, 0]}
          radius={0.035}
          smoothness={3}
          castShadow
        >
          <meshStandardMaterial
            color={ACTIVE_BLUE}
            emissive={ACTIVE_BLUE}
            emissiveIntensity={0.48}
            roughness={0.3}
          />
        </RoundedBox>
      </group>

      <mesh position={[0, 0.29, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.42, 48]} />
        <meshBasicMaterial
          color={ACTIVE_BLUE}
          opacity={0.2}
          toneMapped={false}
          transparent
        />
      </mesh>
      <mesh position={[0, 0.31, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.095, 32]} />
        <meshStandardMaterial
          color={ACTIVE_BLUE}
          emissive={ACTIVE_BLUE}
          emissiveIntensity={1.8}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

function KeySwitchAssembly({
  study,
  x,
  z,
  rotation,
  pressed,
  reduced,
  onPressedChange,
}: {
  study: MaterialStudy;
  x: number;
  z: number;
  rotation: number;
  pressed: boolean;
  reduced: boolean;
  onPressedChange: (pressed: boolean) => void;
}) {
  const cap = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);

  useFrame((state, delta) => {
    if (!cap.current) return;
    const target = pressed ? -0.18 : 0;
    if (reduced) {
      cap.current.position.y = target;
      return;
    }
    cap.current.position.y = THREE.MathUtils.damp(
      cap.current.position.y,
      target,
      18,
      delta
    );
    if (Math.abs(cap.current.position.y - target) > 0.001) state.invalidate();
  });

  return (
    <group position={[x, 0, z]} rotation={[0, rotation, 0]}>
      <RoundedBox
        args={[2.48, 0.22, 2.48]}
        position={[0, 0.13, 0]}
        radius={0.17}
        smoothness={6}
        castShadow
        receiveShadow
      >
        <meshPhysicalMaterial
          clearcoat={0.34}
          clearcoatRoughness={0.18}
          color="#8a9194"
          metalness={0.94}
          roughness={0.23}
        />
      </RoundedBox>
      <RoundedBox
        args={[2.26, 0.36, 2.26]}
        position={[0, -0.08, 0]}
        radius={0.15}
        smoothness={5}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial
          color="#171d20"
          metalness={0.5}
          roughness={0.36}
        />
      </RoundedBox>
      <RoundedBox
        args={[1.72, 0.055, 1.72]}
        position={[0, 0.255, 0]}
        radius={0.1}
        smoothness={4}
      >
        <meshStandardMaterial color="#0d1113" metalness={0.6} roughness={0.3} />
      </RoundedBox>

      <Fastener x={-0.99} z={-0.99} />
      <Fastener x={0.99} z={-0.99} />
      <Fastener x={-0.99} z={0.99} />
      <Fastener x={0.99} z={0.99} />

      <SwitchMechanism pressed={pressed} reduced={reduced} />

      <group ref={cap} name={`keyswitch-cap-${study.id}`}>
        <Keycap study={study} />
      </group>

      <mesh
        position={[0, 1.18, 0]}
        onPointerDown={event => {
          event.stopPropagation();
          onPressedChange(true);
        }}
        onPointerEnter={event => {
          event.stopPropagation();
          setHovered(true);
        }}
        onPointerLeave={() => {
          setHovered(false);
          onPressedChange(false);
        }}
        onPointerUp={event => {
          event.stopPropagation();
          onPressedChange(false);
        }}
      >
        <boxGeometry args={[2.16, 2.45, 2.16]} />
        <meshBasicMaterial
          color="#000000"
          depthWrite={false}
          opacity={0}
          transparent
        />
      </mesh>
    </group>
  );
}

function ProductScene({
  pressedId,
  onPressedChange,
}: {
  pressedId: string | null;
  onPressedChange: (id: string | null) => void;
}) {
  const reduced = useReducedMotion();
  const placements = [
    { x: -3.05, z: 0.05, rotation: 0.09 },
    { x: 0, z: -0.12, rotation: -0.025 },
    { x: 3.05, z: 0.05, rotation: -0.11 },
  ];

  return (
    <>
      <CameraRig />
      <ambientLight intensity={0.42} />
      <directionalLight intensity={3.15} position={[4.8, 7.5, 5.2]} />
      <pointLight color="#b9dded" intensity={11} position={[-5, 3.8, 2]} />

      <Environment resolution={256} frames={1} environmentIntensity={1.18}>
        <Lightformer
          color="#edf7fa"
          form="rect"
          intensity={5.5}
          position={[0, 5, -4]}
          rotation={[Math.PI / 2, 0, 0]}
          scale={[8, 3.5, 1]}
        />
        <Lightformer
          color="#81b7ca"
          form="rect"
          intensity={3}
          position={[-5, 1.8, 1]}
          rotation={[0, Math.PI / 2, 0]}
          scale={[4, 2.5, 1]}
        />
        <Lightformer
          color="#f4cfb7"
          form="rect"
          intensity={2.1}
          position={[5, 0.8, -1]}
          rotation={[0, -Math.PI / 2, 0]}
          scale={[3, 2, 1]}
        />
      </Environment>

      <group rotation={[0, -0.08, 0]}>
        {MATERIAL_STUDIES.map((study, index) => (
          <KeySwitchAssembly
            key={study.id}
            study={study}
            {...placements[index]}
            pressed={pressedId === study.id}
            reduced={reduced}
            onPressedChange={pressed =>
              onPressedChange(pressed ? study.id : null)
            }
          />
        ))}
      </group>

      <ContactShadows
        color="#00070b"
        far={5}
        frames={1}
        opacity={0.78}
        position={[0, -0.28, 0]}
        resolution={1024}
        scale={[12, 5.5]}
        blur={2.2}
      />
      <mesh position={[0, -0.3, 0]} receiveShadow>
        <boxGeometry args={[13, 0.08, 6.5]} />
        <meshPhysicalMaterial
          clearcoat={0.25}
          clearcoatRoughness={0.2}
          color="#090e11"
          metalness={0.5}
          roughness={0.26}
        />
      </mesh>
    </>
  );
}

export function KeySwitchStudy({ evalMode = false }: { evalMode?: boolean }) {
  const [pressedId, setPressedId] = useState<string | null>(null);

  return (
    <div
      className="overflow-hidden rounded-[2px] border"
      data-keyswitch-study
      data-material-count={MATERIAL_STUDIES.length}
      data-pressed-variant={pressedId ?? 'none'}
      style={{
        borderColor: 'rgba(173, 211, 224, 0.18)',
        background: '#070a0c',
      }}
    >
      <div className="relative h-[clamp(380px,48vw,600px)] min-h-[380px]">
        <Canvas
          aria-hidden="true"
          camera={{ fov: 28, near: 0.1, far: 100, position: [7.2, 5.4, 9.4] }}
          dpr={[1, 2]}
          frameloop="demand"
          gl={{
            alpha: false,
            antialias: true,
            powerPreference: 'high-performance',
            preserveDrawingBuffer: evalMode,
          }}
          onPointerMissed={() => setPressedId(null)}
        >
          <color attach="background" args={['#070a0c']} />
          {evalMode && <ExposeEvalRenderer />}
          <ProductScene pressedId={pressedId} onPressedChange={setPressedId} />
        </Canvas>

        <div className="pointer-events-none absolute left-5 top-5 flex items-center gap-2.5 sm:left-7 sm:top-7">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              background: ACTIVE_BLUE,
              boxShadow: `0 0 14px ${ACTIVE_BLUE}`,
            }}
          />
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-slate-300/70 sm:text-[10px]">
            Material study · PC / POM / POK
          </span>
        </div>

        <p className="pointer-events-none absolute bottom-5 right-5 font-mono text-[9px] uppercase tracking-[0.16em] text-slate-400/60 sm:bottom-7 sm:right-7">
          Hold a specimen to inspect travel
        </p>
      </div>

      <div
        aria-label="Keyswitch material studies"
        className="grid grid-cols-1 border-t sm:grid-cols-3"
        role="group"
        style={{ borderColor: 'rgba(173, 211, 224, 0.15)' }}
      >
        {MATERIAL_STUDIES.map((study, index) => {
          const pressed = pressedId === study.id;
          return (
            <button
              key={study.id}
              aria-pressed={pressed}
              className="group flex min-h-[112px] items-start gap-4 border-b px-5 py-5 text-left outline-none transition-[background-color] duration-200 last:border-b-0 focus-visible:bg-sky-100/[0.07] sm:border-b-0 sm:border-r sm:last:border-r-0"
              data-keyswitch-variant={study.id}
              onBlur={() => setPressedId(null)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  setPressedId(study.id);
                }
              }}
              onKeyUp={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  setPressedId(null);
                }
              }}
              onPointerDown={() => setPressedId(study.id)}
              onPointerLeave={() => setPressedId(null)}
              onPointerUp={() => setPressedId(null)}
              style={{
                background: pressed
                  ? 'rgba(156, 213, 254, 0.075)'
                  : 'rgba(10, 15, 18, 0.82)',
                borderColor: 'rgba(173, 211, 224, 0.15)',
              }}
              type="button"
            >
              <span className="mt-0.5 font-mono text-[9px] tracking-[0.18em] text-sky-200/45">
                {study.index}
              </span>
              <span className="flex min-w-0 flex-col gap-1.5">
                <span className="flex items-baseline gap-2">
                  <span className="font-display text-sm font-semibold text-slate-100">
                    {study.name}
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-sky-200/55">
                    {study.short}
                  </span>
                </span>
                <span className="max-w-[32ch] text-xs leading-relaxed text-slate-400">
                  {study.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

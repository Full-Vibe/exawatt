'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  ContactShadows,
  Environment,
  Lightformer,
  OrbitControls,
  RoundedBox,
  useCursor,
} from '@react-three/drei';
import * as THREE from 'three';
import { STATUS_LIGHT_META } from '@/components/status-light/protocol';
import { createKeycapGeometry } from './keyswitch-geometry';

const ACTIVE_BLUE = STATUS_LIGHT_META.active.color;

type CapShape = 'soft-square' | 'sculpted' | 'low-profile' | 'pillow';

interface KeySwitchVariant {
  id: string;
  index: string;
  name: string;
  short: string;
  description: string;
  materials: string;
  capShape: CapShape;
  capSize: [number, number, number];
  capY: number;
  capRadius: number;
  capColor: string;
  attenuationColor: string;
  transmission: number;
  roughness: number;
  thickness: number;
  innerOpacity: number;
  plateColor: string;
  plateMetalness: number;
  plateRoughness: number;
  frameColor: string;
  frameMetalness: number;
  housingColor: string;
  housingTransmission: number;
  stemColor: string;
  hardwareColor: string;
  contactColor: string;
  background: string;
  ground: string;
  keyLight: string;
  fillLight: string;
  rimLight: string;
  ambientIntensity: number;
  keyIntensity: number;
  fillIntensity: number;
  environmentIntensity: number;
  camera: [number, number, number];
  target: [number, number, number];
  objectRotation: number;
}

const KEYSWITCH_VARIANTS: readonly KeySwitchVariant[] = [
  {
    id: 'reference-frost',
    index: '01',
    name: 'Reference Frost',
    short: 'Closest match',
    description:
      'Low frosted PC with a soft square edge, white plate, and visible clear switch shell.',
    materials: 'Frosted PC · white aluminum · POM / POK',
    capShape: 'soft-square',
    capSize: [1.98, 0.68, 1.98],
    capY: 1.82,
    capRadius: 0.21,
    capColor: '#edf2f3',
    attenuationColor: '#d7e9ed',
    transmission: 0.76,
    roughness: 0.26,
    thickness: 0.72,
    innerOpacity: 0.15,
    plateColor: '#e7e9e7',
    plateMetalness: 0.36,
    plateRoughness: 0.24,
    frameColor: '#d3dadd',
    frameMetalness: 0.72,
    housingColor: '#c3cfd2',
    housingTransmission: 0.5,
    stemColor: '#a9cfe0',
    hardwareColor: '#171a1c',
    contactColor: '#b7783f',
    background: '#91bceb',
    ground: '#85b3e2',
    keyLight: '#f7fcfd',
    fillLight: '#a8d5f4',
    rimLight: '#f6e8de',
    ambientIntensity: 0.28,
    keyIntensity: 2.65,
    fillIntensity: 9,
    environmentIntensity: 1.05,
    camera: [4.7, 3.65, 5.8],
    target: [0, 0.92, 0],
    objectRotation: -0.12,
  },
  {
    id: 'optic-clear',
    index: '02',
    name: 'Optic Clear',
    short: 'Sculpted',
    description:
      'A tall dished optical cap that exposes the spring, active stem, and copper contacts.',
    materials: 'Optic PC · bead-blast silver · blue POK',
    capShape: 'sculpted',
    capSize: [1.92, 0.86, 1.92],
    capY: 1.86,
    capRadius: 0.16,
    capColor: '#e9f7fa',
    attenuationColor: '#d4f1f7',
    transmission: 0.97,
    roughness: 0.05,
    thickness: 0.4,
    innerOpacity: 0.035,
    plateColor: '#c5d0d4',
    plateMetalness: 0.94,
    plateRoughness: 0.18,
    frameColor: '#69787e',
    frameMetalness: 0.88,
    housingColor: '#a5bac0',
    housingTransmission: 0.68,
    stemColor: ACTIVE_BLUE,
    hardwareColor: '#101416',
    contactColor: '#c88448',
    background: '#c1e1eb',
    ground: '#a9cfdb',
    keyLight: '#f5fcfd',
    fillLight: '#78c3de',
    rimLight: '#d5edf4',
    ambientIntensity: 0.24,
    keyIntensity: 2.8,
    fillIntensity: 10,
    environmentIntensity: 1.32,
    camera: [4.35, 3.75, 6.25],
    target: [0, 0.95, 0],
    objectRotation: 0.1,
  },
  {
    id: 'smoke-low',
    index: '03',
    name: 'Smoke Low',
    short: 'Low profile',
    description:
      'A short smoked cap on graphite hardware, cut by cool edge light and a warm metal rim.',
    materials: 'Smoke PC · graphite aluminum · black POM',
    capShape: 'low-profile',
    capSize: [2.04, 0.48, 1.92],
    capY: 1.75,
    capRadius: 0.14,
    capColor: '#657a84',
    attenuationColor: '#6199ad',
    transmission: 0.67,
    roughness: 0.17,
    thickness: 1.08,
    innerOpacity: 0.2,
    plateColor: '#263137',
    plateMetalness: 0.86,
    plateRoughness: 0.2,
    frameColor: '#11171a',
    frameMetalness: 0.76,
    housingColor: '#4c626b',
    housingTransmission: 0.42,
    stemColor: '#75bdd5',
    hardwareColor: '#080b0d',
    contactColor: '#ae7040',
    background: '#070b0e',
    ground: '#080d10',
    keyLight: '#ecfaff',
    fillLight: '#6eabc0',
    rimLight: '#e6a37e',
    ambientIntensity: 0.24,
    keyIntensity: 4.4,
    fillIntensity: 18,
    environmentIntensity: 1.4,
    camera: [5.15, 2.85, 5.9],
    target: [0, 0.83, 0],
    objectRotation: -0.2,
  },
  {
    id: 'opal-pillow',
    index: '04',
    name: 'Opal Pillow',
    short: 'Soft radius',
    description:
      'Milky opal geometry with a broad pillow radius and champagne-finished mounting plate.',
    materials: 'Opal PC · champagne aluminum · ivory POM',
    capShape: 'pillow',
    capSize: [2.02, 0.62, 2.02],
    capY: 1.8,
    capRadius: 0.26,
    capColor: '#eee7df',
    attenuationColor: '#f2ddcd',
    transmission: 0.54,
    roughness: 0.37,
    thickness: 0.92,
    innerOpacity: 0.18,
    plateColor: '#c7aa89',
    plateMetalness: 0.9,
    plateRoughness: 0.24,
    frameColor: '#706257',
    frameMetalness: 0.68,
    housingColor: '#d6c7ba',
    housingTransmission: 0.34,
    stemColor: '#c6a47e',
    hardwareColor: '#29231f',
    contactColor: '#a96e3d',
    background: '#c7b19d',
    ground: '#ac9683',
    keyLight: '#fff4e7',
    fillLight: '#e2b18d',
    rimLight: '#c9deea',
    ambientIntensity: 0.3,
    keyIntensity: 2.4,
    fillIntensity: 8,
    environmentIntensity: 1.02,
    camera: [4.8, 3.4, 5.75],
    target: [0, 0.9, 0],
    objectRotation: 0.16,
  },
  {
    id: 'original-optic',
    index: '05',
    name: 'Optic PC',
    short: 'Original clear',
    description:
      'The original maximum-transmission study with crisp internal mechanics and a dark studio.',
    materials: 'Original study · optic PC · silver aluminum',
    capShape: 'sculpted',
    capSize: [1.92, 0.86, 1.92],
    capY: 1.86,
    capRadius: 0.16,
    capColor: '#edf8fa',
    attenuationColor: '#d5f2f8',
    transmission: 0.98,
    roughness: 0.045,
    thickness: 0.38,
    innerOpacity: 0.035,
    plateColor: '#8a9194',
    plateMetalness: 0.94,
    plateRoughness: 0.23,
    frameColor: '#171d20',
    frameMetalness: 0.5,
    housingColor: '#9db0b6',
    housingTransmission: 0.48,
    stemColor: ACTIVE_BLUE,
    hardwareColor: '#171b1d',
    contactColor: '#b67c46',
    background: '#070a0c',
    ground: '#090e11',
    keyLight: '#edf7fa',
    fillLight: '#81b7ca',
    rimLight: '#f4cfb7',
    ambientIntensity: 0.42,
    keyIntensity: 3.15,
    fillIntensity: 11,
    environmentIntensity: 1.18,
    camera: [4.8, 3.55, 6.1],
    target: [0, 0.9, 0],
    objectRotation: 0.09,
  },
  {
    id: 'original-satin',
    index: '06',
    name: 'Satin PC',
    short: 'Original frost',
    description:
      'The original soft-diffusion study, tuned closest to the frosted Work Louder status caps.',
    materials: 'Original study · satin PC · silver aluminum',
    capShape: 'sculpted',
    capSize: [1.92, 0.86, 1.92],
    capY: 1.86,
    capRadius: 0.16,
    capColor: '#e6eef0',
    attenuationColor: '#d8edf1',
    transmission: 0.67,
    roughness: 0.3,
    thickness: 0.9,
    innerOpacity: 0.16,
    plateColor: '#8a9194',
    plateMetalness: 0.94,
    plateRoughness: 0.23,
    frameColor: '#171d20',
    frameMetalness: 0.5,
    housingColor: '#9db0b6',
    housingTransmission: 0.48,
    stemColor: ACTIVE_BLUE,
    hardwareColor: '#171b1d',
    contactColor: '#b67c46',
    background: '#070a0c',
    ground: '#090e11',
    keyLight: '#edf7fa',
    fillLight: '#81b7ca',
    rimLight: '#f4cfb7',
    ambientIntensity: 0.42,
    keyIntensity: 3.15,
    fillIntensity: 11,
    environmentIntensity: 1.18,
    camera: [4.8, 3.55, 6.1],
    target: [0, 0.9, 0],
    objectRotation: -0.025,
  },
  {
    id: 'original-smoke',
    index: '07',
    name: 'Smoke PC',
    short: 'Original tint',
    description:
      'The original tinted study with deeper contrast and an industrial instrument-like read.',
    materials: 'Original study · smoke PC · silver aluminum',
    capShape: 'sculpted',
    capSize: [1.92, 0.86, 1.92],
    capY: 1.86,
    capRadius: 0.16,
    capColor: '#81939b',
    attenuationColor: '#7eb7ca',
    transmission: 0.78,
    roughness: 0.14,
    thickness: 1.08,
    innerOpacity: 0.2,
    plateColor: '#8a9194',
    plateMetalness: 0.94,
    plateRoughness: 0.23,
    frameColor: '#171d20',
    frameMetalness: 0.5,
    housingColor: '#9db0b6',
    housingTransmission: 0.48,
    stemColor: ACTIVE_BLUE,
    hardwareColor: '#171b1d',
    contactColor: '#b67c46',
    background: '#070a0c',
    ground: '#090e11',
    keyLight: '#edf7fa',
    fillLight: '#81b7ca',
    rimLight: '#f4cfb7',
    ambientIntensity: 0.42,
    keyIntensity: 3.15,
    fillIntensity: 11,
    environmentIntensity: 1.18,
    camera: [4.8, 3.55, 6.1],
    target: [0, 0.9, 0],
    objectRotation: -0.11,
  },
];

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
  const camera = useThree(state => state.camera);
  useEffect(() => {
    const target = window as unknown as {
      __EVAL_GL__?: THREE.WebGLRenderer;
      __EVAL_SCENE__?: THREE.Scene;
      __EVAL_KEYSWITCH_CAMERA__?: THREE.Camera;
    };
    target.__EVAL_GL__ = gl;
    target.__EVAL_SCENE__ = scene;
    target.__EVAL_KEYSWITCH_CAMERA__ = camera;
    return () => {
      if (target.__EVAL_GL__ === gl) delete target.__EVAL_GL__;
      if (target.__EVAL_SCENE__ === scene) delete target.__EVAL_SCENE__;
      if (target.__EVAL_KEYSWITCH_CAMERA__ === camera) {
        delete target.__EVAL_KEYSWITCH_CAMERA__;
      }
    };
  }, [camera, gl, scene]);
  return null;
}

function OrbitCamera({
  variant,
  resetToken,
  reduced,
}: {
  variant: KeySwitchVariant;
  resetToken: number;
  reduced: boolean;
}) {
  const camera = useThree(state => state.camera);
  const invalidate = useThree(state => state.invalidate);
  const size = useThree(state => state.size);
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);

  useLayoutEffect(() => {
    const aspect = size.width / Math.max(size.height, 1);
    const narrowScale = Math.max(1, 1.18 / aspect);
    camera.position.set(
      variant.camera[0] * narrowScale,
      variant.camera[1] * narrowScale,
      variant.camera[2] * narrowScale
    );
    camera.lookAt(...variant.target);
    camera.updateProjectionMatrix();
    if (controls.current) {
      controls.current.target.set(...variant.target);
      controls.current.update();
      controls.current.saveState();
    }
    invalidate();
  }, [camera, invalidate, resetToken, size.height, size.width, variant]);

  return (
    <OrbitControls
      key={`${variant.id}-${resetToken}`}
      ref={controls}
      enableDamping={!reduced}
      enablePan={false}
      enableZoom
      makeDefault
      maxDistance={9}
      maxPolarAngle={Math.PI * 0.52}
      minDistance={3.1}
      minPolarAngle={Math.PI * 0.08}
      rotateSpeed={0.62}
      target={variant.target}
      zoomSpeed={0.74}
    />
  );
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

function Fastener({ x, z, color }: { x: number; z: number; color: string }) {
  return (
    <group position={[x, 0.29, z]}>
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[0.105, 0.115, 0.075, 6]} />
        <meshStandardMaterial color={color} metalness={0.88} roughness={0.24} />
      </mesh>
      <mesh position={[0, 0.041, 0]} rotation={[0, Math.PI / 6, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.012, 6]} />
        <meshBasicMaterial color="#050708" />
      </mesh>
    </group>
  );
}

function StatusLegend({ y }: { y: number }) {
  return (
    <group position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh>
        <ringGeometry args={[0.235, 0.275, 48]} />
        <meshStandardMaterial
          color={ACTIVE_BLUE}
          metalness={0.16}
          opacity={0.72}
          roughness={0.32}
          transparent
        />
      </mesh>
      <mesh position={[0, 0, 0.006]} rotation={[0, 0, Math.PI / 2]}>
        <circleGeometry args={[0.205, 32, Math.PI / 2, Math.PI]} />
        <meshStandardMaterial
          color={ACTIVE_BLUE}
          metalness={0.12}
          opacity={0.68}
          roughness={0.34}
          transparent
        />
      </mesh>
      <mesh position={[0, 0, 0.012]}>
        <circleGeometry args={[0.05, 24]} />
        <meshBasicMaterial color="#c3dfeb" opacity={0.84} transparent />
      </mesh>
    </group>
  );
}

function CapMaterial({ variant }: { variant: KeySwitchVariant }) {
  return (
    <meshPhysicalMaterial
      attenuationColor={variant.attenuationColor}
      attenuationDistance={2.4}
      clearcoat={0.9}
      clearcoatRoughness={Math.max(0.07, variant.roughness * 0.5)}
      color={variant.capColor}
      depthWrite={false}
      dispersion={variant.id === 'optic-clear' ? 0.032 : 0.008}
      ior={1.49}
      opacity={0.99}
      roughness={variant.roughness}
      thickness={variant.thickness}
      transmission={variant.transmission}
      transparent
    />
  );
}

function InnerCapMaterial({ variant }: { variant: KeySwitchVariant }) {
  return (
    <meshPhysicalMaterial
      color={variant.capColor}
      depthWrite={false}
      opacity={variant.innerOpacity}
      roughness={Math.min(0.5, variant.roughness + 0.12)}
      side={THREE.BackSide}
      transparent
      transmission={0.14}
    />
  );
}

function Keycap({ variant }: { variant: KeySwitchVariant }) {
  const geometry = useMemo(() => createKeycapGeometry(), []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const legendY = variant.capY + variant.capSize[1] / 2 + 0.012;
  const socketY = variant.capY - variant.capSize[1] / 2 + 0.17;
  const innerSize: [number, number, number] = [
    variant.capSize[0] - 0.2,
    Math.max(0.28, variant.capSize[1] - 0.16),
    variant.capSize[2] - 0.2,
  ];

  return (
    <group>
      {variant.capShape === 'sculpted' ? (
        <mesh
          geometry={geometry}
          name="keyswitch-cap-outer-shell"
          position={[0, variant.capY, 0]}
          castShadow
        >
          <CapMaterial variant={variant} />
        </mesh>
      ) : (
        <RoundedBox
          args={variant.capSize}
          position={[0, variant.capY, 0]}
          radius={variant.capRadius}
          smoothness={7}
          castShadow
        >
          <CapMaterial variant={variant} />
        </RoundedBox>
      )}

      {/* A generic rounded-box liner can escape the sculpted cap's tapered
          upper corners. Reuse its exact loft so every cross-section nests. */}
      {variant.capShape === 'sculpted' ? (
        <mesh
          geometry={geometry}
          name="keyswitch-cap-inner-shell"
          position={[0, variant.capY - 0.035, 0]}
          scale={[0.9, 0.82, 0.9]}
        >
          <InnerCapMaterial variant={variant} />
        </mesh>
      ) : (
        <RoundedBox
          args={innerSize}
          name="keyswitch-cap-inner-shell"
          position={[0, variant.capY - 0.035, 0]}
          radius={Math.max(0.08, variant.capRadius - 0.055)}
          smoothness={5}
        >
          <InnerCapMaterial variant={variant} />
        </RoundedBox>
      )}

      <group position={[0, socketY, 0]}>
        <RoundedBox args={[0.45, 0.3, 0.13]} radius={0.035} smoothness={3}>
          <meshPhysicalMaterial
            color={variant.stemColor}
            opacity={0.76}
            roughness={0.25}
            transparent
            transmission={0.18}
          />
        </RoundedBox>
        <RoundedBox args={[0.13, 0.3, 0.45]} radius={0.035} smoothness={3}>
          <meshPhysicalMaterial
            color={variant.stemColor}
            opacity={0.76}
            roughness={0.25}
            transparent
            transmission={0.18}
          />
        </RoundedBox>
      </group>

      <StatusLegend y={legendY} />
    </group>
  );
}

function SwitchMechanism({
  variant,
  pressed,
  reduced,
}: {
  variant: KeySwitchVariant;
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
    <group name="keyswitch-mechanism">
      <RoundedBox
        args={[1.48, 0.43, 1.48]}
        position={[0, 0.48, 0]}
        radius={0.12}
        smoothness={5}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial
          color={variant.frameColor}
          metalness={0.22}
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
          attenuationColor={variant.fillLight}
          attenuationDistance={1.3}
          clearcoat={0.65}
          color={variant.housingColor}
          depthWrite={false}
          ior={1.48}
          opacity={0.74}
          roughness={0.16}
          thickness={0.32}
          transmission={variant.housingTransmission}
          transparent
        />
      </RoundedBox>

      {[-0.48, 0.48].map((x, index) => (
        <mesh key={x} position={[x, index === 0 ? 0.67 : 0.6, 0]} castShadow>
          <boxGeometry args={[0.035, index === 0 ? 0.46 : 0.34, 0.62]} />
          <meshStandardMaterial
            color={variant.contactColor}
            metalness={0.88}
            roughness={0.28}
          />
        </mesh>
      ))}

      <Spring pressed={pressed} reduced={reduced} />

      <group ref={stem}>
        <RoundedBox
          args={[0.48, 0.5, 0.14]}
          position={[0, 1.27, 0]}
          radius={0.035}
          smoothness={3}
          castShadow
        >
          <meshStandardMaterial
            color={variant.stemColor}
            emissive={variant.stemColor}
            emissiveIntensity={0.28}
            roughness={0.3}
          />
        </RoundedBox>
        <RoundedBox
          args={[0.14, 0.5, 0.48]}
          position={[0, 1.27, 0]}
          radius={0.035}
          smoothness={3}
          castShadow
        >
          <meshStandardMaterial
            color={variant.stemColor}
            emissive={variant.stemColor}
            emissiveIntensity={0.28}
            roughness={0.3}
          />
        </RoundedBox>
      </group>

      <mesh position={[0, 0.29, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.42, 48]} />
        <meshBasicMaterial
          color={ACTIVE_BLUE}
          opacity={0.17}
          toneMapped={false}
          transparent
        />
      </mesh>
    </group>
  );
}

function KeySwitchAssembly({
  variant,
  pressed,
  reduced,
  onPressedChange,
}: {
  variant: KeySwitchVariant;
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
    <group name="keyswitch-assembly" rotation={[0, variant.objectRotation, 0]}>
      <RoundedBox
        args={[2.62, 0.23, 2.62]}
        position={[0, 0.13, 0]}
        radius={variant.id === 'opal-pillow' ? 0.29 : 0.18}
        smoothness={7}
        castShadow
        receiveShadow
      >
        <meshPhysicalMaterial
          anisotropy={0.3}
          clearcoat={0.32}
          clearcoatRoughness={0.17}
          color={variant.plateColor}
          metalness={variant.plateMetalness}
          roughness={variant.plateRoughness}
        />
      </RoundedBox>
      <RoundedBox
        args={[2.4, 0.36, 2.4]}
        position={[0, -0.08, 0]}
        radius={variant.id === 'smoke-low' ? 0.12 : 0.17}
        smoothness={6}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial
          color={variant.frameColor}
          metalness={variant.frameMetalness}
          roughness={0.33}
        />
      </RoundedBox>
      <RoundedBox
        args={[1.76, 0.055, 1.76]}
        position={[0, 0.255, 0]}
        radius={0.1}
        smoothness={4}
      >
        <meshStandardMaterial
          color={variant.hardwareColor}
          metalness={0.62}
          roughness={0.29}
        />
      </RoundedBox>

      <Fastener color={variant.hardwareColor} x={-1.04} z={-1.04} />
      <Fastener color={variant.hardwareColor} x={1.04} z={-1.04} />
      <Fastener color={variant.hardwareColor} x={-1.04} z={1.04} />
      <Fastener color={variant.hardwareColor} x={1.04} z={1.04} />

      <SwitchMechanism pressed={pressed} reduced={reduced} variant={variant} />

      <group ref={cap} name={`keyswitch-cap-${variant.id}`}>
        <Keycap variant={variant} />
      </group>

      <mesh
        position={[0, 1.2, 0]}
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
        <boxGeometry args={[2.18, 2.42, 2.18]} />
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
  variant,
  resetToken,
  pressed,
  onPressedChange,
}: {
  variant: KeySwitchVariant;
  resetToken: number;
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
}) {
  const reduced = useReducedMotion();

  return (
    <>
      <OrbitCamera
        reduced={reduced}
        resetToken={resetToken}
        variant={variant}
      />
      <ambientLight intensity={variant.ambientIntensity} />
      <directionalLight
        color={variant.keyLight}
        intensity={variant.keyIntensity}
        position={[4.8, 7.2, 5.4]}
      />
      <pointLight
        color={variant.fillLight}
        intensity={variant.fillIntensity}
        position={[-4.5, 3.4, 2]}
      />

      <Environment
        key={`environment-${variant.id}`}
        resolution={256}
        frames={1}
        environmentIntensity={variant.environmentIntensity}
      >
        <Lightformer
          color={variant.keyLight}
          form="rect"
          intensity={5.4}
          position={[0, 5, -4]}
          rotation={[Math.PI / 2, 0, 0]}
          scale={[7, 3.2, 1]}
        />
        <Lightformer
          color={variant.fillLight}
          form="rect"
          intensity={3.2}
          position={[-5, 1.8, 1]}
          rotation={[0, Math.PI / 2, 0]}
          scale={[4, 2.5, 1]}
        />
        <Lightformer
          color={variant.rimLight}
          form="rect"
          intensity={2.4}
          position={[5, 1.1, -1]}
          rotation={[0, -Math.PI / 2, 0]}
          scale={[3, 2, 1]}
        />
      </Environment>

      <KeySwitchAssembly
        onPressedChange={onPressedChange}
        pressed={pressed}
        reduced={reduced}
        variant={variant}
      />

      <ContactShadows
        key={`shadows-${variant.id}`}
        color="#00070b"
        far={5}
        frames={1}
        opacity={variant.id === 'smoke-low' ? 0.62 : 0.72}
        position={[0, -0.28, 0]}
        resolution={1024}
        scale={[7, 6]}
        blur={2.3}
      />
      <mesh position={[0, -0.3, 0]} receiveShadow>
        <boxGeometry args={[12, 0.08, 12]} />
        <meshPhysicalMaterial
          clearcoat={0.2}
          clearcoatRoughness={0.22}
          color={variant.ground}
          metalness={variant.id === 'smoke-low' ? 0.34 : 0.04}
          roughness={variant.id === 'smoke-low' ? 0.3 : 0.48}
        />
      </mesh>
    </>
  );
}

export function KeySwitchStudy({ evalMode = false }: { evalMode?: boolean }) {
  const [variantId, setVariantId] = useState(KEYSWITCH_VARIANTS[0].id);
  const [pressed, setPressed] = useState(false);
  const [resetToken, setResetToken] = useState(0);
  const variant =
    KEYSWITCH_VARIANTS.find(candidate => candidate.id === variantId) ??
    KEYSWITCH_VARIANTS[0];

  const selectVariant = (id: string) => {
    setPressed(false);
    setVariantId(id);
  };

  return (
    <div
      className="overflow-hidden rounded-[2px] border"
      data-active-keyswitch-variant={variant.id}
      data-keyswitch-study
      data-material-count={KEYSWITCH_VARIANTS.length}
      data-pressed-variant={pressed ? variant.id : 'none'}
      style={{
        borderColor: 'rgba(173, 211, 224, 0.18)',
        background: '#070a0c',
      }}
    >
      <div className="relative h-[clamp(440px,54vw,680px)] min-h-[440px]">
        <Canvas
          aria-hidden="true"
          camera={{
            fov: 29,
            near: 0.1,
            far: 100,
            position: variant.camera,
          }}
          dpr={[1, 2]}
          frameloop="demand"
          gl={{
            alpha: false,
            antialias: true,
            powerPreference: 'high-performance',
            preserveDrawingBuffer: evalMode,
          }}
          onPointerMissed={() => setPressed(false)}
          style={{ touchAction: 'none' }}
        >
          <color attach="background" args={[variant.background]} />
          {evalMode && <ExposeEvalRenderer />}
          <ProductScene
            onPressedChange={setPressed}
            pressed={pressed}
            resetToken={resetToken}
            variant={variant}
          />
        </Canvas>

        <div className="pointer-events-none absolute left-5 top-5 flex items-center gap-2.5 sm:left-7 sm:top-7">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              background: ACTIVE_BLUE,
              boxShadow: `0 0 14px ${ACTIVE_BLUE}`,
            }}
          />
          <span
            className="font-mono text-[9px] uppercase tracking-[0.2em] sm:text-[10px]"
            style={{
              color:
                variant.id === 'smoke-low'
                  ? 'rgba(219, 237, 243, 0.62)'
                  : 'rgba(14, 29, 36, 0.58)',
            }}
          >
            Individual switch study · {variant.name}
          </span>
        </div>

        <button
          className="absolute right-5 top-5 rounded-sm border bg-slate-950/55 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.16em] text-slate-100 outline-none backdrop-blur-sm transition-colors hover:bg-slate-950/70 focus-visible:ring-2 focus-visible:ring-sky-200 sm:right-7 sm:top-7"
          data-keyswitch-camera-reset
          onClick={() => setResetToken(token => token + 1)}
          style={{ borderColor: 'rgba(226, 240, 246, 0.32)' }}
          type="button"
        >
          Reset view
        </button>

        <button
          className="absolute bottom-5 left-5 rounded-sm border bg-slate-950/55 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.16em] text-slate-100 outline-none backdrop-blur-sm transition-colors hover:bg-slate-950/70 focus-visible:ring-2 focus-visible:ring-sky-200 sm:bottom-7 sm:left-7"
          data-keyswitch-travel-control
          onBlur={() => setPressed(false)}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') setPressed(true);
          }}
          onKeyUp={event => {
            if (event.key === 'Enter' || event.key === ' ') setPressed(false);
          }}
          onPointerDown={() => setPressed(true)}
          onPointerLeave={() => setPressed(false)}
          onPointerUp={() => setPressed(false)}
          style={{ borderColor: 'rgba(226, 240, 246, 0.32)' }}
          type="button"
        >
          Hold to actuate
        </button>

        <p className="pointer-events-none absolute bottom-16 left-5 right-5 rounded-sm bg-slate-950/45 px-2.5 py-1.5 text-center font-mono text-[9px] uppercase tracking-[0.16em] text-slate-100/75 backdrop-blur-sm sm:bottom-7 sm:left-auto sm:right-7">
          <span className="sm:hidden">Drag to orbit · pinch to zoom</span>
          <span className="hidden sm:inline">
            Drag background to orbit · scroll / pinch to zoom
          </span>
        </p>
      </div>

      <div
        aria-label="Individual keyswitch material and geometry variants"
        className="grid grid-cols-1 border-t md:grid-cols-2 2xl:grid-cols-4"
        role="group"
        style={{ borderColor: 'rgba(173, 211, 224, 0.15)' }}
      >
        {KEYSWITCH_VARIANTS.map(candidate => {
          const active = candidate.id === variant.id;
          return (
            <button
              key={candidate.id}
              aria-pressed={active}
              className="flex min-h-[142px] items-start gap-4 border-b px-5 py-5 text-left outline-none transition-[background-color] duration-200 last:border-b-0 focus-visible:bg-sky-100/[0.07] md:odd:border-r 2xl:border-b-0 2xl:border-r 2xl:last:border-r-0"
              data-keyswitch-variant={candidate.id}
              onClick={() => selectVariant(candidate.id)}
              style={{
                background: active
                  ? 'rgba(156, 213, 254, 0.075)'
                  : 'rgba(10, 15, 18, 0.82)',
                borderColor: 'rgba(173, 211, 224, 0.15)',
              }}
              type="button"
            >
              <span className="mt-0.5 font-mono text-[9px] tracking-[0.18em] text-sky-200/45">
                {candidate.index}
              </span>
              <span className="flex min-w-0 flex-col gap-1.5">
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-display text-sm font-semibold text-slate-100">
                    {candidate.name}
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-sky-200/55">
                    {candidate.short}
                  </span>
                </span>
                <span className="max-w-[34ch] text-xs leading-relaxed text-slate-400">
                  {candidate.description}
                </span>
                <span className="mt-1 font-mono text-[8px] uppercase tracking-[0.1em] text-slate-500">
                  {candidate.materials}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

'use client';

/**
 * R3F eval task T2 — instanced field.
 * N boxes rendered through drei <Instances> so the whole field stays ~1 draw
 * call regardless of N (the scaling bet). Exposes the renderer + preserves the
 * drawing buffer so the harness can assert renderer.info.render.calls.
 */
import { useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Instances, Instance } from '@react-three/drei';
import type { WebGLRenderer } from 'three';

const N = 200;
const COLS = 20;
const GAP = 26;

function ExposeGl() {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    (window as unknown as { __EVAL_GL__?: WebGLRenderer }).__EVAL_GL__ = gl;
  }, [gl]);
  return null;
}

function position(i: number): [number, number, number] {
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  const rows = Math.ceil(N / COLS);
  return [(col - COLS / 2 + 0.5) * GAP, (row - rows / 2 + 0.5) * GAP, 0];
}

function Field() {
  return (
    <Instances limit={N} range={N}>
      <boxGeometry args={[16, 16, 16]} />
      <meshStandardMaterial
        color="#19e6ff"
        emissive="#19e6ff"
        emissiveIntensity={0.45}
        toneMapped={false}
      />
      {Array.from({ length: N }).map((_, i) => (
        <Instance key={i} position={position(i)} />
      ))}
    </Instances>
  );
}

export default function T2InstancedPage() {
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#04060b' }}>
      <Canvas
        orthographic
        dpr={[1, 2]}
        camera={{ zoom: 1, position: [0, 0, 400], near: 0.1, far: 2000 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
      >
        <color attach="background" args={['#04060b']} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[120, 140, 220]} intensity={1.1} />
        <ExposeGl />
        <Field />
      </Canvas>
    </div>
  );
}

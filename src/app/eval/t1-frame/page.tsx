'use client';

/**
 * R3F eval task T1 — chamfered emissive frame.
 * Ortho px-space (zoom 1 ⇒ 1 unit = 1px), a chamfered THREE.Shape panel with a
 * toneMapped={false} neon edge. Exposes the renderer as window.__EVAL_GL__ and
 * preserves the drawing buffer so the harness can read pixels + draw-call info.
 */
import { useEffect, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';

function ExposeGl() {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    (window as unknown as { __EVAL_GL__?: THREE.WebGLRenderer }).__EVAL_GL__ = gl;
  }, [gl]);
  return null;
}

const W = 360;
const H = 220;
const C = 22;

function ChamferedFrame() {
  const shape = useMemo(() => {
    const x = W / 2;
    const y = H / 2;
    const s = new THREE.Shape();
    s.moveTo(-x, y);
    s.lineTo(x - C, y);
    s.lineTo(x, y - C);
    s.lineTo(x, -y);
    s.lineTo(-x + C, -y);
    s.lineTo(-x, -y + C);
    s.closePath();
    return s;
  }, []);
  const edge = useMemo<[number, number, number][]>(() => {
    const x = W / 2;
    const y = H / 2;
    return [
      [-x, y, 0],
      [x - C, y, 0],
      [x, y - C, 0],
      [x, -y, 0],
      [-x + C, -y, 0],
      [-x, -y + C, 0],
      [-x, y, 0],
    ];
  }, []);
  return (
    <group>
      <mesh position={[0, 0, -1]}>
        <shapeGeometry args={[shape]} />
        <meshBasicMaterial color="#0a131a" toneMapped={false} />
      </mesh>
      <Line points={edge} color="#19e6ff" lineWidth={3} toneMapped={false} />
    </group>
  );
}

export default function T1FramePage() {
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#04060b' }}>
      <Canvas
        orthographic
        dpr={[1, 2]}
        camera={{ zoom: 1, position: [0, 0, 100], near: 0.1, far: 1000 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
      >
        <color attach="background" args={['#04060b']} />
        <ExposeGl />
        <ChamferedFrame />
      </Canvas>
    </div>
  );
}

// No 'use client' directive: this module is only imported by client components
// (the boundary is established by its importer). Adding it here would make this a
// "use client entry" and trip Next's serializable-props rule on the function
// props (onSelect/onHoverAgent), which are valid client-to-client callbacks.

/**
 * AgentField — the scalable WebGL "world" layer (greybox).
 *
 * Renders the whole fleet as a single InstancedMesh constellation so draw calls
 * stay ~constant from one agent to tens of thousands (the reason for R3F).
 * Per-instance pointer picking (instanceId) drives hover + select; the selected
 * agent is surfaced to a DOM overlay (chrome = DOM, world = WebGL). Camera is a
 * dolly/zoom rig (zoom-from-one-to-thousands). Follows the repo R3F guide:
 * frameloop="demand" + invalidate, no per-frame setState/alloc, toneMapped={false}
 * emissive for bloom, drei <Line>/instancing, dispose on unmount.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { CameraControls } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import type { AgentStatus } from '@exawatt/core';
import { HUD, HUD_STATUS_COLOR } from '../tokens';

export interface FieldAgent {
  id: string;
  name: string;
  status: AgentStatus;
  x: number;
  y: number;
}

const STATUS_CYCLE: AgentStatus[] = [
  'working',
  'working',
  'working',
  'reviewing',
  'blocked',
  'complete',
  'idle',
  'idle',
];

const NODE = 2.2; // node half-extent (world units)
const SPACING = 6;

/** Deterministic phyllotaxis (sunflower) disc — even spread, no RNG. */
export function generateAgents(n: number): FieldAgent[] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const out: FieldAgent[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt(i + 0.5) * SPACING;
    const a = i * golden;
    out.push({
      id: `agent-${i}`,
      name: `Agent ${i}`,
      status: STATUS_CYCLE[(i * 7 + 3) % STATUS_CYCLE.length],
      x: Math.cos(a) * r,
      y: Math.sin(a) * r,
    });
  }
  return out;
}

function fieldRadius(agents: FieldAgent[]): number {
  let max = NODE * 4;
  for (const a of agents) {
    const r = Math.hypot(a.x, a.y);
    if (r > max) max = r;
  }
  return max + NODE * 3;
}

/** The instanced constellation + per-instance picking. Keyed by count upstream. */
function Field({
  agents,
  onHover,
  onSelect,
}: {
  agents: FieldAgent[];
  onHover: (i: number | null) => void;
  onSelect: (i: number) => void;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const count = agents.length;
  const geom = useMemo(() => new THREE.BoxGeometry(NODE, NODE, NODE), []);
  useEffect(() => () => geom.dispose(), [geom]);

  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    dummy.rotation.z = Math.PI / 4; // diamond nodes
    for (let i = 0; i < count; i++) {
      dummy.position.set(agents[i].x, agents[i].y, 0);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      m.setColorAt(i, color.set(HUD_STATUS_COLOR[agents[i].status]));
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
    invalidate();
  }, [agents, count, invalidate]);

  return (
    <instancedMesh
      ref={mesh}
      args={[geom, undefined, count]}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        if (e.instanceId != null) {
          document.body.style.cursor = 'pointer';
          onHover(e.instanceId);
          invalidate();
        }
      }}
      onPointerOut={() => {
        document.body.style.cursor = 'auto';
        onHover(null);
        invalidate();
      }}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        if (e.instanceId != null) {
          onSelect(e.instanceId);
          invalidate();
        }
      }}
    >
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

/** Square focus ring drawn at an agent's position (hover = cyan, select = magenta). */
function FocusRing({ agent, color }: { agent: FieldAgent; color: string }) {
  return (
    <mesh position={[agent.x, agent.y, 0.5]} rotation={[0, 0, Math.PI / 4]} raycast={() => null}>
      <ringGeometry args={[NODE * 1.1, NODE * 1.45, 4]} />
      <meshBasicMaterial color={color} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

/** Dolly/zoom rig that frames the whole field on mount + when the count changes. */
function Rig({ radius }: { radius: number }) {
  const controls = useRef<CameraControls>(null);
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    c.fitToSphere(new THREE.Sphere(new THREE.Vector3(0, 0, 0), radius), false);
  }, [radius]);
  return (
    <CameraControls
      ref={controls}
      makeDefault
      minDistance={NODE * 4}
      maxDistance={radius * 6}
      // war-table tilt: lock to a near-top-down view, allow modest orbit
      minPolarAngle={0}
      maxPolarAngle={Math.PI * 0.42}
      dollyToCursor
    />
  );
}

export function AgentField({
  agents,
  selectedId,
  onSelect,
  onHoverAgent,
}: {
  agents: FieldAgent[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onHoverAgent?: (agent: FieldAgent | null) => void;
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const radius = useMemo(() => fieldRadius(agents), [agents]);
  const hovered = hoveredIdx != null ? agents[hoveredIdx] ?? null : null;
  const selected = useMemo(
    () => (selectedId ? agents.find((a) => a.id === selectedId) ?? null : null),
    [agents, selectedId]
  );

  useEffect(() => {
    onHoverAgent?.(hovered);
  }, [hovered, onHoverAgent]);

  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ position: [0, -radius * 0.4, radius * 1.6], fov: 40, near: 0.1, far: radius * 12 }}
      gl={{ antialias: true }}
      onPointerMissed={() => onSelect(null)}
      onCreated={({ gl }) => {
        // dev-only introspection hook (draw-call/perf checks); see r3f-eval
        if (process.env.NODE_ENV !== 'production') {
          (window as unknown as { __EVAL_GL__?: THREE.WebGLRenderer }).__EVAL_GL__ = gl;
        }
      }}
      aria-hidden="true"
    >
      <color attach="background" args={[HUD.bg.void]} />
      <Rig radius={radius} />
      <Field
        key={agents.length}
        agents={agents}
        onHover={setHoveredIdx}
        onSelect={(i) => onSelect(agents[i].id)}
      />
      {hovered && <FocusRing agent={hovered} color={HUD.cyan} />}
      {selected && <FocusRing agent={selected} color={HUD.magenta} />}
      <EffectComposer>
        <Bloom luminanceThreshold={0.5} luminanceSmoothing={0.25} intensity={0.8} radius={0.6} mipmapBlur />
      </EffectComposer>
    </Canvas>
  );
}

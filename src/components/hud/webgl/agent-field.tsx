// No 'use client' directive: this module is only imported by client components
// (the boundary is established by its importer). Adding it here would make this a
// "use client entry" and trip Next's serializable-props rule on the function
// props (onSelect/onHoverAgent), which are valid client-to-client callbacks.

/**
 * AgentField — the canonical scalable WebGL "world" layer (Tactical Clusters).
 *
 * Promoted from the Direction-C fidelity variant, with the best of A and B
 * grafted in: A's floor grid + depth fog (the war-table ground), B's instanced
 * additive halo glow + hub trunk network (the holographic luminosity).
 *
 * The read (information design first):
 *  - agents live in labeled PROJECT CLUSTERS (octagonal tactical hulls) so a
 *    commander parses the fleet at a glance;
 *  - node SIZE encodes importance (blocked/error largest), density-LOD shrinks
 *    nodes as clusters grow so 4096 agents stay parseable;
 *  - blocked/error agents pulse (reduced-motion gated) and burn hotter.
 *
 * Game-feel systems (all demand-loop friendly — they park when settled):
 *  - staggered "deploy" entrance: nodes scale in over ~1.2s on mount;
 *  - hover-grow / select-grow with frame-rate-independent damp;
 *  - camera fly-to via an imperative AgentFieldHandle (focusCluster/focusAgent/
 *    overview/dolly/truck/orbit) driven by the DOM chrome's keyboard layer;
 *  - CameraControls smooth transitions self-sustain under frameloop="demand"
 *    (drei invalidates on camera-controls 'update'/'transitionstart' events).
 *
 * Scaling contract: ALL agents render as ONE InstancedMesh (nodes) + ONE
 * InstancedMesh (halos) — draw calls stay ~constant from 64 → 10k+. Clusters
 * are LAYOUT, not meshes. Follows docs/engineering/r3f-authoring-guide.md.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { CameraControls, Grid, Line, Text } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import type { AgentStatus } from '@exawatt/core';
import { HUD, HUD_STATUS_COLOR } from '../tokens';

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export interface FieldAgent {
  id: string;
  name: string;
  status: AgentStatus;
  /** index of the owning project cluster */
  cluster: number;
  /** absolute world position (cluster offset + local sunflower position) */
  x: number;
  y: number;
}

export interface ClusterInfo {
  index: number;
  /** stable id of the underlying group (project clusterId; synthetic = label) */
  id: string;
  label: string;
  cx: number;
  cy: number;
  /** bounding radius of the agent disc (world units) */
  radius: number;
  count: number;
  /** worst (highest-attention) status present — drives the hull tint */
  dominant: AgentStatus;
  /** number of blocked/error agents in this cluster */
  attention: number;
  /** red-hull "a commander goes here NOW" flag (real data: the hero zone) */
  critical: boolean;
}

/** One agent inside a FieldGroupSpec (the minimal shape the world needs). */
export interface FieldGroupAgent {
  id: string;
  name: string;
  status: AgentStatus;
}

/** A project/context group to lay out as one cluster on the field. */
export interface FieldGroupSpec {
  id: string;
  label: string;
  /** agents in display order; empty for summary/aggregate groups */
  agents: FieldGroupAgent[];
  /** hull goes red when true; defaults to the attention-ratio heuristic */
  critical?: boolean;
  /** population for empty groups rendered as hull + label only (aggregates) */
  countOverride?: number;
  /** blocked/error population override (aggregates) */
  attentionOverride?: number;
}

/** Imperative camera verbs the DOM chrome (keyboard layer) drives. */
export interface AgentFieldHandle {
  focusCluster(index: number): void;
  focusAgent(id: string): void;
  overview(): void;
  /** positive = zoom in */
  dolly(steps: number): void;
  /** screen-space pan, in field-radius fractions */
  truck(dx: number, dy: number): void;
  /** orbit azimuth by delta radians (clamped by the rig) */
  orbit(deltaAzimuth: number): void;
}

const PROJECT_NAMES = [
  'ATLAS',
  'ORION',
  'VANGUARD',
  'HELIOS',
  'KESTREL',
  'NOVA',
  'CITADEL',
  'TEMPEST',
  'AURORA',
  'WARDEN',
  'ZEPHYR',
  'PHALANX',
] as const;

// Status weighting drives both node SIZE (importance) and dominant-status pick.
const STATUS_RANK: Record<AgentStatus, number> = {
  error: 6,
  blocked: 5,
  reviewing: 4,
  working: 3,
  complete: 2,
  idle: 1,
};

// Base node half-extent per status (world units), before density-LOD scaling.
const STATUS_SIZE: Record<AgentStatus, number> = {
  error: 3.4,
  blocked: 3.4,
  reviewing: 2.6,
  working: 2.0,
  complete: 1.9,
  idle: 1.5,
};

// Deterministic per-cluster status mix — reproducible across SSR/CSR.
// Rates are tuned so red stays RARE: ~8% attention fleet-wide, concentrated in
// the "hot" clusters, so critical sectors actually stand out on the map.
function statusForAgent(clusterSeed: number, localIdx: number): AgentStatus {
  const h = (clusterSeed * 131 + localIdx * 2654435761) >>> 0;
  const r = h % 100;
  const hot = clusterSeed % 4 === 1; // a couple of clusters run "hot"
  if (hot) {
    if (r < 6) return 'error';
    if (r < 20) return 'blocked';
    if (r < 36) return 'reviewing';
    if (r < 76) return 'working';
    if (r < 90) return 'complete';
    return 'idle';
  }
  if (r < 2) return 'error';
  if (r < 8) return 'blocked';
  if (r < 22) return 'reviewing';
  if (r < 70) return 'working';
  if (r < 88) return 'complete';
  return 'idle';
}

const CLUSTER_GAP = 1.7; // spacing multiplier between cluster centers
const NODE_PITCH = 4.0;

/**
 * Lay out arbitrary project groups as clusters on the tactical field: clusters
 * on a ring (with 6+ groups the FIRST sits at the CENTER — fills the map, no
 * donut hole), each group's agents placed by phyllotaxis inside its disc.
 * Pure geometry — real fleet state or synthetic demo data both feed this.
 * Returns a single flat agent array (→ single InstancedMesh) plus metadata.
 */
export function layoutClusteredField(groups: FieldGroupSpec[]): {
  agents: FieldAgent[];
  clusters: ClusterInfo[];
} {
  const numClusters = groups.length;
  if (numClusters === 0) return { agents: [], clusters: [] };

  const counts = groups.map((g) => g.countOverride ?? g.agents.length);

  const localRadius = (count: number) =>
    Math.max(NODE_PITCH * 2, Math.sqrt(Math.max(count, 1)) * NODE_PITCH);

  const maxLocal = Math.max(...counts.map(localRadius));
  const hasCenter = numClusters >= 6;
  const ringCount = hasCenter ? numClusters - 1 : numClusters;
  // MIN_RING keeps tiny real fleets (2-4 agents/project) spread far enough
  // apart that their (long, wrapped) labels can never collide.
  const MIN_RING = 36;
  const ringRadius =
    ringCount <= 1
      ? 0
      : Math.max(
          (maxLocal * CLUSTER_GAP) / Math.sin(Math.PI / ringCount),
          MIN_RING
        );

  const golden = Math.PI * (3 - Math.sqrt(5));
  const clusters: ClusterInfo[] = [];
  const agents: FieldAgent[] = [];

  for (let c = 0; c < numClusters; c++) {
    const g = groups[c];
    const onRing = !(hasCenter && c === 0) && numClusters > 1;
    const ringIdx = hasCenter ? c - 1 : c;
    const ang = (ringIdx / Math.max(ringCount, 1)) * Math.PI * 2 - Math.PI / 2;
    const cx = onRing ? Math.cos(ang) * ringRadius : 0;
    const cy = onRing ? Math.sin(ang) * ringRadius : 0;
    const r = localRadius(counts[c]);

    let dominant: AgentStatus = 'idle';
    let attention = 0;
    const denom = Math.max(g.agents.length, 1);
    for (let li = 0; li < g.agents.length; li++) {
      const a = g.agents[li];
      const rr = Math.sqrt((li + 0.5) / denom) * (r - NODE_PITCH * 0.6);
      const aa = li * golden;
      if (STATUS_RANK[a.status] > STATUS_RANK[dominant]) dominant = a.status;
      if (a.status === 'blocked' || a.status === 'error') attention++;
      agents.push({
        id: a.id,
        name: a.name,
        status: a.status,
        cluster: c,
        x: cx + Math.cos(aa) * rr,
        y: cy + Math.sin(aa) * rr,
      });
    }
    if (g.attentionOverride !== undefined) attention = g.attentionOverride;

    const count = counts[c];
    clusters.push({
      index: c,
      id: g.id,
      label: g.label,
      cx,
      cy,
      radius: r,
      count,
      dominant,
      attention,
      critical:
        g.critical ?? (count > 0 && attention / count >= CRITICAL_ATTENTION),
    });
  }

  return { agents, clusters };
}

/**
 * Synthetic demo fleet: deterministically partition n agents into project
 * clusters (round-robin) with a tuned status mix, then run the shared layout.
 */
export function generateClusteredAgents(n: number): {
  agents: FieldAgent[];
  clusters: ClusterInfo[];
} {
  const numClusters = Math.min(
    PROJECT_NAMES.length,
    Math.max(3, Math.round(Math.sqrt(n) / 3))
  );
  const groups: FieldGroupSpec[] = Array.from({ length: numClusters }, (_, c) => ({
    id: PROJECT_NAMES[c],
    label: PROJECT_NAMES[c],
    agents: [],
  }));
  const localCounter = new Array(numClusters).fill(0);
  for (let i = 0; i < n; i++) {
    const c = i % numClusters;
    const li = localCounter[c]++;
    groups[c].agents.push({
      id: `agent-${i}`,
      name: `${PROJECT_NAMES[c]}-${String(li).padStart(3, '0')}`,
      status: statusForAgent(c, li),
    });
  }
  return layoutClusteredField(groups);
}

/** Overall scene radius (for camera framing). */
function sceneRadius(clusters: ClusterInfo[]): number {
  let max = 40;
  for (const c of clusters) {
    const r = Math.hypot(c.cx, c.cy) + c.radius;
    if (r > max) max = r;
  }
  return max * 1.12;
}

/** Fraction of blocked/error agents above which a cluster is "critical" (red).
 *  Kept above the healthy baseline (~8%) so red = "a commander goes here NOW". */
const CRITICAL_ATTENTION = 0.16;

// ---------------------------------------------------------------------------
// Reduced motion (self-contained — no shared import)
// ---------------------------------------------------------------------------
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const q = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(q.matches);
    const h = (e: MediaQueryListEvent) => setReduced(e.matches);
    q.addEventListener('change', h);
    return () => q.removeEventListener('change', h);
  }, []);
  return reduced;
}

/** small deterministic hash -> [0,1) (no Math.random; SSR-stable) */
function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function easeOutCubic(u: number): number {
  const t = THREE.MathUtils.clamp(u, 0, 1);
  return 1 - Math.pow(1 - t, 3);
}

// ---------------------------------------------------------------------------
// Instanced agent constellation — nodes + additive halos, one draw call each
// ---------------------------------------------------------------------------

// module-scope scratch objects — never allocate in useFrame / loops
const _dummy = new THREE.Object3D();
const _color = new THREE.Color();
const _white = new THREE.Color('#FFFFFF');
const _sphere = new THREE.Sphere();
const _v3 = new THREE.Vector3();

/**
 * density-LOD: shrink + dim nodes as the cluster gets denser so a huge fleet
 * stays parseable. Returns a 0..1 scale applied on top of the status size.
 */
function densityScale(clusterCount: number): number {
  return THREE.MathUtils.clamp(
    1 / (1 + Math.log10(Math.max(clusterCount, 1)) * 0.42),
    0.34,
    1
  );
}

/** Radial-gradient sprite for the additive halos (built once, disposed). */
function useHaloTexture(): THREE.Texture {
  return useMemo(() => {
    const size = 128;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.2, 'rgba(255,255,255,0.7)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.16)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);
}

const HALO_MUL = 4.6; // halo quad extent relative to node extent
const ENTRANCE_SPREAD = 0.85; // max per-node deploy delay (s)
const ENTRANCE_DUR = 0.5; // per-node deploy grow time (s)
const HOVER_BOOST = 1.5;
const SELECT_BOOST = 1.3;
const PULSE_AMP = 0.16;
const PULSE_SPEED = 2.6; // rad/s

function Constellation({
  agents,
  clusters,
  hoveredIdx,
  selectedIdx,
  reduced,
  onHover,
  onSelect,
}: {
  agents: FieldAgent[];
  clusters: ClusterInfo[];
  hoveredIdx: number | null;
  selectedIdx: number;
  reduced: boolean;
  onHover: (i: number | null) => void;
  onSelect: (i: number) => void;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const halo = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const count = agents.length;

  // diamond plate: a thin box reads as a beveled chit on the tactical map
  const geom = useMemo(() => new THREE.BoxGeometry(1, 1, 0.5), []);
  const haloGeom = useMemo(() => new THREE.PlaneGeometry(HALO_MUL, HALO_MUL), []);
  const haloTex = useHaloTexture();
  useEffect(
    () => () => {
      geom.dispose();
      haloGeom.dispose();
      haloTex.dispose();
    },
    [geom, haloGeom, haloTex]
  );

  const clusterDensity = useMemo(
    () => clusters.map((c) => densityScale(c.count)),
    [clusters]
  );

  // per-node statics, cached so the animation loop is pure arithmetic
  const baseSize = useMemo(() => {
    const arr = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = agents[i];
      arr[i] = STATUS_SIZE[a.status] * clusterDensity[a.cluster];
    }
    return arr;
  }, [agents, count, clusterDensity]);

  // entrance stagger: deterministic per node, weighted by cluster so squads
  // land in loose waves instead of pure noise
  const stagger = useMemo(() => {
    const arr = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = agents[i];
      arr[i] =
        (a.cluster / Math.max(clusters.length, 1)) * ENTRANCE_SPREAD * 0.45 +
        hash01(i) * ENTRANCE_SPREAD * 0.55;
    }
    return arr;
  }, [agents, count, clusters.length]);

  // which instances pulse (blocked/error)
  const attentionIdx = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
      if (agents[i].status === 'blocked' || agents[i].status === 'error') out.push(i);
    }
    return out;
  }, [agents, count]);

  // ---- animation state (refs — never setState in useFrame) ----
  const boost = useRef<Float32Array>(new Float32Array(0));
  if (boost.current.length !== count) {
    const arr = new Float32Array(count);
    arr.fill(1);
    boost.current = arr;
  }
  const entrance = useRef({ t: 0, done: false });
  const settling = useRef(new Set<number>());
  const prevHover = useRef<number>(-1);
  const prevSelect = useRef<number>(-1);
  const pulsePhase = useRef(0);

  /** write node + halo matrix for instance i at scale multiplier m */
  const writeInstance = (i: number, m: number, z: number) => {
    const s = Math.max(baseSize[i] * 2 * m, 0.0001);
    _dummy.position.set(agents[i].x, agents[i].y, z);
    _dummy.scale.set(s, s, s);
    _dummy.updateMatrix();
    mesh.current!.setMatrixAt(i, _dummy.matrix);
    halo.current!.setMatrixAt(i, _dummy.matrix);
  };

  const zFor = (i: number): number => {
    if (i === hoveredIdx || i === selectedIdx) return 1.4;
    const st = agents[i].status;
    return st === 'blocked' || st === 'error' ? 0.05 : 0;
  };

  // seed matrices + colors whenever the data changes. On MOUNT nodes start at
  // epsilon scale (positions still span the field, so the bounding sphere is
  // correct) and the entrance loop grows them in. On a live DATA TICK (same
  // mount — statuses/positions changed) nodes seed at their current animated
  // scale: the entrance must never replay just because the fleet updated.
  useEffect(() => {
    const m = mesh.current;
    const h = halo.current;
    if (!m || !h) return;
    if (reduced) entrance.current.done = true;
    _dummy.rotation.set(0, 0, Math.PI / 4); // diamond
    for (let i = 0; i < count; i++) {
      const a = agents[i];
      writeInstance(
        i,
        entrance.current.done ? boost.current[i] : reduced ? 1 : 0,
        zFor(i)
      );

      const base = HUD_STATUS_COLOR[a.status];
      const attention = a.status === 'blocked' || a.status === 'error';
      _color.set(base);
      if (attention) _color.multiplyScalar(1.55);
      m.setColorAt(i, _color);
      // halo: dimmer + density-dimmed so dense clusters don't blow out white
      _color.set(base).multiplyScalar(
        (attention ? 0.62 : 0.4) * (0.35 + clusterDensity[a.cluster] * 0.65)
      );
      h.setColorAt(i, _color);
    }
    m.instanceMatrix.needsUpdate = true;
    h.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    if (h.instanceColor) h.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
    h.computeBoundingSphere();
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, count, baseSize, clusterDensity, reduced, invalidate]);

  // hover highlight: brighten the hovered node's color (cheap two-index write)
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const paint = (i: number, lift: boolean) => {
      if (i < 0 || i >= count) return;
      const a = agents[i];
      const attention = a.status === 'blocked' || a.status === 'error';
      _color.set(HUD_STATUS_COLOR[a.status]);
      if (attention) _color.multiplyScalar(1.55);
      if (lift) _color.lerp(_white, 0.35);
      m.setColorAt(i, _color);
    };
    const prev = prevHover.current;
    if (prev !== -1 && prev !== hoveredIdx) paint(prev, false);
    if (hoveredIdx != null) paint(hoveredIdx, true);
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    invalidate();
  }, [hoveredIdx, agents, count, invalidate]);

  // ---- the animation loop: entrance → (pulse + hover/select settle) ----
  useFrame((state, delta) => {
    const m = mesh.current;
    const h = halo.current;
    if (!m || !h) return;
    const dt = Math.min(delta, 0.05);
    _dummy.rotation.set(0, 0, Math.PI / 4);

    const pulseFor = (i: number): number => {
      const a = agents[i];
      if (!a || (a.status !== 'blocked' && a.status !== 'error')) return 1;
      return 1 + Math.sin(pulsePhase.current + a.cluster * 0.9) * PULSE_AMP;
    };

    // track hover/select changes inside the loop (avoids effect ordering).
    // Indices are range-checked: a stale index from a swapped agent set must
    // never dereference agents[] (it killed the render loop once).
    const hov = hoveredIdx != null && hoveredIdx < count ? hoveredIdx : -1;
    if (prevHover.current !== hov) {
      if (prevHover.current !== -1) settling.current.add(prevHover.current);
      if (hov !== -1) settling.current.add(hov);
      prevHover.current = hov;
    }
    if (prevSelect.current !== selectedIdx) {
      if (prevSelect.current !== -1) settling.current.add(prevSelect.current);
      if (selectedIdx !== -1) settling.current.add(selectedIdx);
      prevSelect.current = selectedIdx;
    }

    if (reduced) {
      // reduced motion: no entrance, no pulse — snap any hover/select growth
      if (settling.current.size === 0) return;
      for (const i of settling.current) {
        if (i >= count) {
          settling.current.delete(i);
          continue;
        }
        const target = i === hov ? HOVER_BOOST : i === selectedIdx ? SELECT_BOOST : 1;
        boost.current[i] = target;
        writeInstance(i, target, zFor(i));
      }
      settling.current.clear();
      m.instanceMatrix.needsUpdate = true;
      h.instanceMatrix.needsUpdate = true;
      state.invalidate();
      return;
    }

    pulsePhase.current += dt * PULSE_SPEED;
    let wrote = false;

    if (!entrance.current.done) {
      // deploy: grow every node in staggered waves
      entrance.current.t += dt;
      const t = entrance.current.t;
      for (let i = 0; i < count; i++) {
        const grow = easeOutCubic((t - stagger[i]) / ENTRANCE_DUR);
        const target = i === hov ? HOVER_BOOST : i === selectedIdx ? SELECT_BOOST : 1;
        boost.current[i] = THREE.MathUtils.damp(boost.current[i], target, 12, dt);
        writeInstance(i, grow * boost.current[i] * pulseFor(i), zFor(i));
      }
      if (t >= ENTRANCE_SPREAD + ENTRANCE_DUR) entrance.current.done = true;
      wrote = true;
    } else {
      // steady state: only the attention set + anything mid-transition
      for (let k = 0; k < attentionIdx.length; k++) {
        const i = attentionIdx[k];
        boost.current[i] = THREE.MathUtils.damp(
          boost.current[i],
          i === hov ? HOVER_BOOST : i === selectedIdx ? SELECT_BOOST : 1,
          12,
          dt
        );
        writeInstance(i, boost.current[i] * pulseFor(i), zFor(i));
        wrote = true;
      }
      if (settling.current.size > 0) {
        for (const i of settling.current) {
          if (i >= count) {
            settling.current.delete(i);
            continue;
          }
          const target = i === hov ? HOVER_BOOST : i === selectedIdx ? SELECT_BOOST : 1;
          boost.current[i] = THREE.MathUtils.damp(boost.current[i], target, 12, dt);
          const done = Math.abs(boost.current[i] - target) < 0.004;
          if (done) boost.current[i] = target;
          writeInstance(i, boost.current[i] * pulseFor(i), zFor(i));
          // attention nodes stay animated via the pulse loop above
          if (done && i !== hov && i !== selectedIdx) settling.current.delete(i);
          wrote = true;
        }
      }
    }

    if (wrote) {
      m.instanceMatrix.needsUpdate = true;
      h.instanceMatrix.needsUpdate = true;
      state.invalidate(); // keep frames coming while animating (demand)
    }
  });

  return (
    <group>
      {/* additive halos — drawn beneath the nodes, never picked */}
      <instancedMesh
        ref={halo}
        args={[haloGeom, undefined, count]}
        frustumCulled={false}
        raycast={() => null}
        renderOrder={0}
      >
        <meshBasicMaterial
          map={haloTex}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </instancedMesh>

      {/* solid emissive nodes — the pickable surface */}
      <instancedMesh
        ref={mesh}
        args={[geom, undefined, count]}
        frustumCulled={false}
        renderOrder={1}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          if (e.instanceId != null && e.instanceId !== hoveredIdx) {
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
          // e.delta = px between pointerdown/up — a camera drag is not a click
          if (e.instanceId != null && e.delta < 6) {
            onSelect(e.instanceId);
            invalidate();
          }
        }}
      >
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Cluster chrome (rings / hull / labels) — fixed small count
// ---------------------------------------------------------------------------

function ringPoints(cx: number, cy: number, r: number, z: number, seg = 72): [number, number, number][] {
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, z]);
  }
  return pts;
}

/** Octagonal tactical hull (cut-corner bounding ring) for one cluster. */
function hullPoints(cx: number, cy: number, r: number, z: number): [number, number, number][] {
  const pts: [number, number, number][] = [];
  const seg = 8;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2 + Math.PI / 8;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, z]);
  }
  return pts;
}

function ClusterRing({
  cluster,
  emphasized,
  reduced,
}: {
  cluster: ClusterInfo;
  emphasized: boolean;
  reduced: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const hullR = cluster.radius * 1.14;
  const hull = useMemo(
    () => hullPoints(cluster.cx, cluster.cy, hullR, -0.2),
    [cluster.cx, cluster.cy, hullR]
  );
  const inner = useMemo(
    () => ringPoints(cluster.cx, cluster.cy, cluster.radius * 1.02, -0.25),
    [cluster.cx, cluster.cy, cluster.radius]
  );
  const critical = cluster.critical;
  // Hulls are NEUTRAL sector chrome (dim cyan) — only critical sectors go red,
  // so the hull color channel carries exactly one unambiguous message.
  const hullColor = critical ? HUD.red : HUD.cyanDim;

  // entrance: fade the ring chrome in (staggered per cluster) by ramping every
  // child material's opacity toward its authored value. Authored opacities are
  // cached on material.userData the first time we see each material. Keyed on
  // cluster.index (not the cluster object) so live data ticks — which produce
  // fresh cluster objects — never replay the fade.
  const fade = useRef({ t: 0, done: false });
  useEffect(() => {
    fade.current = { t: 0, done: reduced };
    if (reduced) return;
    group.current?.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (mat && typeof mat.opacity === 'number') {
        if (mat.userData.baseOpacity === undefined) mat.userData.baseOpacity = mat.opacity;
        mat.opacity = 0;
      }
    });
  }, [reduced, cluster.index]);
  useFrame((state, delta) => {
    if (fade.current.done || !group.current) return;
    fade.current.t += Math.min(delta, 0.05);
    const u = easeOutCubic((fade.current.t - 0.12 - cluster.index * 0.07) / 0.6);
    group.current.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (mat && mat.userData.baseOpacity !== undefined) {
        mat.opacity = mat.userData.baseOpacity * u;
      }
    });
    if (u >= 1) fade.current.done = true;
    state.invalidate();
  });

  return (
    <group ref={group}>
      {/* soft filled disc under the cluster for grounding / depth */}
      <mesh position={[cluster.cx, cluster.cy, -0.6]} raycast={() => null}>
        <circleGeometry args={[hullR, 48]} />
        <meshBasicMaterial
          color={critical ? HUD.red : HUD.cyan}
          transparent
          opacity={critical ? 0.06 : 0.022}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <Line
        points={hull}
        color={emphasized ? HUD.cyan : hullColor}
        lineWidth={emphasized ? 2.6 : critical ? 2.0 : 1.3}
        transparent
        opacity={emphasized ? 0.95 : critical ? 0.85 : 0.6}
        toneMapped={false}
        raycast={() => null}
      />
      <Line
        points={inner}
        color={HUD.cyanDim}
        lineWidth={1}
        transparent
        opacity={0.24}
        dashed
        dashSize={4}
        gapSize={4}
        toneMapped={false}
        raycast={() => null}
      />
    </group>
  );
}

// Same-origin bundled font. troika's DEFAULT font is fetched from a CDN; in a
// sandboxed/offline runtime that fetch can hang forever, which (because <Text>
// suspends) blanks the ENTIRE Canvas tree. A local /public asset is a
// guaranteed same-origin load; labels are wrapped in <Suspense> regardless.
const LABEL_FONT = '/fonts/Exo2-Medium.ttf';

/** minimal shape we mutate on troika Text objects (material opacity) */
type TextLike = THREE.Object3D & { material: { opacity: number } };

function ClusterLabel({
  cluster,
  sceneR,
  reduced,
}: {
  cluster: ClusterInfo;
  /** whole-field radius — drives the deep-zoom label fade */
  sceneR: number;
  reduced: boolean;
}) {
  const hot = cluster.critical;
  const size = THREE.MathUtils.clamp(cluster.radius * 0.26, 3.2, 28);
  const titleRef = useRef<TextLike>(null);
  const subRef = useRef<TextLike>(null);
  const group = useRef<THREE.Group>(null);
  const fade = useRef(1);

  // Camera-aware fade: sector names are OVERVIEW chrome. They dissolve when
  // the camera dives into this sector (near fade) or deep into the field at
  // large scales (zoom fade) so labels never wall over a zoomed view.
  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    const cam = state.camera.position;
    const dNear = Math.hypot(cam.x - cluster.cx, cam.y - cluster.cy, cam.z);
    const nearFade = THREE.MathUtils.clamp(
      (dNear - cluster.radius * 1.7) / (cluster.radius * 1.3),
      0,
      1
    );
    const zoomFade = THREE.MathUtils.clamp(
      (cam.length() / sceneR - 0.4) / 0.3,
      0,
      1
    );
    const target = Math.min(nearFade, zoomFade);
    const next = reduced
      ? target
      : THREE.MathUtils.damp(fade.current, target, 8, Math.min(delta, 0.05));
    if (Math.abs(next - fade.current) > 0.002) {
      fade.current = next;
      if (titleRef.current) titleRef.current.material.opacity = next;
      if (subRef.current) subRef.current.material.opacity = next * 0.9;
      g.visible = next > 0.02;
      state.invalidate();
    }
  });

  return (
    <group ref={group} position={[cluster.cx, cluster.cy, 0.1]}>
      <Text
        ref={titleRef as never}
        font={LABEL_FONT}
        position={[0, cluster.radius * 1.2 + size * 0.75, 0]}
        fontSize={size}
        maxWidth={Math.max(cluster.radius * 3, 30)}
        textAlign="center"
        color={hot ? HUD.red : HUD.cyan}
        anchorX="center"
        anchorY="bottom"
        letterSpacing={0.16}
        lineHeight={1.1}
        outlineWidth={size * 0.04}
        outlineColor={HUD.bg.void}
        material-toneMapped={false}
        material-transparent
        raycast={() => null}
      >
        {cluster.label.toUpperCase()}
      </Text>
      <Text
        ref={subRef as never}
        font={LABEL_FONT}
        position={[0, cluster.radius * 1.16, 0]}
        fontSize={size * 0.5}
        color={hot ? HUD.amber : HUD.textDim}
        anchorX="center"
        anchorY="bottom"
        letterSpacing={0.18}
        outlineWidth={size * 0.03}
        outlineColor={HUD.bg.void}
        material-toneMapped={false}
        material-transparent
        raycast={() => null}
      >
        {`${cluster.count} UNITS${cluster.attention > 0 ? ` · ${cluster.attention} BLOCKED` : ''}`}
      </Text>
    </group>
  );
}

/** Hub trunk network (grafted from Direction B): a faint command spine linking
 *  adjacent cluster centers, so the fleet reads as one connected operation. */
function TrunkNetwork({ clusters }: { clusters: ClusterInfo[] }) {
  const points = useMemo(() => {
    if (clusters.length < 2) return null;
    const pts: [number, number, number][] = [];
    for (let i = 0; i < clusters.length; i++) {
      const a = clusters[i];
      const b = clusters[(i + 1) % clusters.length];
      pts.push([a.cx, a.cy, -0.5], [b.cx, b.cy, -0.5]);
    }
    return pts;
  }, [clusters]);
  if (!points) return null;
  return (
    <Line
      points={points}
      segments
      color={HUD.cyan2}
      lineWidth={1}
      transparent
      opacity={0.13}
      dashed
      dashSize={6}
      gapSize={5}
      depthWrite={false}
      toneMapped={false}
      raycast={() => null}
    />
  );
}

// ---------------------------------------------------------------------------
// Focus ring (hover = cyan, select = magenta) — spins + pops in
// ---------------------------------------------------------------------------

function FocusRing({
  agent,
  color,
  reduced,
}: {
  agent: FieldAgent;
  color: string;
  reduced: boolean;
}) {
  const ref = useRef<THREE.Group>(null);
  const baseR = STATUS_SIZE[agent.status] * 2.0;
  const spin = useRef(0);
  const pop = useRef(1.6); // pop-in: scale settles 1.6 → 1
  useEffect(() => {
    // keyed on the agent's ID: a live data tick (fresh agent object, same
    // agent) must not replay the pop
    pop.current = reduced ? 1 : 1.6;
  }, [agent.id, reduced]);
  useFrame((state, delta) => {
    if (!ref.current) return;
    if (reduced) {
      ref.current.scale.setScalar(1);
      return;
    }
    const dt = Math.min(delta, 0.05);
    spin.current += dt * 0.8;
    pop.current = THREE.MathUtils.damp(pop.current, 1, 10, dt);
    if (Math.abs(pop.current - 1) < 0.002) pop.current = 1;
    ref.current.rotation.z = Math.PI / 4 + spin.current;
    ref.current.scale.setScalar(pop.current);
    state.invalidate();
  });
  return (
    <group ref={ref} position={[agent.x, agent.y, 1.8]} rotation={[0, 0, Math.PI / 4]}>
      <mesh raycast={() => null}>
        <ringGeometry args={[baseR * 1.5, baseR * 1.85, 4]} />
        <meshBasicMaterial color={color} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Floor: grid (grafted from A) + far radial backdrop (grafted from B)
// ---------------------------------------------------------------------------

function VoidBackdrop({ radius }: { radius: number }) {
  const tex = useMemo(() => {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(20,70,120,0.28)');
    g.addColorStop(0.5, 'rgba(10,30,60,0.10)');
    g.addColorStop(1, 'rgba(4,6,11,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <mesh position={[0, 0, -radius * 1.2]} raycast={() => null} renderOrder={-1}>
      <planeGeometry args={[radius * 5, radius * 5]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Camera rig + imperative handle
// ---------------------------------------------------------------------------

const POLAR_TILT = Math.PI * 0.4; // war-table rake (see variant-C notes)

function Rig({
  radius,
  agents,
  clusters,
  reduced,
  controllerRef,
  onNavigate,
}: {
  radius: number;
  agents: FieldAgent[];
  clusters: ClusterInfo[];
  reduced: boolean;
  controllerRef?: { current: AgentFieldHandle | null };
  /** fired on every programmatic camera move (used to drop stale hover) */
  onNavigate?: () => void;
}) {
  const controls = useRef<CameraControls>(null);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    // Frame the whole field, then apply the war-table tilt. fitToSphere moves
    // the camera programmatically — under frameloop="demand" we must
    // invalidate() afterwards or the fitted frame never paints (blank canvas).
    _sphere.set(_v3.set(0, 0, 0), radius * 1.08);
    c.fitToSphere(_sphere, false);
    c.rotatePolarTo(POLAR_TILT, false);
    invalidate();
  }, [radius, invalidate]);

  useEffect(() => {
    if (!controllerRef) return;
    const t = !reduced; // smooth transitions unless reduced motion
    const nav = () => {
      onNavigate?.();
      invalidate();
    };
    controllerRef.current = {
      focusCluster(index) {
        const cl = clusters[index];
        const c = controls.current;
        if (!cl || !c) return;
        _sphere.set(_v3.set(cl.cx, cl.cy, 0), Math.max(cl.radius * 1.5, 30));
        c.fitToSphere(_sphere, t);
        nav();
      },
      focusAgent(id) {
        const a = agents.find((x) => x.id === id);
        const c = controls.current;
        if (!a || !c) return;
        const cl = clusters[a.cluster];
        _sphere.set(_v3.set(a.x, a.y, 0), Math.max(26, (cl?.radius ?? 60) * 0.5));
        c.fitToSphere(_sphere, t);
        nav();
      },
      overview() {
        const c = controls.current;
        if (!c) return;
        _sphere.set(_v3.set(0, 0, 0), radius * 1.08);
        c.fitToSphere(_sphere, t);
        c.rotatePolarTo(POLAR_TILT, t);
        nav();
      },
      dolly(steps) {
        controls.current?.dolly(steps * radius * 0.18, t);
        nav();
      },
      truck(dx, dy) {
        controls.current?.truck(dx * radius * 0.09, dy * radius * 0.09, t);
        nav();
      },
      orbit(dAz) {
        controls.current?.rotate(dAz, 0, t);
        nav();
      },
    };
    return () => {
      controllerRef.current = null;
    };
  }, [controllerRef, agents, clusters, radius, reduced, invalidate, onNavigate]);

  return (
    <CameraControls
      ref={controls}
      makeDefault
      smoothTime={0.35}
      draggingSmoothTime={0.08}
      minDistance={22}
      maxDistance={radius * 5}
      // war-table view band: never edge-on, never degenerate
      minPolarAngle={Math.PI * 0.26}
      maxPolarAngle={Math.PI * 0.48}
      minAzimuthAngle={-0.9}
      maxAzimuthAngle={0.9}
      dollyToCursor
    />
  );
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export function AgentField({
  agents,
  clusters,
  selectedId,
  focusedCluster = null,
  onSelect,
  onHoverAgent,
  controllerRef,
}: {
  agents: FieldAgent[];
  clusters: ClusterInfo[];
  selectedId: string | null;
  /** keyboard-focused sector — its hull is emphasized */
  focusedCluster?: number | null;
  onSelect: (id: string | null) => void;
  onHoverAgent?: (agent: FieldAgent | null) => void;
  controllerRef?: { current: AgentFieldHandle | null };
}) {
  const reduced = useReducedMotion();
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const radius = useMemo(() => sceneRadius(clusters), [clusters]);

  // a hover index from a differently-SIZED fleet is meaningless (and possibly
  // out of range) — drop it. Same-size live ticks keep the hover (the range
  // guards in Constellation cover the rare membership swap until the next
  // pointer move).
  useEffect(() => {
    setHoveredIdx(null);
  }, [agents.length]);

  // programmatic camera moves invalidate what's under the (stationary) pointer;
  // drop the hover so no stale ring/tooltip floats mid-screen after a fly-to
  const clearHover = useCallback(() => setHoveredIdx(null), []);

  const hovered = hoveredIdx != null ? agents[hoveredIdx] ?? null : null;
  const selectedIdx = useMemo(
    () => (selectedId ? agents.findIndex((a) => a.id === selectedId) : -1),
    [agents, selectedId]
  );
  const selected = selectedIdx >= 0 ? agents[selectedIdx] : null;

  useEffect(() => {
    onHoverAgent?.(hovered);
  }, [hovered, onHoverAgent]);

  // never leave a pointer cursor behind when the world unmounts
  useEffect(
    () => () => {
      document.body.style.cursor = 'auto';
    },
    []
  );

  // Track pointer drag distance so onPointerMissed can tell a background
  // CLICK (deselect/ascend) from the release of a camera DRAG. Mesh clicks
  // get this for free via ThreeEvent.delta; the missed path does not.
  const dragDist = useRef(0);
  useEffect(() => {
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      dragDist.current = down ? Math.hypot(e.clientX - down.x, e.clientY - down.y) : 0;
      down = null;
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      camera={{
        position: [0, -radius * 0.55, radius * 1.25],
        fov: 42,
        near: 0.1,
        far: radius * 14,
      }}
      gl={{ antialias: true }}
      onPointerMissed={() => {
        if (dragDist.current < 6) onSelect(null);
      }}
      onCreated={({ gl }) => {
        if (process.env.NODE_ENV !== 'production') {
          (window as unknown as { __EVAL_GL__?: THREE.WebGLRenderer }).__EVAL_GL__ = gl;
        }
      }}
      aria-hidden="true"
    >
      <color attach="background" args={[HUD.bg.void]} />
      {/* far-only depth haze: only deep background falls off to void */}
      <fog attach="fog" args={[HUD.bg.void, radius * 4.5, radius * 9]} />
      <Rig
        radius={radius}
        agents={agents}
        clusters={clusters}
        reduced={reduced}
        controllerRef={controllerRef}
        onNavigate={clearHover}
      />

      <VoidBackdrop radius={radius} />
      {/* floor grid (A graft): drei Grid lives in XZ, rotate into our XY plane.
          Cell/section sizes scale with the FIELD so density reads the same at
          64 and 4096 agents; colors sit just above the void so the grid stays
          ground, never competing with the data layer. */}
      <Grid
        position={[0, 0, -2]}
        rotation={[Math.PI / 2, 0, 0]}
        args={[radius * 2.6, radius * 2.6]}
        cellSize={radius / 18}
        cellThickness={0.4}
        cellColor="#0F2A34"
        sectionSize={radius / 4.5}
        sectionThickness={0.85}
        sectionColor="#1B4E5C"
        fadeDistance={radius * 3.1}
        fadeStrength={2.4}
        followCamera={false}
        infiniteGrid={false}
        side={THREE.DoubleSide}
        raycast={() => null}
      />

      <TrunkNetwork clusters={clusters} />

      {clusters.map((c) => (
        <ClusterRing
          key={`${agents.length}-${c.index}`}
          cluster={c}
          emphasized={
            hovered?.cluster === c.index ||
            selected?.cluster === c.index ||
            focusedCluster === c.index
          }
          reduced={reduced}
        />
      ))}

      <Constellation
        key={agents.length}
        agents={agents}
        clusters={clusters}
        hoveredIdx={hoveredIdx}
        selectedIdx={selectedIdx}
        reduced={reduced}
        onHover={setHoveredIdx}
        onSelect={(i) => onSelect(agents[i].id)}
      />

      {/* Labels in their own Suspense boundary: a slow font load can never
          gate the nodes/rings — labels pop in when the SDF is ready. */}
      <Suspense fallback={null}>
        {clusters.map((c) => (
          <ClusterLabel key={c.index} cluster={c} sceneR={radius} reduced={reduced} />
        ))}
      </Suspense>

      {hovered && <FocusRing agent={hovered} color={HUD.cyan} reduced={reduced} />}
      {selected && <FocusRing agent={selected} color={HUD.magenta} reduced={reduced} />}

      <EffectComposer>
        <Bloom
          luminanceThreshold={0.5}
          luminanceSmoothing={0.25}
          intensity={0.95}
          radius={0.6}
          mipmapBlur
        />
        <Vignette eskil={false} offset={0.28} darkness={0.62} />
      </EffectComposer>
    </Canvas>
  );
}

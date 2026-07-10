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
 *  - blocked/error agents burn hotter; new blockers/activity receive a finite
 *    state blip and then park.
 *
 * Game-feel systems (all demand-loop friendly — they park when settled):
 *  - staggered "deploy" entrance: nodes scale in over ~1.2s on mount;
 *  - hover-grow / select-grow with frame-rate-independent finite damp;
 *  - camera fly-to via an imperative AgentFieldHandle (focusCluster/focusAgent/
 *    overview/dolly/truck/orbit) driven by the DOM chrome's keyboard layer;
 *  - CameraControls smooth transitions self-sustain under frameloop="demand"
 *    (drei invalidates on camera-controls 'update'/'transitionstart' events).
 *
 * Scaling contract: ALL agents render as ONE InstancedMesh (nodes) + ONE
 * InstancedMesh (halos) — draw calls stay ~constant from 64 → 10k+. Clusters
 * are LAYOUT, not meshes. Follows docs/engineering/r3f-authoring-guide.md.
 */
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { CameraControls, Grid, Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import type { AgentStatus } from '@exawatt/core';
import { HUD, HUD_STATUS_COLOR } from '../tokens';
import { isLowPowerSpatialDevice } from './agent-field-capabilities';
import { layoutProjectDeck } from './agent-field-regime-layout';
import { AgentRegime, ProjectRegime } from './agent-field-regimes';
import {
  fleetClusterCenters,
  fleetSceneRadius,
  isSparseFleetComposition,
  sparseProjectBaySize,
} from './agent-field-fleet-layout';
import type {
  AgentFieldRegime,
  ClusterInfo,
  FieldAgent,
  FieldGroupSpec,
  FieldHero,
} from './agent-field-types';

export type {
  AgentFieldRegime,
  ClusterInfo,
  FieldAgent,
  FieldGroupAgent,
  FieldGroupSpec,
  FieldHero,
} from './agent-field-types';

const AgentFieldEffects = lazy(() =>
  import('./agent-field-effects').then(mod => ({
    default: mod.AgentFieldEffects,
  }))
);

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
  /**
   * Small instant increments for per-frame held-key GLIDE (pan/zoom/orbit).
   * No transition — camera-controls' own smoothTime damping makes the glide
   * feel fluid while frames stream in.
   */
  nudge(dx: number, dy: number, dollySteps: number, dAzimuth: number): void;
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

  const counts = groups.map(g => g.countOverride ?? g.agents.length);

  const localRadius = (count: number) =>
    Math.max(NODE_PITCH * 2, Math.sqrt(Math.max(count, 1)) * NODE_PITCH);

  const maxLocal = Math.max(...counts.map(localRadius));
  const centers = fleetClusterCenters(numClusters, maxLocal);

  const golden = Math.PI * (3 - Math.sqrt(5));
  const clusters: ClusterInfo[] = [];
  const agents: FieldAgent[] = [];

  for (let c = 0; c < numClusters; c++) {
    const g = groups[c];
    const cx = centers[c].x;
    const cy = centers[c].y;
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
        detail: a.detail,
        activityAt: a.activityAt,
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
      statLine: g.statLine,
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
  const groups: FieldGroupSpec[] = Array.from(
    { length: numClusters },
    (_, c) => ({
      id: PROJECT_NAMES[c],
      label: PROJECT_NAMES[c],
      agents: [],
    })
  );
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
  return fleetSceneRadius(
    clusters.map(cluster => ({
      x: cluster.cx,
      y: cluster.cy,
      radius: cluster.radius,
    }))
  );
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

function readLowPowerHint(): boolean {
  if (typeof navigator === 'undefined') return false;
  const extended = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };
  return isLowPowerSpatialDevice({
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: extended.deviceMemory,
    saveData: extended.connection?.saveData,
  });
}

function useLowPowerMode(): boolean {
  const [lowPower] = useState(readLowPowerHint);
  return lowPower;
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
const _box = new THREE.Box3();
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
    const g = ctx.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2
    );
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
const BLIP_DUR = 0.7; // activity blip length (s)
const BLIP_AMP = 0.45; // activity blip peak growth

function Constellation({
  agents,
  clusters,
  hoveredIdx,
  selectedIdx,
  reduced,
  surfaceZ = 0,
  onHover,
  onSelect,
}: {
  agents: FieldAgent[];
  clusters: ClusterInfo[];
  hoveredIdx: number | null;
  selectedIdx: number;
  reduced: boolean;
  surfaceZ?: number;
  onHover: (i: number | null) => void;
  onSelect: (i: number) => void;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const halo = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree(s => s.invalidate);
  const count = agents.length;

  // diamond plate: a thin box reads as a beveled chit on the tactical map
  const geom = useMemo(() => new THREE.BoxGeometry(1, 1, 0.5), []);
  const haloGeom = useMemo(
    () => new THREE.PlaneGeometry(HALO_MUL, HALO_MUL),
    []
  );
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
    () => clusters.map(c => densityScale(c.count)),
    [clusters]
  );
  const agentIndex = useMemo(
    () => new Map(agents.map((agent, index) => [agent.id, index])),
    [agents]
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
  const seeded = useRef(false);
  // Finite state blips: activity arrival or transition into attention.
  const prevActivity = useRef(new Map<string, number>());
  const prevStatus = useRef(new Map<string, AgentStatus>());
  const blips = useRef(new Map<string, number>()); // stable agent id -> seconds remaining

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
    if (i === hoveredIdx || i === selectedIdx) return surfaceZ + 1.4;
    const st = agents[i].status;
    return surfaceZ + (st === 'blocked' || st === 'error' ? 0.05 : 0);
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
    // Detect semantic changes. Stable blocked state stays visually strong but
    // static; only a new blocker/error or activity event starts finite motion.
    for (let i = 0; i < count; i++) {
      const a = agents[i];
      const previousStatus = prevStatus.current.get(a.id);
      if (
        seeded.current &&
        previousStatus !== a.status &&
        (a.status === 'blocked' || a.status === 'error') &&
        entrance.current.done &&
        !reduced
      ) {
        blips.current.set(a.id, BLIP_DUR);
      }
      prevStatus.current.set(a.id, a.status);
      if (a.activityAt !== undefined) {
        const prev = prevActivity.current.get(a.id);
        if (
          seeded.current &&
          prev !== undefined &&
          a.activityAt > prev &&
          entrance.current.done &&
          !reduced
        ) {
          blips.current.set(a.id, BLIP_DUR);
        }
        prevActivity.current.set(a.id, a.activityAt);
      }
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
      _color
        .set(base)
        .multiplyScalar(
          (attention ? 0.62 : 0.4) * (0.35 + clusterDensity[a.cluster] * 0.65)
        );
      h.setColorAt(i, _color);
    }
    seeded.current = true;
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

  // ---- the animation loop: entrance → finite hover/select/state settles ----
  useFrame((state, delta) => {
    const m = mesh.current;
    const h = halo.current;
    if (!m || !h) return;
    const dt = Math.min(delta, 0.05);
    _dummy.rotation.set(0, 0, Math.PI / 4);

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
      // reduced motion: no entrance/blips — snap hover/select
      blips.current.clear();
      if (settling.current.size === 0) return;
      for (const i of settling.current) {
        if (i >= count) {
          settling.current.delete(i);
          continue;
        }
        const target =
          i === hov ? HOVER_BOOST : i === selectedIdx ? SELECT_BOOST : 1;
        boost.current[i] = target;
        writeInstance(i, target, zFor(i));
      }
      settling.current.clear();
      m.instanceMatrix.needsUpdate = true;
      h.instanceMatrix.needsUpdate = true;
      state.invalidate();
      return;
    }

    let wrote = false;

    if (!entrance.current.done) {
      // deploy: grow every node in staggered waves
      entrance.current.t += dt;
      const t = entrance.current.t;
      for (let i = 0; i < count; i++) {
        const grow = easeOutCubic((t - stagger[i]) / ENTRANCE_DUR);
        const target =
          i === hov ? HOVER_BOOST : i === selectedIdx ? SELECT_BOOST : 1;
        boost.current[i] = THREE.MathUtils.damp(
          boost.current[i],
          target,
          12,
          dt
        );
        writeInstance(i, grow * boost.current[i], zFor(i));
      }
      if (t >= ENTRANCE_SPREAD + ENTRANCE_DUR) entrance.current.done = true;
      wrote = true;
    } else {
      if (settling.current.size > 0) {
        for (const i of settling.current) {
          if (i >= count) {
            settling.current.delete(i);
            continue;
          }
          const target =
            i === hov ? HOVER_BOOST : i === selectedIdx ? SELECT_BOOST : 1;
          boost.current[i] = THREE.MathUtils.damp(
            boost.current[i],
            target,
            12,
            dt
          );
          const done = Math.abs(boost.current[i] - target) < 0.004;
          if (done) boost.current[i] = target;
          writeInstance(i, boost.current[i], zFor(i));
          if (done) settling.current.delete(i);
          wrote = true;
        }
      }
      // activity blips: brief pop when a live event lands on an agent
      if (blips.current.size > 0) {
        for (const [id, rem] of blips.current) {
          const i = agentIndex.get(id);
          if (i === undefined) {
            blips.current.delete(id);
            continue;
          }
          const next = rem - dt;
          if (next <= 0) {
            blips.current.delete(id);
            writeInstance(i, boost.current[i], zFor(i));
          } else {
            blips.current.set(id, next);
            const u = 1 - next / BLIP_DUR;
            const factor = 1 + Math.sin(Math.PI * u) * BLIP_AMP;
            writeInstance(i, boost.current[i] * factor, zFor(i));
          }
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

function ringPoints(
  cx: number,
  cy: number,
  r: number,
  z: number,
  seg = 72
): [number, number, number][] {
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, z]);
  }
  return pts;
}

/** Octagonal tactical hull (cut-corner bounding ring) for one cluster. */
function hullPoints(
  cx: number,
  cy: number,
  r: number,
  z: number
): [number, number, number][] {
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
  interactive = false,
  onSelect,
  onHoverChange,
}: {
  cluster: ClusterInfo;
  emphasized: boolean;
  reduced: boolean;
  /** when true the sector has a click/hover pick disc (drill affordance) */
  interactive?: boolean;
  onSelect?: () => void;
  onHoverChange?: (hovered: boolean) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const invalidate = useThree(s => s.invalidate);
  const hullR = cluster.radius * 1.14;
  // pick disc must clear MAX node reach, not just the layout disc: nodes are
  // 45°-rotated diamonds (corner = half-extent·√2) that pulse (1.16×) and
  // hover-grow (1.5×) — at small clusters that reach exceeds radius*1.45 and
  // the nodes swallow the whole "sector space" (found the hard way)
  const pickR = Math.max(cluster.radius * 1.45, cluster.radius + 9);
  const hull = useMemo(
    () => hullPoints(cluster.cx, cluster.cy, hullR, -0.2),
    [cluster.cx, cluster.cy, hullR]
  );
  const inner = useMemo(
    () => ringPoints(cluster.cx, cluster.cy, cluster.radius * 1.02, -0.25),
    [cluster.cx, cluster.cy, cluster.radius]
  );
  const critical = cluster.critical;
  const emph = emphasized;
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
    group.current?.traverse(o => {
      const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (mat && typeof mat.opacity === 'number') {
        if (mat.userData.baseOpacity === undefined)
          mat.userData.baseOpacity = mat.opacity;
        mat.opacity = 0;
      }
    });
  }, [reduced, cluster.index]);
  useFrame((state, delta) => {
    if (fade.current.done || !group.current) return;
    fade.current.t += Math.min(delta, 0.05);
    const u = easeOutCubic(
      (fade.current.t - 0.12 - cluster.index * 0.07) / 0.6
    );
    group.current.traverse(o => {
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
          opacity={critical ? 0.06 : emph && interactive ? 0.05 : 0.022}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {/* invisible generous pick disc: clicking a sector (its nodes excluded —
          they sit nearer and stopPropagation) drills into the project */}
      {interactive && (
        <mesh
          position={[cluster.cx, cluster.cy, -0.7]}
          onPointerOver={(e: ThreeEvent<PointerEvent>) => {
            e.stopPropagation();
            onHoverChange?.(true);
            document.body.style.cursor = 'pointer';
            invalidate();
          }}
          onPointerOut={() => {
            onHoverChange?.(false);
            document.body.style.cursor = 'auto';
            invalidate();
          }}
          onClick={(e: ThreeEvent<MouseEvent>) => {
            e.stopPropagation();
            if (e.delta < 6 && onSelect) {
              onSelect();
              invalidate();
            }
          }}
        >
          <circleGeometry args={[pickR, 32]} />
          <meshBasicMaterial colorWrite={false} depthWrite={false} />
        </mesh>
      )}
      <Line
        points={hull}
        color={emph ? HUD.cyan : hullColor}
        lineWidth={emph ? 2.6 : critical ? 2.0 : 1.3}
        transparent
        opacity={emph ? 0.95 : critical ? 0.85 : 0.6}
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

const BAY_EXTRUDE = {
  depth: 1.1,
  bevelEnabled: true,
  bevelSegments: 2,
  steps: 1,
  bevelSize: 0.38,
  bevelThickness: 0.34,
} as const;

function SparseProjectBay({
  cluster,
  emphasized,
  reduced,
  interactive,
  onSelect,
  onHoverChange,
}: {
  cluster: ClusterInfo;
  emphasized: boolean;
  reduced: boolean;
  interactive: boolean;
  onSelect?: () => void;
  onHoverChange?: (hovered: boolean) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const material = useRef<THREE.MeshStandardMaterial>(null);
  const invalidate = useThree(state => state.invalidate);
  const { width, height } = sparseProjectBaySize(cluster.radius);
  const shape = useMemo(() => {
    const cut = 2.2;
    const left = -width / 2;
    const right = width / 2;
    const bottom = -height / 2;
    const top = height / 2;
    const next = new THREE.Shape();
    next.moveTo(left + cut, bottom);
    next.lineTo(right - cut, bottom);
    next.lineTo(right, bottom + cut);
    next.lineTo(right, top - cut);
    next.lineTo(right - cut, top);
    next.lineTo(left + cut, top);
    next.lineTo(left, top - cut);
    next.lineTo(left, bottom + cut);
    next.closePath();
    return next;
  }, [height, width]);
  const statusColor = cluster.critical
    ? HUD.red
    : HUD_STATUS_COLOR[cluster.dominant];
  const targetZ = emphasized ? 0.7 : 0;
  const targetScale = emphasized ? 1.025 : 1;

  useEffect(() => {
    invalidate();
  }, [emphasized, invalidate]);

  useFrame((state, delta) => {
    const node = group.current;
    const mat = material.current;
    if (!node || !mat) return;
    const targetEmissive = emphasized ? 0.1 : cluster.critical ? 0.07 : 0.02;
    if (reduced) {
      node.position.z = targetZ;
      node.scale.setScalar(targetScale);
      mat.emissiveIntensity = targetEmissive;
      return;
    }
    const dt = Math.min(delta, 0.05);
    node.position.z = THREE.MathUtils.damp(node.position.z, targetZ, 10, dt);
    const scale = THREE.MathUtils.damp(node.scale.x, targetScale, 11, dt);
    node.scale.setScalar(scale);
    mat.emissiveIntensity = THREE.MathUtils.damp(
      mat.emissiveIntensity,
      targetEmissive,
      9,
      dt
    );
    if (
      Math.abs(node.position.z - targetZ) > 0.002 ||
      Math.abs(scale - targetScale) > 0.002 ||
      Math.abs(mat.emissiveIntensity - targetEmissive) > 0.002
    ) {
      state.invalidate();
    }
  });

  return (
    <group
      ref={group}
      position={[cluster.cx, cluster.cy, 0]}
      onPointerOver={(event: ThreeEvent<PointerEvent>) => {
        if (!interactive) return;
        event.stopPropagation();
        onHoverChange?.(true);
        document.body.style.cursor = 'pointer';
        invalidate();
      }}
      onPointerOut={() => {
        onHoverChange?.(false);
        document.body.style.cursor = 'auto';
        invalidate();
      }}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        if (!interactive) return;
        event.stopPropagation();
        if (event.delta < 6) onSelect?.();
      }}
    >
      <mesh position={[0, 0, -1.4]} raycast={() => null}>
        <planeGeometry args={[width + 3, height + 3]} />
        <meshBasicMaterial
          color="#010407"
          transparent
          opacity={0.52}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, 0, -0.9]}>
        <extrudeGeometry args={[shape, BAY_EXTRUDE]} />
        <meshStandardMaterial
          ref={material}
          color="#0a1217"
          emissive={statusColor}
          emissiveIntensity={cluster.critical ? 0.07 : 0.02}
          metalness={0.52}
          roughness={0.5}
        />
      </mesh>
      <mesh position={[0, 0, 0.45]} raycast={() => null}>
        <boxGeometry args={[width - 2.4, height - 2.4, 0.34]} />
        <meshStandardMaterial
          color="#101b21"
          metalness={0.28}
          roughness={0.7}
        />
      </mesh>
      <mesh position={[-width / 2 + 0.8, 0, 0.9]} raycast={() => null}>
        <boxGeometry args={[0.48, height - 4.2, 0.28]} />
        <meshBasicMaterial color={statusColor} toneMapped={false} />
      </mesh>
      <mesh
        position={[width / 2 - 1.2, -height / 2 + 1.15, 0.9]}
        raycast={() => null}
      >
        <boxGeometry args={[2.1, 0.46, 0.26]} />
        <meshBasicMaterial color={statusColor} toneMapped={false} />
      </mesh>
    </group>
  );
}

function ClusterLabel({
  cluster,
  sparse = false,
  interactive = false,
  onSelect,
  onHoverChange,
}: {
  cluster: ClusterInfo;
  sparse?: boolean;
  interactive?: boolean;
  onSelect?: () => void;
  onHoverChange?: (hovered: boolean) => void;
}) {
  const hot = cluster.critical;
  const bay = sparseProjectBaySize(cluster.radius);
  return (
    <Html
      position={[
        cluster.cx,
        cluster.cy + (sparse ? bay.height / 2 + 3.2 : cluster.radius * 1.34),
        1.2,
      ]}
      center
      zIndexRange={[24, 0]}
    >
      <button
        type="button"
        disabled={!interactive}
        onPointerDown={event => event.stopPropagation()}
        onClick={event => {
          event.stopPropagation();
          event.nativeEvent.stopImmediatePropagation();
          onSelect?.();
        }}
        onMouseEnter={() => onHoverChange?.(true)}
        onMouseLeave={() => onHoverChange?.(false)}
        onFocus={() => onHoverChange?.(true)}
        onBlur={() => onHoverChange?.(false)}
        aria-label={`Open Project ${cluster.label}`}
        className={`pointer-events-auto outline-none transition-[border-color,background-color,transform] disabled:pointer-events-none focus-visible:ring-2 focus-visible:ring-hud-cyan ${
          sparse
            ? 'w-48 rounded-sm border border-slate-700/70 bg-[#071015]/95 px-3 py-2 text-left shadow-[0_10px_30px_rgba(0,4,8,0.38)] hover:-translate-y-0.5 hover:border-slate-500/80 active:translate-y-0'
            : 'w-52 rounded-md border border-transparent bg-slate-950/80 px-3 py-2 text-center backdrop-blur-sm focus-visible:border-hud-cyan'
        }`}
      >
        <span className="flex items-baseline gap-2">
          {sparse && (
            <span className="font-mono text-[9px] tabular-nums text-slate-600">
              {String(cluster.index + 1).padStart(2, '0')}
            </span>
          )}
          <span
            className="block min-w-0 truncate text-sm font-semibold leading-tight tracking-tight"
            style={{ color: hot ? HUD.red : HUD.text }}
          >
            {cluster.label}
          </span>
        </span>
        <span
          className="mt-1 block font-mono text-[9px] uppercase tracking-[0.14em]"
          style={{ color: hot ? HUD.amber : HUD.textDim }}
        >
          {cluster.statLine ??
            `${cluster.count} agents${cluster.attention > 0 ? ` · ${cluster.attention} attention` : ''}`}
        </span>
      </button>
    </Html>
  );
}

// ---------------------------------------------------------------------------
// Hero callout — the single highest-leverage blocker, with its "why"
// ---------------------------------------------------------------------------

/** DOM chip (crisp at every zoom) anchored above the hero agent's node.
 *  Clicking it selects the agent — the panel's clear/respond flows open
 *  without hunting the map. */
function HeroCallout({
  agent,
  hero,
  onSelect,
}: {
  agent: FieldAgent;
  hero: FieldHero;
  onSelect: (id: string | null) => void;
}) {
  return (
    // anchored BELOW the node: Project labels always sit above their hulls, so
    // below is the one direction that never collides with them
    <Html
      position={[agent.x, agent.y - STATUS_SIZE[agent.status] * 3.4, 2]}
      center
      zIndexRange={[40, 0]}
    >
      <button
        onPointerDown={event => event.stopPropagation()}
        onClick={event => {
          event.stopPropagation();
          event.nativeEvent.stopImmediatePropagation();
          onSelect(hero.agentId);
        }}
        className="hud-lift pointer-events-auto flex translate-y-1/2 flex-col items-start gap-0.5 whitespace-nowrap rounded border px-2.5 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-hud-red"
        style={{
          borderColor: 'rgba(255,31,75,0.55)',
          background: 'rgba(12,6,10,0.9)',
          boxShadow: '0 0 16px rgba(255,31,75,0.25)',
        }}
        title="Fly to the hero blocker"
      >
        <span
          className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em]"
          style={{ color: HUD.red }}
        >
          ⚠ {hero.title}
        </span>
        <span
          className="max-w-72 truncate font-mono text-[10px]"
          style={{ color: HUD.textDim }}
        >
          {hero.reason}
        </span>
      </button>
    </Html>
  );
}

// ---------------------------------------------------------------------------
// Focus ring (hover = cyan, select = magenta) — finite lock-on settle
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
    spin.current = reduced ? 0.18 : 0;
  }, [agent.id, reduced]);
  useFrame((state, delta) => {
    if (!ref.current) return;
    if (reduced) {
      ref.current.scale.setScalar(1);
      ref.current.rotation.z = Math.PI / 4 + 0.18;
      return;
    }
    if (pop.current === 1 && Math.abs(spin.current - 0.18) < 0.002) return;
    const dt = Math.min(delta, 0.05);
    spin.current = THREE.MathUtils.damp(spin.current, 0.18, 10, dt);
    pop.current = THREE.MathUtils.damp(pop.current, 1, 10, dt);
    if (Math.abs(pop.current - 1) < 0.002) pop.current = 1;
    if (Math.abs(spin.current - 0.18) < 0.002) spin.current = 0.18;
    ref.current.rotation.z = Math.PI / 4 + spin.current;
    ref.current.scale.setScalar(pop.current);
    state.invalidate();
  });
  return (
    <group
      ref={ref}
      position={[agent.x, agent.y, 1.8]}
      rotation={[0, 0, Math.PI / 4]}
    >
      <mesh raycast={() => null}>
        <ringGeometry args={[baseR * 1.5, baseR * 1.85, 4]} />
        <meshBasicMaterial
          color={color}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Floor: grid (grafted from A) + far radial backdrop (grafted from B)
// ---------------------------------------------------------------------------

function VoidBackdrop({ radius, quiet }: { radius: number; quiet: boolean }) {
  const tex = useMemo(() => {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2
    );
    g.addColorStop(0, quiet ? 'rgba(22,43,48,0.12)' : 'rgba(20,70,120,0.28)');
    g.addColorStop(0.5, quiet ? 'rgba(8,18,22,0.04)' : 'rgba(10,30,60,0.10)');
    g.addColorStop(1, 'rgba(4,6,11,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [quiet]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <mesh
      position={[0, 0, -radius * 1.2]}
      raycast={() => null}
      renderOrder={-1}
    >
      <planeGeometry args={[radius * 5, radius * 5]} />
      <meshBasicMaterial
        map={tex}
        transparent
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Camera rig + imperative handle
// ---------------------------------------------------------------------------

const POLAR_TILT = Math.PI * 0.4; // war-table rake (see variant-C notes)

interface SemanticFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

function writeFrameBox(frame: SemanticFrame): THREE.Box3 {
  _box.min.set(frame.x - frame.width / 2, frame.y - frame.height / 2, -2.5);
  _box.max.set(frame.x + frame.width / 2, frame.y + frame.height / 2, 4.5);
  return _box;
}

function writeFleetBox(clusters: ClusterInfo[], sparse: boolean): THREE.Box3 {
  _box.makeEmpty();
  for (const cluster of clusters) {
    const bay = sparse ? sparseProjectBaySize(cluster.radius) : null;
    const width = bay?.width ?? cluster.radius * 2.35;
    const height =
      (bay?.height ?? cluster.radius * 2.35) +
      (sparse ? 8 : cluster.radius * 0.5);
    _v3.set(cluster.cx - width / 2, cluster.cy - height / 2, -2.5);
    _box.expandByPoint(_v3);
    _v3.set(cluster.cx + width / 2, cluster.cy + height / 2, 4.5);
    _box.expandByPoint(_v3);
  }
  if (_box.isEmpty()) {
    return writeFrameBox({ x: 0, y: 0, width: 40, height: 30 });
  }
  return _box;
}

function Rig({
  radius,
  agents,
  clusters,
  reduced,
  controllerRef,
  onNavigate,
  focusPositions,
  focusClusterFrames,
  sparseFleet,
  activeRegime,
  activeCluster,
  activeAgentId,
}: {
  radius: number;
  agents: FieldAgent[];
  clusters: ClusterInfo[];
  reduced: boolean;
  controllerRef?: { current: AgentFieldHandle | null };
  /** fired on every programmatic camera move (used to drop stale hover) */
  onNavigate?: () => void;
  /** semantic-regime camera targets keyed by Agent id */
  focusPositions?: ReadonlyMap<string, SemanticFrame>;
  focusClusterFrames?: ReadonlyMap<number, SemanticFrame>;
  sparseFleet: boolean;
  activeRegime: AgentFieldRegime;
  activeCluster: number | null;
  activeAgentId: string | null;
}) {
  const controls = useRef<CameraControls>(null);
  const invalidate = useThree(s => s.invalidate);

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    c.rotateTo(0, POLAR_TILT, false);
    c.fitToBox(writeFleetBox(clusters, sparseFleet), false, {
      paddingLeft: sparseFleet ? 9 : 4,
      paddingRight: sparseFleet ? 9 : 4,
      paddingTop: sparseFleet ? 9 : 5,
      paddingBottom: sparseFleet ? 8 : 4,
    });
    invalidate();
  }, [clusters, sparseFleet, invalidate]);

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
        const semantic = focusClusterFrames?.get(index);
        c.rotateTo(0, POLAR_TILT, t);
        c.fitToBox(
          semantic
            ? writeFrameBox(semantic)
            : writeFrameBox({
                x: cl.cx,
                y: cl.cy,
                width: cl.radius * 3.2,
                height: cl.radius * 3.5,
              }),
          t,
          {
            paddingLeft: 3,
            paddingRight: 3,
            paddingTop: 4,
            paddingBottom: 3,
          }
        );
        nav();
      },
      focusAgent(id) {
        const a = agents.find(x => x.id === id);
        const c = controls.current;
        if (!a || !c) return;
        const semantic = focusPositions?.get(id);
        if (semantic) {
          c.rotateTo(0, POLAR_TILT, t);
          c.fitToBox(writeFrameBox(semantic), t, {
            paddingLeft: 3,
            paddingRight: 3,
            paddingTop: 3,
            paddingBottom: 3,
          });
          nav();
          return;
        }
        const cl = clusters[a.cluster];
        c.rotateTo(0, POLAR_TILT, t);
        c.fitToBox(
          writeFrameBox({
            x: a.x,
            y: a.y,
            width: Math.max(24, (cl?.radius ?? 20) * 1.2),
            height: Math.max(18, (cl?.radius ?? 20) * 0.9),
          }),
          t,
          {
            paddingLeft: 3,
            paddingRight: 3,
            paddingTop: 3,
            paddingBottom: 3,
          }
        );
        nav();
      },
      overview() {
        const c = controls.current;
        if (!c) return;
        c.rotateTo(0, POLAR_TILT, t);
        c.fitToBox(writeFleetBox(clusters, sparseFleet), t, {
          paddingLeft: sparseFleet ? 9 : 4,
          paddingRight: sparseFleet ? 9 : 4,
          paddingTop: sparseFleet ? 9 : 5,
          paddingBottom: sparseFleet ? 8 : 4,
        });
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
      nudge(dx, dy, dollySteps, dAz) {
        const c = controls.current;
        if (!c) return;
        if (dx || dy) c.truck(dx * radius, dy * radius, false);
        if (dollySteps) c.dolly(dollySteps * radius * 0.5, false);
        if (dAz) c.rotate(dAz, 0, false);
        onNavigate?.();
        invalidate();
      },
    };
    return () => {
      controllerRef.current = null;
    };
  }, [
    controllerRef,
    agents,
    clusters,
    radius,
    reduced,
    invalidate,
    onNavigate,
    focusPositions,
    focusClusterFrames,
    sparseFleet,
  ]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const handle = controllerRef?.current;
      if (!handle) return;
      if (activeRegime === 'agent' && activeAgentId) {
        handle.focusAgent(activeAgentId);
      } else if (activeRegime === 'project' && activeCluster != null) {
        handle.focusCluster(activeCluster);
      } else {
        handle.overview();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [activeAgentId, activeCluster, activeRegime, controllerRef]);

  return (
    <CameraControls
      ref={controls}
      makeDefault
      smoothTime={0.34}
      draggingSmoothTime={0.1}
      minDistance={22}
      maxDistance={radius * 5}
      // war-table view band: never edge-on, never degenerate
      minPolarAngle={Math.PI * 0.34}
      maxPolarAngle={Math.PI * 0.43}
      minAzimuthAngle={-0.32}
      maxAzimuthAngle={0.32}
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
  hero = null,
  onSelect,
  onSelectCluster,
  selectableClusters,
  onHoverAgent,
  controllerRef,
  regime = 'fleet',
  preserveDrawingBuffer = false,
}: {
  agents: FieldAgent[];
  clusters: ClusterInfo[];
  selectedId: string | null;
  /** keyboard-focused sector — its hull is emphasized */
  focusedCluster?: number | null;
  /** the highest-leverage blocker — rendered as an in-world callout */
  hero?: FieldHero | null;
  onSelect: (id: string | null) => void;
  /** clicking empty sector space (the hull disc) drills — by cluster index */
  onSelectCluster?: (index: number) => void;
  /** limit which clusters are clickable (by cluster id); default: all */
  selectableClusters?: ReadonlySet<string>;
  onHoverAgent?: (agent: FieldAgent | null) => void;
  controllerRef?: { current: AgentFieldHandle | null };
  regime?: AgentFieldRegime;
  /** Eval-only pixel readback. Keep disabled in the product render path. */
  preserveDrawingBuffer?: boolean;
}) {
  const reduced = useReducedMotion();
  const lowPower = useLowPowerMode();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoverClusterId, setHoverClusterId] = useState<string | null>(null);
  const radius = useMemo(() => sceneRadius(clusters), [clusters]);

  const hoveredIdx = useMemo(
    () => (hoveredId ? agents.findIndex(agent => agent.id === hoveredId) : -1),
    [agents, hoveredId]
  );

  // programmatic camera moves invalidate what's under the (stationary) pointer;
  // drop the hover so no stale ring/tooltip floats mid-screen after a fly-to
  const clearHover = useCallback(() => setHoveredId(null), []);

  const hovered = hoveredIdx >= 0 ? agents[hoveredIdx] : null;
  const selectedIdx = useMemo(
    () => (selectedId ? agents.findIndex(a => a.id === selectedId) : -1),
    [agents, selectedId]
  );
  const selected = selectedIdx >= 0 ? agents[selectedIdx] : null;
  // the hero callout anchors to its agent's node (absent if filtered out)
  const heroAgent = useMemo(
    () => (hero ? (agents.find(a => a.id === hero.agentId) ?? null) : null),
    [agents, hero]
  );
  const focusedProject =
    focusedCluster != null ? (clusters[focusedCluster] ?? null) : null;
  const projectLayout = useMemo(
    () => (focusedProject ? layoutProjectDeck(agents, focusedProject) : null),
    [agents, focusedProject]
  );
  const semanticFocusPositions = useMemo(() => {
    const positions = new Map<string, SemanticFrame>();
    if (!projectLayout) return positions;
    for (const unit of projectLayout.units) {
      positions.set(unit.agent.id, {
        x: unit.x,
        y: unit.y,
        width: regime === 'agent' ? 58 : unit.width + 8,
        height: regime === 'agent' ? 40 : unit.height + 8,
      });
    }
    return positions;
  }, [projectLayout, regime]);
  const semanticClusterFrames = useMemo(() => {
    const frames = new Map<number, SemanticFrame>();
    if (projectLayout) {
      frames.set(projectLayout.cluster.index, {
        x: projectLayout.centerX,
        y: projectLayout.centerY + 1.5,
        width: projectLayout.width + 8,
        height: projectLayout.height + 14,
      });
    }
    return frames;
  }, [projectLayout]);
  const selectedSemanticUnit =
    selected && projectLayout
      ? (projectLayout.units.find(unit => unit.agent.id === selected.id) ??
        null)
      : null;
  const resolvedRegime: AgentFieldRegime =
    regime === 'fleet' || !projectLayout
      ? 'fleet'
      : regime === 'agent' && selectedSemanticUnit
        ? 'agent'
        : 'project';
  const sparseFleet =
    resolvedRegime === 'fleet' &&
    isSparseFleetComposition(clusters.length, agents.length);
  const quietWorld = sparseFleet || resolvedRegime !== 'fleet';

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
      dragDist.current = down
        ? Math.hypot(e.clientX - down.x, e.clientY - down.y)
        : 0;
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
      dpr={lowPower ? [1, 1.25] : [1, 2]}
      camera={{
        position: [0, -radius * 0.55, radius * 1.25],
        fov: 42,
        near: 0.1,
        far: radius * 14,
      }}
      gl={{
        antialias: true,
        preserveDrawingBuffer,
      }}
      onPointerMissed={() => {
        if (dragDist.current < 6) onSelect(null);
      }}
      onCreated={({ gl, scene, camera, raycaster }) => {
        if (process.env.NODE_ENV !== 'production') {
          const w = window as unknown as {
            __EVAL_GL__?: THREE.WebGLRenderer;
            __EVAL_SCENE__?: THREE.Scene;
            __EVAL_CAM__?: THREE.Camera;
            __EVAL_RAY__?: THREE.Raycaster;
          };
          w.__EVAL_GL__ = gl;
          w.__EVAL_SCENE__ = scene;
          w.__EVAL_CAM__ = camera;
          w.__EVAL_RAY__ = raycaster;
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
        focusPositions={semanticFocusPositions}
        focusClusterFrames={semanticClusterFrames}
        sparseFleet={sparseFleet}
        activeRegime={resolvedRegime}
        activeCluster={focusedCluster}
        activeAgentId={selectedId}
      />

      <VoidBackdrop radius={radius} quiet={quietWorld} />
      {/* floor grid (A graft): drei Grid lives in XZ, rotate into our XY plane.
          Cell/section sizes scale with the FIELD so density reads the same at
          64 and 4096 agents; colors sit just above the void so the grid stays
          ground, never competing with the data layer. */}
      <Grid
        position={[0, 0, -2]}
        rotation={[Math.PI / 2, 0, 0]}
        args={[radius * 2.6, radius * 2.6]}
        cellSize={radius / 18}
        cellThickness={quietWorld ? 0.25 : 0.4}
        cellColor={quietWorld ? '#0c1a1f' : '#0F2A34'}
        sectionSize={radius / 4.5}
        sectionThickness={quietWorld ? 0.5 : 0.85}
        sectionColor={quietWorld ? '#173039' : '#1B4E5C'}
        fadeDistance={radius * 3.1}
        fadeStrength={2.4}
        followCamera={false}
        infiniteGrid={false}
        side={THREE.DoubleSide}
        raycast={() => null}
      />

      {resolvedRegime === 'fleet' && (
        <>
          {sparseFleet && (
            <>
              <ambientLight intensity={0.42} color="#9ab0b7" />
              <directionalLight
                position={[-24, -18, 45]}
                intensity={1.1}
                color="#d7e6e9"
              />
            </>
          )}
          {clusters.map(c => {
            const emphasized =
              hovered?.cluster === c.index ||
              selected?.cluster === c.index ||
              focusedCluster === c.index ||
              hoverClusterId === c.id;
            const interactive =
              !!onSelectCluster &&
              (selectableClusters ? selectableClusters.has(c.id) : true);
            const onSelect = onSelectCluster
              ? () => onSelectCluster(c.index)
              : undefined;
            const onHoverChange = (hovered: boolean) =>
              setHoverClusterId(hovered ? c.id : null);
            return sparseFleet ? (
              <SparseProjectBay
                key={c.id}
                cluster={c}
                emphasized={emphasized}
                reduced={reduced}
                interactive={interactive}
                onSelect={onSelect}
                onHoverChange={onHoverChange}
              />
            ) : (
              <ClusterRing
                key={c.id}
                cluster={c}
                emphasized={emphasized}
                reduced={reduced}
                interactive={interactive}
                onSelect={onSelect}
                onHoverChange={onHoverChange}
              />
            );
          })}

          <Constellation
            agents={agents}
            clusters={clusters}
            hoveredIdx={hoveredIdx >= 0 ? hoveredIdx : null}
            selectedIdx={selectedIdx}
            reduced={reduced}
            surfaceZ={sparseFleet ? 1.15 : 0}
            onHover={index =>
              setHoveredId(index == null ? null : (agents[index]?.id ?? null))
            }
            onSelect={i => onSelect(agents[i].id)}
          />

          <Suspense fallback={null}>
            {clusters.map(c => (
              <ClusterLabel
                key={c.id}
                cluster={c}
                sparse={sparseFleet}
                interactive={
                  !!onSelectCluster &&
                  (selectableClusters ? selectableClusters.has(c.id) : true)
                }
                onSelect={
                  onSelectCluster ? () => onSelectCluster(c.index) : undefined
                }
                onHoverChange={h => setHoverClusterId(h ? c.id : null)}
              />
            ))}
          </Suspense>

          {hovered && (
            <FocusRing agent={hovered} color={HUD.cyan} reduced={reduced} />
          )}
          {selected && (
            <FocusRing agent={selected} color={HUD.magenta} reduced={reduced} />
          )}

          {hero && heroAgent && (
            <HeroCallout agent={heroAgent} hero={hero} onSelect={onSelect} />
          )}
        </>
      )}

      {resolvedRegime === 'project' && projectLayout && (
        <ProjectRegime
          layout={projectLayout}
          selectedId={selectedId}
          hoveredId={hoveredId}
          hero={hero}
          reduced={reduced}
          onSelect={onSelect}
          onHover={setHoveredId}
        />
      )}

      {resolvedRegime === 'agent' && selectedSemanticUnit && (
        <AgentRegime
          unit={selectedSemanticUnit}
          selectedId={selectedId}
          hoveredId={hoveredId}
          hero={hero}
          reduced={reduced}
          onSelect={onSelect}
          onHover={setHoveredId}
        />
      )}

      {!lowPower && resolvedRegime === 'fleet' && !sparseFleet && (
        <Suspense fallback={null}>
          <AgentFieldEffects />
        </Suspense>
      )}
    </Canvas>
  );
}

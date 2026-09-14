'use client';

/**
 * Delegated children as board units (V3.4 / D3c): same hex noun as their
 * parent, one size down, on animated tethers. Roster diffing and motion
 * policy come from delegation-roster.ts; this layer owns only material and
 * transforms.
 */

import { Instances, Instance } from '@react-three/drei';
import {
  useFrame,
  useThree,
} from '@react-three/fiber';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as THREE from 'three';
import {
  type SpatialBoardDelegationUnit,
} from '@exawatt/ui-model';
import {
  spatialProjectIdentityColor,
  type SpatialThemeSnapshot,
} from '../spatial-theme';
import { mixHexColors } from '@/lib/appearance/color';
import {
  DELEGATION_EXIT_SWEEP_MS,
  DELEGATION_MOTION,
  delegationArrivalEase,
  delegationBodyScale,
  delegationRoster,
  delegationSettleMs,
  delegationSpawnDelaySeconds,
  easeOutCubic,
  nextDelegationExits,
} from './delegation-roster';
import { AGENT_HEX_GEOMETRY, noopRaycast } from './operations-board-materials';

/**
 * Delegated children as board units (ENG-004 V3.4 / ENG-023 D3c). D3b drew one
 * punctuation-sized dot per child; operator dogfood found that four real
 * subagents then read as four specks above one large parent, conveying neither
 * fan-out nor that several Agents are doing the work.
 *
 * Children are the same beveled hex noun as their parent, one size down. All
 * slot geometry, the overflow boundary, and lineage endpoints come from
 * `selectSpatialDelegationUnits`; the roster diff and motion curve come from
 * `delegation-roster.ts`. This component owns only material and transforms.
 *
 * **Why the orbit is what it is.** A child must be legible as a unit without
 * out-shouting the parent that owns it. The orbit puts each child just clear
 * of the parent body, so the two read as separate solids with no outline,
 * halo, or extra colour channel — an earlier pass added a contrasting collar
 * to survive the overlap, and moving the slot out by a few percent removed the
 * need for it entirely. Project identity stays on the tether, where the D3c
 * brief puts lineage; the body stays the shared Agent noun.
 *
 * Two instanced draws for the whole board (tethers, bodies).
 * Tethers are transform-driven quads rather than lines so their endpoints can
 * animate every frame without rebuilding geometry.
 */

/** Hover lift for a delegated child, matching the parent pieces' hover feel. */
const DELEGATION_HOVER_LIFT = 1.1;

interface DelegationMotionRecord {
  progress: number;
  delay: number;
  /** Where the unit emerges from and retracts to: its parent's edge. */
  originX: number;
  originY: number;
  /** Damped hover scale multiplier. */
  lift: number;
}

/**
 * Units whose parent stopped reporting them, retained just long enough to
 * retract. State is set from effects only — never from `useFrame`, which
 * mutates transforms and nothing else. One timer per departing cohort, tracked
 * so it is cleared on completion instead of accumulating for the session.
 */
function useDelegationExits(
  units: SpatialBoardDelegationUnit[],
  reduced: boolean
): SpatialBoardDelegationUnit[] {
  const [exits, setExits] = useState<SpatialBoardDelegationUnit[]>([]);
  const previous = useRef<SpatialBoardDelegationUnit[]>([]);
  const exitsRef = useRef<SpatialBoardDelegationUnit[]>([]);
  exitsRef.current = exits;
  const timers = useRef(new Set<number>());
  useLayoutEffect(() => {
    const {
      exits: next,
      departed,
      changed,
    } = nextDelegationExits(exitsRef.current, previous.current, units, reduced);
    previous.current = units;
    if (changed) setExits(next);
    if (departed.length === 0) return;
    const goneIds = new Set(departed.map(unit => unit.id));
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      setExits(current => current.filter(unit => !goneIds.has(unit.id)));
    }, DELEGATION_EXIT_SWEEP_MS);
    timers.current.add(timer);
  }, [reduced, units]);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) window.clearTimeout(timer);
      pending.clear();
    };
  }, []);
  return exits;
}

/**
 * Ids whose spawn travel has finished. Timer-driven rather than frame-driven:
 * settling is a once-per-unit semantic event, and `useFrame` must never set
 * state. Reduced motion has no travel, so everything is settled immediately.
 */
export function useSettledDelegationUnits(
  units: SpatialBoardDelegationUnit[],
  reduced: boolean
): SpatialBoardDelegationUnit[] {
  const [settledIds, setSettledIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  // A mirror the scheduling effect reads, so `settledIds` never has to be one
  // of its dependencies. Depending on it would re-arm the effect every time a
  // unit settles; reading it from the render closure instead would schedule
  // against a stale set whenever two layouts land inside one settle window.
  const settledRef = useRef(settledIds);
  settledRef.current = settledIds;
  const pending = useRef(new Map<string, number>());
  useEffect(() => {
    const live = new Set(units.map(unit => unit.id));
    for (const [id, timer] of [...pending.current]) {
      if (!live.has(id)) {
        window.clearTimeout(timer);
        pending.current.delete(id);
      }
    }
    setSettledIds(current => {
      const next = new Set([...current].filter(id => live.has(id)));
      // Reduced motion has no travel, so nothing has to be waited out.
      if (reduced) for (const id of live) next.add(id);
      return next.size === current.size ? current : next;
    });
    if (reduced) {
      for (const timer of pending.current.values()) window.clearTimeout(timer);
      pending.current.clear();
      return;
    }
    const perParent = new Map<string, number>();
    for (const unit of units) {
      const index = perParent.get(unit.parentPieceId) ?? 0;
      perParent.set(unit.parentPieceId, index + 1);
      const id = unit.id;
      if (settledRef.current.has(id) || pending.current.has(id)) continue;
      const timer = window.setTimeout(() => {
        pending.current.delete(id);
        // Guard the resurrection case: the unit may have departed while its
        // light was still on the way.
        setSettledIds(current =>
          current.has(id) ? current : new Set([...current, id])
        );
      }, delegationSettleMs(index));
      pending.current.set(id, timer);
    }
  }, [reduced, units]);
  useEffect(() => {
    const timers = pending.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);
  return useMemo(
    () => units.filter(unit => settledIds.has(unit.id)),
    [settledIds, units]
  );
}

export function DelegationUnitLayer({
  units,
  reduced,
  hoveredId,
  theme,
}: {
  units: SpatialBoardDelegationUnit[];
  reduced: boolean;
  /** Pointer/keyboard focus from the DOM control that sits over this unit. */
  hoveredId: string | null;
  theme: SpatialThemeSnapshot;
}) {
  const invalidate = useThree(state => state.invalidate);
  const exits = useDelegationExits(units, reduced);
  const bodyRefs = useRef(new Map<string, THREE.Object3D>());
  const tetherRefs = useRef(new Map<string, THREE.Object3D>());
  const motion = useRef(new Map<string, DelegationMotionRecord>());
  const pieceGeometry = AGENT_HEX_GEOMETRY;
  const tetherGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  useEffect(() => () => tetherGeometry.dispose(), [tetherGeometry]);

  const rendered = useMemo(
    () => delegationRoster(units, exits),
    [exits, units]
  );

  // Seed lifecycle records for arrivals. A sibling that was already live keeps
  // its slot and its progress: a spawn moves the new unit, never the family.
  useLayoutEffect(() => {
    const seen = new Set<string>();
    const perParent = new Map<string, number>();
    for (const { unit, exiting } of rendered) {
      seen.add(unit.id);
      if (motion.current.has(unit.id)) continue;
      const index = perParent.get(unit.parentPieceId) ?? 0;
      perParent.set(unit.parentPieceId, index + 1);
      motion.current.set(unit.id, {
        progress: reduced || exiting ? 1 : 0,
        delay: reduced ? 0 : delegationSpawnDelaySeconds(index),
        originX: unit.tether.x1,
        originY: unit.tether.y1,
        lift: 1,
      });
    }
    for (const id of [...motion.current.keys()]) {
      if (!seen.has(id)) motion.current.delete(id);
    }
    invalidate();
  }, [invalidate, reduced, rendered]);

  useFrame((state, delta) => {
    if (rendered.length === 0) return;
    const dt = Math.min(delta, 0.05);
    let animating = false;
    for (const { unit, exiting } of rendered) {
      const record = motion.current.get(unit.id);
      const body = bodyRefs.current.get(unit.id);
      if (!record || !body) continue;
      if (reduced) record.progress = exiting ? 0 : 1;
      else if (exiting) {
        record.progress = Math.max(
          0,
          record.progress - dt / DELEGATION_MOTION.stopSeconds
        );
        if (record.progress > 0) animating = true;
      } else if (record.delay > 0) {
        record.delay = Math.max(0, record.delay - dt);
        animating = true;
      } else if (record.progress < 1) {
        record.progress = Math.min(
          1,
          record.progress + dt / DELEGATION_MOTION.spawnSeconds
        );
        animating = true;
      }
      // Arrival springs slightly past the slot and settles; an exit retracts
      // plainly, because a departure should not look playful.
      const eased = exiting
        ? easeOutCubic(record.progress)
        : delegationArrivalEase(record.progress);
      const x = THREE.MathUtils.lerp(record.originX, unit.x, eased);
      const layoutY = THREE.MathUtils.lerp(record.originY, unit.y, eased);
      const worldY = -layoutY;
      // Hover lift, damped to the same target the parent pieces use. A peer
      // that answers nothing to the pointer reads as scenery, not a unit.
      const wantLift = unit.id === hoveredId ? DELEGATION_HOVER_LIFT : 1;
      if (reduced) record.lift = wantLift;
      else {
        record.lift = THREE.MathUtils.damp(record.lift, wantLift, 9, dt);
        if (Math.abs(record.lift - wantLift) > 0.001) animating = true;
      }
      const scale = delegationBodyScale(unit.size, eased) * record.lift;
      body.position.set(x, worldY, 0.72);
      body.scale.set(scale, scale, 1);
      const tether = tetherRefs.current.get(unit.id);
      if (tether) {
        // Peer-scale children carry no size hierarchy, so the spoke is the only
        // thing that says which hub a unit belongs to. It runs from the parent
        // CENTRE to the child centre — both bodies cover their own end, and
        // what remains visible is the run between them.
        const hubWorldY = -unit.parentY;
        const dx = x - unit.parentX;
        const dy = worldY - hubWorldY;
        tether.position.set(
          (unit.parentX + x) / 2,
          (hubWorldY + worldY) / 2,
          0.55
        );
        tether.rotation.set(0, 0, Math.atan2(dy, dx));
        tether.scale.set(
          Math.hypot(dx, dy),
          Math.max(unit.size * 0.085, 0.02),
          1
        );
      }
    }
    if (animating) state.invalidate();
  });

  if (rendered.length === 0) return null;
  // Instance transforms are written imperatively from the frame loop, so the
  // InstancedMesh bounding sphere — computed once from the initial zero-scale
  // instances at the origin, and never recomputed when instance matrices
  // change — would frustum-cull these layers as soon as the camera leaves the
  // origin. Culling a single instanced draw saves nothing here anyway.
  return (
    <group>
      <Instances
        geometry={tetherGeometry}
        limit={DELEGATION_MOTION.instanceLimit}
        range={rendered.length}
        renderOrder={1}
        frustumCulled={false}
      >
        <meshBasicMaterial
          toneMapped={false}
          transparent
          opacity={0.85}
          depthWrite={false}
        />
        {rendered.map(({ unit }) => (
          <Instance
            key={`tether:${unit.id}`}
            ref={(instance: THREE.Object3D | null) => {
              if (instance) tetherRefs.current.set(unit.id, instance);
              else tetherRefs.current.delete(unit.id);
            }}
            scale={[0, 0, 1]}
            // A settled parent's spoke recedes toward the ground it sits on.
            // Lineage is still readable, but only work in flight draws the eye
            // — the instanced material is shared, so this is the per-instance
            // channel that can carry it.
            color={
              unit.parentActive
                ? spatialProjectIdentityColor(theme, unit.projectId)
                : mixHexColors(
                    spatialProjectIdentityColor(theme, unit.projectId),
                    theme.zone,
                    0.62
                  )
            }
            raycast={noopRaycast}
          />
        ))}
      </Instances>
      <Instances
        geometry={pieceGeometry}
        limit={DELEGATION_MOTION.instanceLimit}
        range={rendered.length}
        renderOrder={2}
        frustumCulled={false}
      >
        <meshLambertMaterial />
        {rendered.map(({ unit }) => (
          <Instance
            key={`unit:${unit.id}`}
            ref={(instance: THREE.Object3D | null) => {
              if (instance) bodyRefs.current.set(unit.id, instance);
              else bodyRefs.current.delete(unit.id);
            }}
            scale={[0, 0, 1]}
            color={theme.unit}
            raycast={noopRaycast}
          />
        ))}
      </Instances>
      {/* The D40 Active light, on the same primitives the parent uses. A child
          the source still reports IS working — that is what "live child" means,
          and D3b already forces `working` for them — so this states existing
          truth through the existing protocol rather than inventing a signal.
          Without it a child is a silhouette: the parent reads as a unit only
          because it carries this mark. The overflow lobe is deliberately
          excluded; its count is its content, and a light there would claim a
          single state for several Agents. */}
    </group>
  );
}

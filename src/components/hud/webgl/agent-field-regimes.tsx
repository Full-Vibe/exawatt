import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { Html, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { HUD, HUD_STATUS_COLOR, withAlpha } from '../tokens';
import type { FieldHero } from './agent-field-types';
import type {
  ProjectDeckLayout,
  ProjectUnitPlacement,
} from './agent-field-regime-layout';

interface RegimeInteraction {
  selectedId: string | null;
  hoveredId: string | null;
  hero: FieldHero | null;
  reduced: boolean;
  onSelect: (agentId: string) => void;
  onHover: (agentId: string | null) => void;
}

function SemanticLights() {
  return (
    <>
      <ambientLight intensity={0.32} color="#9bb8c9" />
      <directionalLight
        position={[-30, -24, 70]}
        intensity={1.35}
        color="#d9f4ff"
      />
      <pointLight
        position={[28, 18, 34]}
        intensity={5}
        distance={110}
        color="#2e8b9a"
      />
    </>
  );
}

function GroundShadow({ width, height }: { width: number; height: number }) {
  return (
    <mesh position={[0, -0.8, -1.15]} raycast={() => null}>
      <planeGeometry args={[width * 1.06, height * 1.12]} />
      <meshBasicMaterial
        color="#00040a"
        transparent
        opacity={0.5}
        depthWrite={false}
      />
    </mesh>
  );
}

function UnitChassis({
  unit,
  hovered,
  selected,
  hero,
  reduced,
  onSelect,
  onHover,
  scale = 1,
}: {
  unit: ProjectUnitPlacement;
  hovered: boolean;
  selected: boolean;
  hero: boolean;
  reduced: boolean;
  onSelect: () => void;
  onHover: (hovered: boolean) => void;
  scale?: number;
}) {
  const group = useRef<THREE.Group>(null);
  const material = useRef<THREE.MeshStandardMaterial>(null);
  const invalidate = useThree(state => state.invalidate);
  const entered = useRef(reduced ? 1 : 0.86);
  const interactionScale = useRef(scale);
  const statusColor = HUD_STATUS_COLOR[unit.agent.status];
  const targetZ = selected ? 3.2 : hovered ? 2.2 : hero ? 1.8 : 1.25;
  const targetScale = scale * (selected ? 1.045 : hovered ? 1.025 : 1);

  useEffect(() => {
    invalidate();
  }, [hovered, selected, hero, invalidate]);

  useFrame((state, delta) => {
    const node = group.current;
    const mat = material.current;
    if (!node || !mat) return;
    const dt = Math.min(delta, 0.05);
    if (reduced) {
      entered.current = 1;
      interactionScale.current = targetScale;
      node.position.z = targetZ;
      node.scale.setScalar(targetScale);
      mat.emissiveIntensity = selected
        ? 0.14
        : hero
          ? 0.1
          : hovered
            ? 0.075
            : 0.025;
      return;
    }

    entered.current = THREE.MathUtils.damp(entered.current, 1, 11, dt);
    node.position.z = THREE.MathUtils.damp(node.position.z, targetZ, 10, dt);
    interactionScale.current = THREE.MathUtils.damp(
      interactionScale.current,
      targetScale,
      11,
      dt
    );
    node.scale.setScalar(interactionScale.current * entered.current);
    const targetEmissive = selected
      ? 0.14
      : hero
        ? 0.1
        : hovered
          ? 0.075
          : 0.025;
    mat.emissiveIntensity = THREE.MathUtils.damp(
      mat.emissiveIntensity,
      targetEmissive,
      10,
      dt
    );
    const moving =
      Math.abs(node.position.z - targetZ) > 0.002 ||
      Math.abs(interactionScale.current - targetScale) > 0.002 ||
      Math.abs(entered.current - 1) > 0.002 ||
      Math.abs(mat.emissiveIntensity - targetEmissive) > 0.002;
    if (moving) state.invalidate();
  });

  const stopAndSelect = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (event.delta < 6) onSelect();
  };

  return (
    <group
      ref={group}
      position={[unit.x, unit.y, reduced ? targetZ : -1.5]}
      scale={scale * entered.current}
      onPointerOver={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        onHover(true);
        invalidate();
      }}
      onPointerOut={() => {
        onHover(false);
        invalidate();
      }}
      onClick={stopAndSelect}
    >
      <GroundShadow width={unit.width} height={unit.height} />
      <RoundedBox
        args={[unit.width, unit.height, 1.65]}
        radius={1.15}
        smoothness={4}
        bevelSegments={3}
      >
        <meshStandardMaterial
          ref={material}
          color={selected ? '#15242d' : '#0f1b23'}
          emissive={statusColor}
          emissiveIntensity={selected ? 0.14 : hero ? 0.1 : 0.025}
          metalness={0.55}
          roughness={0.42}
        />
      </RoundedBox>

      <RoundedBox
        position={[0.2, 0, 1.02]}
        args={[unit.width - 2.4, unit.height - 2.2, 0.38]}
        radius={0.7}
        smoothness={3}
        raycast={() => null}
      >
        <meshStandardMaterial
          color="#14222b"
          metalness={0.28}
          roughness={0.62}
        />
      </RoundedBox>

      <mesh position={[-unit.width / 2 + 1.05, 0, 1.35]} raycast={() => null}>
        <boxGeometry args={[0.72, unit.height - 2.4, 0.42]} />
        <meshBasicMaterial color={statusColor} toneMapped={false} />
      </mesh>

      <mesh
        position={[unit.width / 2 - 1.25, unit.height / 2 - 1.25, 1.35]}
        raycast={() => null}
      >
        <cylinderGeometry args={[0.45, 0.45, 0.38, 16]} />
        <meshBasicMaterial color={statusColor} toneMapped={false} />
      </mesh>
    </group>
  );
}

function UnitLabel({
  unit,
  selected,
  hero,
  onSelect,
  onHover,
}: {
  unit: ProjectUnitPlacement;
  selected: boolean;
  hero: boolean;
  onSelect: () => void;
  onHover: (hovered: boolean) => void;
}) {
  const color = HUD_STATUS_COLOR[unit.agent.status];
  return (
    <Html
      position={[unit.x, unit.y, selected ? 5.4 : 4.2]}
      center
      zIndexRange={[30, 0]}
    >
      <button
        type="button"
        onPointerDown={event => event.stopPropagation()}
        onClick={event => {
          event.stopPropagation();
          event.nativeEvent.stopImmediatePropagation();
          onSelect();
        }}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
        onFocus={() => onHover(true)}
        onBlur={() => onHover(false)}
        aria-label={`${unit.agent.name}, ${unit.agent.status}`}
        className="group pointer-events-auto w-32 rounded-md border px-2 py-2 text-left outline-none transition-[border-color,background-color,transform] duration-200 focus-visible:ring-2 focus-visible:ring-hud-cyan sm:w-[184px] sm:px-3"
        style={{
          borderColor:
            selected || hero
              ? withAlpha(color, 0.72)
              : 'rgba(130,160,178,0.28)',
          background: selected ? 'rgba(13,24,31,0.96)' : 'rgba(7,13,18,0.9)',
          boxShadow: selected ? `0 10px 28px ${withAlpha(color, 0.2)}` : 'none',
        }}
      >
        <span className="flex items-center justify-between gap-3">
          <span className="max-w-40 truncate text-sm font-semibold tracking-tight text-slate-100">
            {unit.agent.name}
          </span>
          <span
            className="shrink-0 font-mono text-[9px] uppercase tracking-[0.14em]"
            style={{ color }}
          >
            {unit.agent.status}
          </span>
        </span>
        {unit.agent.detail && (
          <span className="mt-1 block max-w-52 truncate text-[11px] text-slate-400">
            {unit.agent.detail}
          </span>
        )}
      </button>
    </Html>
  );
}

const PROJECT_DECK_EXTRUDE = {
  depth: 0.9,
  bevelEnabled: true,
  bevelSegments: 2,
  steps: 1,
  bevelSize: 0.55,
  bevelThickness: 0.38,
} as const;

function ProjectDeck({ layout }: { layout: ProjectDeckLayout }) {
  const shape = useMemo(() => {
    const cut = 3.2;
    const left = -layout.width / 2;
    const right = layout.width / 2;
    const bottom = -layout.height / 2;
    const top = layout.height / 2;
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
  }, [layout.height, layout.width]);
  return (
    <group position={[layout.centerX, layout.centerY, -0.8]}>
      <GroundShadow width={layout.width} height={layout.height} />
      <mesh raycast={() => null}>
        <extrudeGeometry args={[shape, PROJECT_DECK_EXTRUDE]} />
        <meshStandardMaterial
          color="#0c141b"
          metalness={0.48}
          roughness={0.58}
          emissive={layout.cluster.critical ? HUD.red : HUD.cyanDim}
          emissiveIntensity={layout.cluster.critical ? 0.05 : 0.015}
        />
      </mesh>
      <mesh position={[0, 0, 1.02]} raycast={() => null}>
        <boxGeometry args={[layout.width - 2.2, layout.height - 2.2, 0.18]} />
        <meshStandardMaterial
          color="#0b1117"
          metalness={0.25}
          roughness={0.72}
        />
      </mesh>
    </group>
  );
}

function ProjectHeading({ layout }: { layout: ProjectDeckLayout }) {
  return (
    <Html
      position={[layout.centerX, layout.centerY + layout.height / 2 + 4.5, 1.5]}
      center
      zIndexRange={[25, 0]}
    >
      <div className="pointer-events-none min-w-64 text-center">
        <p className="text-lg font-semibold tracking-tight text-slate-100">
          {layout.cluster.label}
        </p>
        <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">
          {layout.cluster.statLine ??
            `${layout.cluster.count} agents · ${layout.cluster.attention} attention`}
        </p>
      </div>
    </Html>
  );
}

export function ProjectRegime({
  layout,
  selectedId,
  hoveredId,
  hero,
  reduced,
  onSelect,
  onHover,
}: { layout: ProjectDeckLayout } & RegimeInteraction) {
  return (
    <group>
      <SemanticLights />
      <ProjectDeck layout={layout} />
      <ProjectHeading layout={layout} />
      {layout.units.map(unit => {
        const selected = unit.agent.id === selectedId;
        const hovered = unit.agent.id === hoveredId;
        const isHero = unit.agent.id === hero?.agentId;
        return (
          <group key={unit.agent.id}>
            <UnitChassis
              unit={unit}
              hovered={hovered}
              selected={selected}
              hero={isHero}
              reduced={reduced}
              onSelect={() => onSelect(unit.agent.id)}
              onHover={active => onHover(active ? unit.agent.id : null)}
            />
            <UnitLabel
              unit={unit}
              selected={selected}
              hero={isHero}
              onSelect={() => onSelect(unit.agent.id)}
              onHover={active => onHover(active ? unit.agent.id : null)}
            />
          </group>
        );
      })}
    </group>
  );
}

const AGENT_STATION_EXTRUDE = {
  depth: 1.35,
  bevelEnabled: true,
  bevelSegments: 2,
  steps: 1,
  bevelSize: 0.5,
  bevelThickness: 0.4,
} as const;

function AgentWorkstation({
  unit,
  hovered,
  hero,
  reduced,
  onSelect,
  onHover,
}: {
  unit: ProjectUnitPlacement;
  hovered: boolean;
  hero: boolean;
  reduced: boolean;
  onSelect: () => void;
  onHover: (hovered: boolean) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const material = useRef<THREE.MeshStandardMaterial>(null);
  const invalidate = useThree(state => state.invalidate);
  const statusColor = HUD_STATUS_COLOR[unit.agent.status];
  const shape = useMemo(() => {
    const width = 34;
    const height = 20;
    const cut = 3.4;
    const notch = 4.2;
    const next = new THREE.Shape();
    next.moveTo(-width / 2 + cut, -height / 2);
    next.lineTo(width / 2 - cut, -height / 2);
    next.lineTo(width / 2, -height / 2 + cut);
    next.lineTo(width / 2, height / 2 - cut);
    next.lineTo(width / 2 - cut, height / 2);
    next.lineTo(notch, height / 2);
    next.lineTo(0, height / 2 - 2.2);
    next.lineTo(-notch, height / 2);
    next.lineTo(-width / 2 + cut, height / 2);
    next.lineTo(-width / 2, height / 2 - cut);
    next.lineTo(-width / 2, -height / 2 + cut);
    next.closePath();
    return next;
  }, []);
  const targetZ = hovered ? 1.4 : 0.8;
  const targetScale = hovered ? 1.025 : 1;

  useEffect(() => {
    invalidate();
  }, [hovered, hero, invalidate]);

  useFrame((state, delta) => {
    const node = group.current;
    const mat = material.current;
    if (!node || !mat) return;
    const targetEmissive = hero ? 0.12 : hovered ? 0.08 : 0.025;
    if (reduced) {
      node.position.z = targetZ;
      node.scale.setScalar(targetScale);
      mat.emissiveIntensity = targetEmissive;
      return;
    }
    const dt = Math.min(delta, 0.05);
    node.position.z = THREE.MathUtils.damp(node.position.z, targetZ, 10, dt);
    const nextScale = THREE.MathUtils.damp(node.scale.x, targetScale, 10, dt);
    node.scale.setScalar(nextScale);
    mat.emissiveIntensity = THREE.MathUtils.damp(
      mat.emissiveIntensity,
      targetEmissive,
      9,
      dt
    );
    if (
      Math.abs(node.position.z - targetZ) > 0.002 ||
      Math.abs(nextScale - targetScale) > 0.002 ||
      Math.abs(mat.emissiveIntensity - targetEmissive) > 0.002
    ) {
      state.invalidate();
    }
  });

  return (
    <group
      ref={group}
      position={[unit.x, unit.y, reduced ? targetZ : -0.4]}
      onPointerOver={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        onHover(true);
        invalidate();
      }}
      onPointerOut={() => {
        onHover(false);
        invalidate();
      }}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        if (event.delta < 6) onSelect();
      }}
    >
      <GroundShadow width={34} height={20} />
      <mesh position={[0, 0, -0.8]}>
        <extrudeGeometry args={[shape, AGENT_STATION_EXTRUDE]} />
        <meshStandardMaterial
          ref={material}
          color="#0a1217"
          emissive={statusColor}
          emissiveIntensity={hero ? 0.12 : 0.025}
          metalness={0.58}
          roughness={0.46}
        />
      </mesh>

      <mesh position={[2.4, -0.4, 1.05]} raycast={() => null}>
        <boxGeometry args={[21, 11.6, 0.48]} />
        <meshStandardMaterial
          color="#132027"
          metalness={0.24}
          roughness={0.7}
        />
      </mesh>
      <mesh
        position={[2.4, -0.4, 1.52]}
        rotation={[0, 0, Math.PI / 4]}
        raycast={() => null}
      >
        <boxGeometry args={[3.2, 3.2, 0.34]} />
        <meshBasicMaterial
          color={statusColor}
          transparent
          opacity={unit.agent.status === 'idle' ? 0.42 : 0.9}
          toneMapped={false}
        />
      </mesh>
      {[-3.8, 3.8].map(offset => (
        <mesh
          key={offset}
          position={[2.4, offset - 0.4, 1.4]}
          raycast={() => null}
        >
          <boxGeometry args={[12, 0.34, 0.18]} />
          <meshBasicMaterial color="#314750" transparent opacity={0.7} />
        </mesh>
      ))}
      <mesh position={[-12.5, -0.4, 1.05]} raycast={() => null}>
        <boxGeometry args={[4.8, 12, 0.52]} />
        <meshStandardMaterial
          color="#101b20"
          metalness={0.4}
          roughness={0.58}
        />
      </mesh>
      {[-3.6, 0, 3.6].map(offset => (
        <mesh
          key={offset}
          position={[-12.5, offset - 0.4, 1.42]}
          raycast={() => null}
        >
          <boxGeometry args={[2.8, 0.7, 0.2]} />
          <meshBasicMaterial
            color={offset === 0 ? statusColor : '#38505a'}
            toneMapped={false}
          />
        </mesh>
      ))}
      <mesh position={[-8.7, -8.1, 1.25]} raycast={() => null}>
        <boxGeometry args={[12.5, 0.52, 0.3]} />
        <meshBasicMaterial color={statusColor} toneMapped={false} />
      </mesh>
      <mesh position={[13.3, 7.4, 1.42]} raycast={() => null}>
        <cylinderGeometry args={[0.55, 0.55, 0.36, 16]} />
        <meshBasicMaterial color={statusColor} toneMapped={false} />
      </mesh>
    </group>
  );
}

export function AgentRegime({
  unit,
  hoveredId,
  hero,
  reduced,
  onSelect,
  onHover,
}: { unit: ProjectUnitPlacement } & RegimeInteraction) {
  const hovered = unit.agent.id === hoveredId;
  const isHero = unit.agent.id === hero?.agentId;
  return (
    <group>
      <SemanticLights />
      <AgentWorkstation
        unit={unit}
        hovered={hovered}
        hero={isHero}
        reduced={reduced}
        onSelect={() => onSelect(unit.agent.id)}
        onHover={active => onHover(active ? unit.agent.id : null)}
      />
    </group>
  );
}

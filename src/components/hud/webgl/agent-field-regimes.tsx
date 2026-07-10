import { useEffect, useRef } from 'react';
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
    const nextScale = THREE.MathUtils.damp(node.scale.x, targetScale, 11, dt);
    node.scale.setScalar(nextScale * entered.current);
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
      Math.abs(nextScale - targetScale) > 0.002 ||
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
  prominent = false,
}: {
  unit: ProjectUnitPlacement;
  selected: boolean;
  hero: boolean;
  onSelect: () => void;
  onHover: (hovered: boolean) => void;
  prominent?: boolean;
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
        className="group pointer-events-auto min-w-40 rounded-md border px-3 py-2 text-left outline-none transition-[border-color,background-color,transform] duration-200 focus-visible:ring-2 focus-visible:ring-hud-cyan"
        style={{
          width: prominent ? 244 : 184,
          borderColor:
            selected || hero
              ? withAlpha(color, 0.72)
              : 'rgba(130,160,178,0.28)',
          background: selected ? 'rgba(13,24,31,0.96)' : 'rgba(7,13,18,0.9)',
          boxShadow: selected ? `0 10px 28px ${withAlpha(color, 0.2)}` : 'none',
        }}
      >
        <span className="flex items-center justify-between gap-3">
          <span
            className={`${prominent ? 'text-base' : 'text-sm'} max-w-40 truncate font-semibold tracking-tight text-slate-100`}
          >
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

function ProjectDeck({ layout }: { layout: ProjectDeckLayout }) {
  return (
    <group position={[layout.centerX, layout.centerY, -0.8]}>
      <GroundShadow width={layout.width} height={layout.height} />
      <RoundedBox
        args={[layout.width, layout.height, 1.1]}
        radius={2.2}
        smoothness={5}
        bevelSegments={4}
        raycast={() => null}
      >
        <meshStandardMaterial
          color="#0c141b"
          metalness={0.7}
          roughness={0.36}
          emissive={layout.cluster.critical ? HUD.red : HUD.cyanDim}
          emissiveIntensity={layout.cluster.critical ? 0.06 : 0.025}
        />
      </RoundedBox>
      <RoundedBox
        position={[0, 0, 0.68]}
        args={[layout.width - 2, layout.height - 2, 0.18]}
        radius={1.6}
        smoothness={4}
        raycast={() => null}
      >
        <meshStandardMaterial
          color="#0b1117"
          metalness={0.25}
          roughness={0.72}
        />
      </RoundedBox>
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

export function AgentRegime({
  unit,
  hoveredId,
  hero,
  reduced,
  onSelect,
  onHover,
}: { unit: ProjectUnitPlacement } & RegimeInteraction) {
  const focusUnit: ProjectUnitPlacement = {
    ...unit,
    width: 28,
    height: 14,
  };
  const hovered = unit.agent.id === hoveredId;
  const isHero = unit.agent.id === hero?.agentId;
  return (
    <group>
      <SemanticLights />
      <group position={[unit.x, unit.y, -0.9]}>
        <GroundShadow width={38} height={24} />
        <RoundedBox
          args={[38, 24, 1.2]}
          radius={3}
          smoothness={5}
          raycast={() => null}
        >
          <meshStandardMaterial
            color="#0a1218"
            metalness={0.5}
            roughness={0.48}
            emissive={HUD_STATUS_COLOR[unit.agent.status]}
            emissiveIntensity={0.02}
          />
        </RoundedBox>
      </group>
      <UnitChassis
        unit={focusUnit}
        hovered={hovered}
        selected
        hero={isHero}
        reduced={reduced}
        onSelect={() => onSelect(unit.agent.id)}
        onHover={active => onHover(active ? unit.agent.id : null)}
      />
      <UnitLabel
        unit={focusUnit}
        selected
        hero={isHero}
        prominent
        onSelect={() => onSelect(unit.agent.id)}
        onHover={active => onHover(active ? unit.agent.id : null)}
      />
    </group>
  );
}

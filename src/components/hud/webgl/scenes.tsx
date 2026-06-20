'use client';

/**
 * WebGL siblings of the DOM HUD components — one <Canvas> per component group,
 * rendered beside the DOM version in the dev gallery for an honest A/B.
 *
 * Authoring convention: orthographic camera at zoom 1 → 1 world unit = 1 CSS px,
 * origin at the canvas center, +y up. So geometry/text is sized in pixels and
 * lines up with the DOM column. Text uses the vendored Exo2 (the only ttf we
 * ship) — note WebGL needs a vendored font at all, unlike the DOM column.
 */
import { Suspense, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Line, Text } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import type { AgentStatus } from '@exawatt/core';
import {
  HUD,
  TONE_COLOR,
  HUD_STATUS_COLOR,
  STATUS_TONE,
  type HudTone,
} from '../tokens';

const FONT = '/fonts/Exo2-Medium.ttf';
type V3 = [number, number, number];

/** Scales scene content down to fit the canvas width (1 world unit = 1px at
 *  zoom 1), so a column narrower than the natural content shrinks instead of
 *  clipping. */
function FitToWidth({ width, children }: { width: number; children: ReactNode }) {
  const vw = useThree((s) => s.viewport.width);
  const scale = Math.min(1, vw / width);
  return <group scale={scale}>{children}</group>;
}

function WebglStage({
  w,
  h,
  bloom = true,
  children,
}: {
  w: number;
  h: number;
  bloom?: boolean;
  children: ReactNode;
}) {
  return (
    <div style={{ width: '100%', maxWidth: w, height: h }}>
      <Canvas
        orthographic
        dpr={[1, 2]}
        camera={{ zoom: 1, position: [0, 0, 100], near: 0.1, far: 1000 }}
        gl={{ antialias: true }}
      >
        <color attach="background" args={[HUD.bg.deep]} />
        <Suspense fallback={null}>
          <FitToWidth width={w}>{children}</FitToWidth>
        </Suspense>
        {bloom && (
          <EffectComposer>
            <Bloom
              luminanceThreshold={0.6}
              luminanceSmoothing={0.25}
              intensity={0.6}
              radius={0.5}
              mipmapBlur
            />
          </EffectComposer>
        )}
      </Canvas>
    </div>
  );
}

/** Chamfered panel outline (px-space, centered, +y up). TR + BL cut by default. */
function chamfer(w: number, h: number, c: number) {
  const x = w / 2;
  const y = h / 2;
  const outline: V3[] = [
    [-x, y, 0],
    [x - c, y, 0],
    [x, y - c, 0],
    [x, -y, 0],
    [-x + c, -y, 0],
    [-x, -y + c, 0],
    [-x, y, 0],
  ];
  const shape = new THREE.Shape();
  shape.moveTo(-x, y);
  shape.lineTo(x - c, y);
  shape.lineTo(x, y - c);
  shape.lineTo(x, -y);
  shape.lineTo(-x + c, -y);
  shape.lineTo(-x, -y + c);
  shape.closePath();
  return { outline, shape, x, y };
}

function Frame({
  w,
  h,
  tone,
  c = 12,
  bracket = false,
}: {
  w: number;
  h: number;
  tone: HudTone;
  c?: number;
  bracket?: boolean;
}) {
  const color = TONE_COLOR[tone];
  const { outline, shape, x, y } = useMemo(() => chamfer(w, h, c), [w, h, c]);
  const len = 18;
  return (
    <group>
      <mesh position={[0, 0, -1]}>
        <shapeGeometry args={[shape]} />
        <meshBasicMaterial color="#0a131a" transparent opacity={0.92} toneMapped={false} />
      </mesh>
      <Line points={outline} color={color} lineWidth={2} toneMapped={false} />
      {bracket && (
        <>
          <Line
            points={[
              [-x + len, y - 3, 1],
              [-x + 3, y - 3, 1],
              [-x + 3, y - len, 1],
            ]}
            color={color}
            lineWidth={3}
            toneMapped={false}
          />
          <Line
            points={[
              [x - len, -y + 3, 1],
              [x - 3, -y + 3, 1],
              [x - 3, -y + len, 1],
            ]}
            color={color}
            lineWidth={3}
            toneMapped={false}
          />
        </>
      )}
    </group>
  );
}

export function WebglFramesScene() {
  const W = 188;
  const H = 150;
  // three frames laid out in a row, matching the DOM trio
  const specs: Array<{ tone: HudTone; label: string; title: string; bracket?: boolean }> = [
    { tone: 'cyan', label: 'PROJECT', title: 'OpenClaw Local Parity' },
    { tone: 'amber', label: 'REVIEWING', title: 'Merge open PRs' },
    { tone: 'magenta', label: 'SELECTED', title: 'Competitor pricing', bracket: true },
  ];
  const gap = 24;
  const totalW = W * 3 + gap * 2;
  const startX = -totalW / 2 + W / 2;
  return (
    <WebglStage w={totalW} h={H + 8}>
      {specs.map((s, i) => {
        const cx = startX + i * (W + gap);
        const color = TONE_COLOR[s.tone];
        return (
          <group key={s.tone} position={[cx, 0, 0]}>
            <Frame w={W} h={H} tone={s.tone} bracket={s.bracket} />
            <Text
              font={FONT}
              position={[-W / 2 + 16, H / 2 - 22, 2]}
              fontSize={11}
              color={color}
              anchorX="left"
              anchorY="middle"
              letterSpacing={0.08}
            >
              {s.label}
            </Text>
            <Text
              font={FONT}
              position={[-W / 2 + 16, H / 2 - 48, 2]}
              fontSize={17}
              color="#EAF2FB"
              anchorX="left"
              anchorY="middle"
              maxWidth={W - 32}
            >
              {s.title}
            </Text>
          </group>
        );
      })}
    </WebglStage>
  );
}

export function WebglBracketsScene() {
  const W = 200;
  const H = 120;
  const color = TONE_COLOR.cyan;
  const len = 22;
  const x = W / 2;
  const y = H / 2;
  return (
    <WebglStage w={W + 8} h={H + 8} bloom>
      {/* faint full rect */}
      <Line
        points={[
          [-x, y, 0],
          [x, y, 0],
          [x, -y, 0],
          [-x, -y, 0],
          [-x, y, 0],
        ]}
        color={color}
        lineWidth={1}
        transparent
        opacity={0.18}
      />
      {(
        [
          [[-x + len, y], [-x, y], [-x, y - len]],
          [[x - len, y], [x, y], [x, y - len]],
          [[x - len, -y], [x, -y], [x, -y + len]],
          [[-x + len, -y], [-x, -y], [-x, -y + len]],
        ] as Array<[number, number][]>
      ).map((pts, i) => (
        <Line
          key={i}
          points={pts.map(([px, py]) => [px, py, 1] as V3)}
          color={color}
          lineWidth={3}
          toneMapped={false}
        />
      ))}
    </WebglStage>
  );
}

export function WebglLabelsScene() {
  const tones: HudTone[] = ['cyan', 'magenta', 'amber', 'red', 'green', 'idle'];
  const W = 300;
  const H = 168;
  return (
    <WebglStage w={W} h={H} bloom={false}>
      {tones.map((t, i) => {
        const color = TONE_COLOR[t];
        const yy = H / 2 - 16 - i * 26;
        return (
          <group key={t} position={[-W / 2 + 16, yy, 0]}>
            <mesh position={[0, 0, 0]}>
              <planeGeometry args={[6, 6]} />
              <meshBasicMaterial color={color} toneMapped={false} />
            </mesh>
            <Text
              font={FONT}
              position={[14, 0, 0]}
              fontSize={12}
              color={color}
              anchorX="left"
              anchorY="middle"
              letterSpacing={0.08}
            >
              {`${t} label`}
            </Text>
          </group>
        );
      })}
    </WebglStage>
  );
}

function Segments({
  value,
  tone,
  y,
  w,
  x0,
}: {
  value: number;
  tone: HudTone;
  y: number;
  w: number;
  x0: number;
}) {
  const cells = 16;
  const filled = Math.round(Math.max(0, Math.min(1, value)) * cells);
  const gap = 3;
  const cw = (w - gap * (cells - 1)) / cells;
  const color = TONE_COLOR[tone];
  return (
    <>
      {Array.from({ length: cells }).map((_, i) => (
        <mesh key={i} position={[x0 + cw / 2 + i * (cw + gap), y, 0]}>
          <planeGeometry args={[cw, 10]} />
          <meshBasicMaterial
            color={i < filled ? color : '#28323b'}
            toneMapped={false}
          />
        </mesh>
      ))}
    </>
  );
}

export function WebglStatBarsScene() {
  const W = 300;
  const rows: Array<{ v: number; tone: HudTone; label: string }> = [
    { v: 0, tone: 'cyan', label: 'Metric 0' },
    { v: 0.25, tone: 'magenta', label: 'Metric 1' },
    { v: 0.5, tone: 'amber', label: 'Metric 2' },
    { v: 1, tone: 'red', label: 'Metric 3' },
  ];
  const H = 150;
  const x0 = -W / 2 + 8;
  const barW = W - 16;
  return (
    <WebglStage w={W} h={H}>
      {rows.map((r, i) => {
        const top = H / 2 - 18 - i * 34;
        return (
          <group key={r.label}>
            <Text
              font={FONT}
              position={[x0, top, 0]}
              fontSize={11}
              color={HUD.textDim}
              anchorX="left"
              anchorY="middle"
              letterSpacing={0.06}
            >
              {r.label}
            </Text>
            <Text
              font={FONT}
              position={[-x0, top, 0]}
              fontSize={11}
              color={HUD.text}
              anchorX="right"
              anchorY="middle"
            >
              {`${Math.round(r.v * 100)}%`}
            </Text>
            <Segments value={r.v} tone={r.tone} y={top - 16} w={barW} x0={x0} />
          </group>
        );
      })}
    </WebglStage>
  );
}

function Gauge({
  value,
  tone,
  label,
  cx,
}: {
  value: number;
  tone: HudTone;
  label: string;
  cx: number;
}) {
  const color = TONE_COLOR[tone];
  const r = 42;
  const sweep = Math.PI * 2 * 0.75; // 270deg
  const start = Math.PI / 2 + (Math.PI * 2 - sweep) / 2;
  const track = useMemo<V3[]>(() => {
    const c = new THREE.EllipseCurve(0, 0, r, r, start, start + sweep, false);
    return c.getPoints(64).map((p) => [p.x, p.y, 0]);
  }, [start, sweep, r]);
  const arc = useMemo<V3[]>(() => {
    const c = new THREE.EllipseCurve(0, 0, r, r, start, start + sweep * value, false);
    return c.getPoints(64).map((p) => [p.x, p.y, 1]);
  }, [start, sweep, value, r]);
  return (
    <group position={[cx, 6, 0]}>
      <Line points={track} color={color} lineWidth={2} transparent opacity={0.18} />
      <Line points={arc} color={color} lineWidth={3} toneMapped={false} />
      <Text font={FONT} position={[0, 2, 2]} fontSize={18} color={HUD.text} anchorX="center" anchorY="middle">
        {`${Math.round(value * 100)}%`}
      </Text>
      <Text
        font={FONT}
        position={[0, -r - 18, 2]}
        fontSize={9}
        color={HUD.textDim}
        anchorX="center"
        anchorY="middle"
        letterSpacing={0.16}
      >
        {label.toUpperCase()}
      </Text>
    </group>
  );
}

export function WebglGaugesScene() {
  const specs: Array<{ v: number; tone: HudTone; label: string }> = [
    { v: 0.72, tone: 'cyan', label: 'Goal' },
    { v: 0.4, tone: 'amber', label: 'Burn' },
    { v: 0.18, tone: 'red', label: 'Blocked' },
  ];
  const step = 120;
  const startX = -((specs.length - 1) * step) / 2;
  return (
    <WebglStage w={step * specs.length} h={140}>
      {specs.map((s, i) => (
        <Gauge key={s.label} value={s.v} tone={s.tone} label={s.label} cx={startX + i * step} />
      ))}
    </WebglStage>
  );
}

function Pill({ status, cx }: { status: AgentStatus; cx: number }) {
  const color = HUD_STATUS_COLOR[status];
  const w = 92;
  const h = 22;
  return (
    <group position={[cx, 0, 0]}>
      <mesh>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial color={color} transparent opacity={0.14} toneMapped={false} />
      </mesh>
      <Line
        points={[
          [-w / 2, h / 2, 1],
          [w / 2, h / 2, 1],
          [w / 2, -h / 2, 1],
          [-w / 2, -h / 2, 1],
          [-w / 2, h / 2, 1],
        ]}
        color={color}
        lineWidth={1.5}
        toneMapped={false}
      />
      <mesh position={[-w / 2 + 14, 0, 1]}>
        <circleGeometry args={[3.5, 16]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <Text
        font={FONT}
        position={[-w / 2 + 24, 0, 1]}
        fontSize={10}
        color={color}
        anchorX="left"
        anchorY="middle"
        letterSpacing={0.06}
      >
        {status.toUpperCase()}
      </Text>
    </group>
  );
}

export function WebglPillsScene() {
  const statuses: AgentStatus[] = [
    'working',
    'reviewing',
    'blocked',
    'error',
    'complete',
    'idle',
  ];
  const w = 100;
  const cols = 3;
  const rows = 2;
  const hStep = 34;
  const xStart = -((cols - 1) * w) / 2;
  const yStart = ((rows - 1) * hStep) / 2;
  return (
    <WebglStage w={w * cols + 16} h={hStep * rows + 24}>
      {statuses.map((s, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        return (
          <group key={s} position={[0, yStart - row * hStep, 0]}>
            <Pill status={s} cx={xStart + col * w} />
          </group>
        );
      })}
    </WebglStage>
  );
}

export function WebglComposedScene({
  name,
  blocker,
  status,
  costRate,
  cost,
  turns,
  fleetSpend,
}: {
  name: string;
  blocker: string;
  status: AgentStatus;
  costRate: number;
  cost: number;
  turns: number;
  fleetSpend: number;
}) {
  const W = 332;
  const H = 200;
  const tone = STATUS_TONE[status];
  const color = TONE_COLOR[tone];
  const x0 = -W / 2 + 18;
  return (
    <WebglStage w={W + 8} h={H + 8}>
      <Frame w={W} h={H} tone={tone} bracket />
      <Text font={FONT} position={[x0, H / 2 - 26, 2]} fontSize={16} color="#EAF2FB" anchorX="left" anchorY="middle" maxWidth={W - 90}>
        {name}
      </Text>
      <Text font={FONT} position={[W / 2 - 18, H / 2 - 24, 2]} fontSize={10} color={color} anchorX="right" anchorY="middle" letterSpacing={0.1}>
        {status.toUpperCase()}
      </Text>
      <Text font={FONT} position={[x0, H / 2 - 56, 2]} fontSize={12} color={HUD.textDim} anchorX="left" anchorY="middle" maxWidth={W - 36}>
        {blocker}
      </Text>
      <Text font={FONT} position={[x0, H / 2 - 84, 2]} fontSize={9} color={HUD.textDim} anchorX="left" anchorY="middle" letterSpacing={0.12}>
        COST RATE
      </Text>
      <Segments value={costRate / 2} tone="amber" y={H / 2 - 100} w={W - 36} x0={x0} />
      {(
        [
          ['COST', `$${cost.toFixed(2)}`],
          ['TURNS', String(turns)],
          ['FLEET SPEND', `$${fleetSpend.toFixed(2)}`],
        ] as const
      ).map(([label, value], i) => {
        const cx = x0 + 4 + i * ((W - 44) / 3) + (W - 44) / 6;
        return (
          <group key={label} position={[cx, -H / 2 + 34, 2]}>
            <Text font={FONT} position={[0, 11, 0]} fontSize={9} color={HUD.textDim} anchorX="center" anchorY="middle" letterSpacing={0.08}>
              {label}
            </Text>
            <Text font={FONT} position={[0, -6, 0]} fontSize={14} color="#CFE3F2" anchorX="center" anchorY="middle">
              {value}
            </Text>
          </group>
        );
      })}
    </WebglStage>
  );
}

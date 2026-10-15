'use client';
/** The homepage owns story, globe and Project labels; shared tiles own pixels. */
import { useMemo, useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { TileRenderer } from '@/components/tiles/tile-renderer';
import type { TileFrame, TileInstance } from '@/components/tiles/tile-contract';
import {
  fleetAt,
  axialToPlane,
  sourceAdapterId,
  type FleetModel,
} from '../fleet-model';
import { isNarrow } from '../narrow';
import { planeToSphere, SPHERE_RADIUS } from '../sphere';
import { facingFade, nameShown, nameStyleOf } from '../names';
import { stageBlend, STAGES } from '../stages';
import { BORDER_SAMPLES, writeBorder } from '@/components/tiles/territory';
import type { LabelAnchor, VisualProps } from '../visual-contract';
import { STORY_TILE_MARKS } from './crust-marks';
import { GlobeBody } from './globe-body';
import {
  BORDER_LIFT,
  centerTiles,
  highlightWeight,
  paletteFrom,
  placeTiles,
  writeLabelAnchors,
  type TilePlacement,
} from './shared';

const BORDER_ALPHA = 0.36;
const BORDER_WIDTH = 0.0011;
const BORDER_RATE = 8;

/** One ribbon per Project around its land, on the globe's skin. */
function makeBorderGeometry(projects: number): THREE.BufferGeometry {
  const vertices = projects * BORDER_SAMPLES * 2;
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(
      THREE.DynamicDrawUsage
    )
  );
  g.setAttribute(
    'color',
    new THREE.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(
      THREE.DynamicDrawUsage
    )
  );
  const index: number[] = [];
  for (let p = 0; p < projects; p += 1) {
    const base = p * BORDER_SAMPLES * 2;
    for (let i = 0; i < BORDER_SAMPLES; i += 1) {
      const a = base + i * 2;
      const c = base + ((i + 1) % BORDER_SAMPLES) * 2;
      index.push(a, a + 1, c, a + 1, c + 1, c);
    }
  }
  g.setIndex(index);
  return g;
}

const borderPlane = new Float32Array(BORDER_SAMPLES * 2);
const borderNormals = new Float32Array(BORDER_SAMPLES * 2);
const borderPoint = new THREE.Vector3();

/** Ease each Project's border toward the land it holds now. */
function easeBorders(
  model: FleetModel,
  count: number,
  rings: Float32Array,
  fades: Float32Array,
  delta: number,
  reducedMotion: boolean,
  /** How much the borders show: while they cannot be seen they take their
   *  new size at once, so a border never morphs on screen (W15j). */
  shown: number
) {
  for (const project of model.projects) {
    const present = project.first < count;
    const p = project.id;
    if (present) {
      const last = Math.min(count, project.first + project.count) - 1;
      const target = model.agents[last].ring + 1;
      rings[p] =
        reducedMotion || fades[p] < 0.01 || shown < 0.02
          ? target
          : THREE.MathUtils.damp(rings[p], target, BORDER_RATE, delta);
    }
    fades[p] = reducedMotion
      ? present
        ? 1
        : 0
      : THREE.MathUtils.damp(fades[p], present ? 1 : 0, BORDER_RATE, delta);
  }
}

/** Write every Project's border ribbon for this frame; nothing is written
 *  or uploaded while every border is out and was already out. */
function drawBorders(
  geometry: THREE.BufferGeometry,
  model: FleetModel,
  placements: TilePlacement[],
  centres: number[],
  rings: Float32Array,
  fades: Float32Array,
  shown: number,
  labels: LabelAnchor[],
  camera: THREE.Camera,
  ink: THREE.Color,
  drawn: { any: boolean }
) {
  const visible = shown > 0 && fades.some(fade => fade > 0);
  if (!visible && !drawn.any) return;
  drawn.any = visible;
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const colors = geometry.getAttribute('color') as THREE.BufferAttribute;
  const pos = position.array as Float32Array;
  const col = colors.array as Float32Array;
  for (const project of model.projects) {
    const p = project.id;
    const base = p * BORDER_SAMPLES * 2;
    const alpha =
      BORDER_ALPHA * fades[p] * shown * facingFade(labels[p]?.facing ?? 0);
    const r = ink.r * alpha;
    const g = ink.g * alpha;
    const b = ink.b * alpha;
    for (let v = base; v < base + BORDER_SAMPLES * 2; v += 1) {
      col[v * 3] = r;
      col[v * 3 + 1] = g;
      col[v * 3 + 2] = b;
    }
    if (alpha <= 0) continue;
    const place = placements[centres[p]];
    // about two pixels wide at any distance
    const half = Math.min(
      0.5,
      Math.max(0.012, camera.position.distanceTo(place.position) * BORDER_WIDTH)
    );
    writeBorder(place.x, place.y, rings[p], borderPlane, borderNormals);
    for (let i = 0; i < BORDER_SAMPLES; i += 1) {
      const x = borderPlane[i * 2];
      const y = borderPlane[i * 2 + 1];
      const nx = borderNormals[i * 2] * half;
      const ny = borderNormals[i * 2 + 1] * half;
      const v = (base + i * 2) * 3;
      planeToSphere(x - nx, y - ny, borderPoint, SPHERE_RADIUS, BORDER_LIFT);
      pos[v] = borderPoint.x;
      pos[v + 1] = borderPoint.y;
      pos[v + 2] = borderPoint.z;
      planeToSphere(x + nx, y + ny, borderPoint, SPHERE_RADIUS, BORDER_LIFT);
      pos[v + 3] = borderPoint.x;
      pos[v + 4] = borderPoint.y;
      pos[v + 5] = borderPoint.z;
    }
  }
  position.needsUpdate = true;
  colors.needsUpdate = true;
}

export function CrustVisual(props: VisualProps) {
  const { model, drive, shownRef, theme, anchor, names = 'float' } = props;
  const { size } = useThree();
  const palette = useMemo(() => paletteFrom(theme), [theme]);
  const tiles = useMemo<TileInstance[]>(
    () =>
      model.tiles.map((tile, index) => {
        const agent = tile.agent >= 0 ? model.agents[tile.agent] : null;
        const [x, y] = axialToPlane(tile.axial);
        return {
          id: String(index),
          x,
          y,
          ring: tile.ring,
          agentId: agent ? String(agent.id) : undefined,
          status: agent?.status,
          mark: agent ? sourceAdapterId(agent.source) : undefined,
          phase: agent?.id,
        };
      }),
    [model]
  );
  const frame = useMemo(
    () => makeStoryFrame({ model, drive, shownRef, names }, size),
    [model, drive, shownRef, names, size]
  );
  return (
    <>
      <color attach="background" args={[theme.canvas]} />
      <fog attach="fog" args={[theme.canvas, 60, 160]} />
      <GlobeBody palette={palette} graticule={0.1} />
      <TileRenderer
        {...props}
        tiles={tiles}
        surface="sphere"
        marks={STORY_TILE_MARKS}
        readFrame={frame}
        onHoverChange={id =>
          props.onHoverChange?.(id === null ? -1 : Number(id))
        }
        onSelect={id => props.onSelect?.(id === null ? -1 : Number(id))}
        onFocusPoint={(id, x, y) =>
          id === null ? anchor.clearFocus() : anchor.setFocus(Number(id), x, y)
        }
      />
      <StoryTerritories {...props} />
    </>
  );
}

function StoryTerritories({
  model,
  theme,
  drive,
  shownRef,
  anchor,
  reducedMotion,
  names = 'float',
  closeUp = false,
}: VisualProps) {
  const { size } = useThree();
  const palette = useMemo(() => paletteFrom(theme), [theme]);
  const placements = useMemo(() => placeTiles(model), [model]);
  const bordersRef = useRef<THREE.Mesh>(null);
  const borderGeometry = useMemo(
    () => makeBorderGeometry(model.projects.length),
    [model]
  );
  const borderState = useMemo(() => {
    const rings = new Float32Array(model.projects.length);
    return {
      rings,
      fades: new Float32Array(model.projects.length),
      drawn: { any: true },
      rim: { rings },
    };
  }, [model]);
  useEffect(() => () => borderGeometry.dispose(), [borderGeometry]);
  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const d = drive.current;
    const at = fleetAt(model, Math.round(shownRef.current));
    const b = stageBlend(d.rail);
    const still = 1 - 4 * b.t * (1 - b.t);
    const borderShown =
      nameShown(names, 'border', d.rail, isNarrow(size.width, size.height)) *
      still *
      still;
    easeBorders(
      model,
      closeUp ? at.count : STAGES[b.t < 0.5 ? b.from : b.to].count,
      borderState.rings,
      borderState.fades,
      delta,
      reducedMotion,
      borderShown
    );
    writeLabelAnchors(
      model,
      at,
      placements,
      state.camera,
      size.width,
      size.height,
      anchor,
      0.42 + 1.4,
      names === 'float' ? null : borderState.rim
    );
    const borders = bordersRef.current;
    if (borders)
      drawBorders(
        borders.geometry,
        model,
        placements,
        centerTiles(model),
        borderState.rings,
        borderState.fades,
        borderShown,
        anchor.labels,
        state.camera,
        palette.label,
        borderState.drawn
      );
  });
  return names === 'border' || names === 'auto' ? (
    <mesh
      ref={bordersRef}
      geometry={borderGeometry}
      raycast={() => null}
      frustumCulled={false}
    >
      <meshBasicMaterial
        vertexColors
        toneMapped={false}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        side={THREE.DoubleSide}
      />
    </mesh>
  ) : null;
}

/** A mutable render-time bridge, created once by the homepage adapter. */
function makeStoryFrame(
  {
    model,
    drive,
    shownRef,
    names = 'float',
  }: Pick<VisualProps, 'model' | 'drive' | 'shownRef' | 'names'>,
  size: { width: number; height: number }
) {
  const current = { at: fleetAt(model, 0) };
  const selection = new Set<string>();
  const weights = { active: 1, 'needs-you': 1, result: 1, off: 1, fault: 1 };
  const value: TileFrame = {
    focusId: null,
    selection,
    highlightWeights: weights,
    tilePresent: id => current.at.tilePresent(model.tiles[Number(id)]),
    tileGhost: id => current.at.tileGhost(model.tiles[Number(id)]),
    tileAgent: id => current.at.tileAgent(model.tiles[Number(id)]),
  };
  const blend = { from: 0, to: 0, t: 0 };
  return () => {
    current.at = fleetAt(model, Math.round(shownRef.current));
    const d = drive.current;
    const b = stageBlend(d.rail, undefined, blend);
    const h0 = d.highlights[b.from] ?? null;
    const h1 = d.highlights[b.to] ?? null;
    for (const key of Object.keys(weights) as (keyof typeof weights)[])
      weights[key] = THREE.MathUtils.lerp(
        highlightWeight(key, h0),
        highlightWeight(key, h1),
        b.t
      );
    value.highlightStrength = THREE.MathUtils.lerp(h0 ? 1 : 0, h1 ? 1 : 0, b.t);
    value.focusId = d.selected >= 0 ? String(d.selected) : null;
    value.exemplarId = d.exemplar >= 0 ? String(d.exemplar) : null;
    selection.clear();
    if (value.focusId !== null) selection.add(value.focusId);
    value.outlined =
      nameStyleOf(
        names,
        STAGES[b.t < 0.5 ? b.from : b.to],
        isNarrow(size.width, size.height)
      ) === 'border';
    return value;
  };
}

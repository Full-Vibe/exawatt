'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { memo, useCallback, useEffect, useMemo } from 'react';
import type {
  SpatialBoardDelegationUnit,
  SpatialBoardLayout,
  SpatialBoardLens,
} from '@exawatt/ui-model';
import { TileRenderer } from '@/components/tiles/tile-renderer';
import type { TileFrame } from '@/components/tiles/tile-contract';
import type { CrustMaterialId } from '@/components/tiles/crust-materials';
import { DEFAULT_MOTION } from '@/components/tiles/crust-motion';
import { harnessMarkTone } from '@/components/workspace/harness-mark-tones';
import { HARNESS_MARK_PATHS } from '@/components/workspace/harness-icons';
import type { SpatialThemeSnapshot } from '../../spatial-theme';
import type { AmbientMotion } from '../operations-board-ambient';
import { useBoardFocusRecession } from '../operations-board-field';
import {
  useBoardHoverSlice,
  type BoardHoverStore,
} from '../operations-board-hover';
import { StatusMarkLayer } from '../operations-board-status-marks';
import { statusMarkSubjects } from '../status-mark-subjects';
import { delegationStatusPieces } from '../delegation-roster';
import {
  DelegationUnitLayer,
  useSettledDelegationUnits,
} from '../operations-board-delegation-layer';
import {
  AgentCandidateReticle,
  SelectionRing,
  StoppedAgentOutlines,
  MultiSelectionLayer,
} from '../operations-board-agent-layer';
import { PopulationStatusMarks } from '../operations-board-population-layer';
import { computePopulationDotField } from '../population-dots';
import { boardTileModel } from './board-tiles-model';
import { boardTileStatusSubjects } from './board-tile-status';
import { useTileEmergence } from './use-tile-emergence';

const PRODUCT_MARKS = { paths: HARNESS_MARK_PATHS, tone: harnessMarkTone };
const EMPTY_SELECTION: ReadonlySet<string> = new Set();
const NO_MOTION = {
  sheen: false,
  breathe: false,
  wander: false,
  pulse: false,
  spin: false,
  lift: 'still',
} as const;

/** Presentation only: all addresses, lifecycle policy, status truth, selection
 * and child lineage are supplied by the same owners as v1. */
export const BoardTilesLayer = memo(function BoardTilesLayer({
  layout,
  theme,
  ambient,
  reduced,
  lowPower,
  material,
  greybox,
  sourceMarks,
  hover,
  multiSelection,
  delegationUnits,
  selectedDelegationUnitId,
  lens,
}: {
  layout: SpatialBoardLayout;
  theme: SpatialThemeSnapshot;
  ambient: AmbientMotion;
  reduced: boolean;
  lowPower: boolean;
  material: CrustMaterialId;
  greybox: boolean;
  sourceMarks?: Readonly<Record<string, string>>;
  hover: BoardHoverStore;
  multiSelection?: ReadonlySet<string>;
  delegationUnits: SpatialBoardDelegationUnit[];
  selectedDelegationUnitId: string | null;
  lens: SpatialBoardLens;
}) {
  const invalidate = useThree(state => state.invalidate);
  const hoveredId = useBoardHoverSlice(hover, state => state.agentId);
  const pressedId = useBoardHoverSlice(hover, state => state.pressedAgentId);
  const { visible, rendered, getTracker } = useTileEmergence(
    layout.pieces,
    reduced
  );
  const model = useMemo(
    () => boardTileModel(layout, sourceMarks, rendered),
    [layout, sourceMarks, rendered]
  );
  const tiles = useMemo(
    () => [
      ...model.ground,
      ...model.ghosts,
      ...model.agents,
      ...model.population,
    ],
    [model]
  );
  const populationField = useMemo(
    () => computePopulationDotField(layout.zones, layout.pieces),
    [layout.zones, layout.pieces]
  );
  const ghostIds = useMemo(
    () => new Set(model.ghosts.map(tile => tile.id)),
    [model]
  );
  const groundIds = useMemo(
    () => new Set(model.ground.map(tile => tile.id)),
    [model]
  );
  const piecesById = useMemo(
    () => new Map(rendered.map(piece => [piece.id, piece])),
    [rendered]
  );
  const zoneIds = useMemo(
    () => layout.zones.map(zone => zone.id),
    [layout.zones]
  );
  const recession = useBoardFocusRecession(
    zoneIds,
    layout.altitude,
    layout.focusedProjectId,
    reduced
  );
  const frame = useMemo<TileFrame>(
    () => ({
      focusId: layout.selectedAgentId,
      selection: multiSelection ?? EMPTY_SELECTION,
      hoveredId,
      pressedId,
      tileGhost: id => ghostIds.has(id),
      tilePresent: id => !ghostIds.has(id),
      tileAgent: id => !ghostIds.has(id) && !groundIds.has(id),
      tileScale: id =>
        getTracker().scaleOf(
          groundIds.has(id) ? id.slice('ground:'.length) : id,
          performance.now()
        ),
      tileEmphasis: id => {
        const piece = piecesById.get(
          groundIds.has(id) ? id.slice('ground:'.length) : id
        );
        return piece
          ? 1 - 0.7 * recession(piece.projectId, performance.now())
          : 1;
      },
    }),
    [
      ghostIds,
      groundIds,
      layout.selectedAgentId,
      multiSelection,
      hoveredId,
      pressedId,
      getTracker,
      piecesById,
      recession,
    ]
  );
  const readFrame = useCallback(() => frame, [frame]);
  const onMotionFrame = useCallback(
    (settling: boolean, working: boolean) => {
      if (ambient.cadence === 'parked') return;
      // Status churn is ambient too: a stream of state/color handovers must
      // not bypass the host economy cadence forever. Input wakes immediately;
      // camera and emergence transitions retain their own refresh-rate clock.
      if (settling || working) ambient.requestFrame(invalidate);
    },
    [ambient, invalidate]
  );
  useEffect(() => invalidate(), [invalidate, frame, ambient]);
  useFrame(state => {
    if (getTracker().active(performance.now())) state.invalidate();
  });
  const settled = useSettledDelegationUnits(delegationUnits, reduced);
  const parentStatus = useMemo(
    () => statusMarkSubjects(rendered, visible),
    [rendered, visible]
  );
  const childStatus = useMemo(
    () =>
      delegationStatusPieces(settled).map(piece =>
        piece.id === selectedDelegationUnitId
          ? { ...piece, selected: true }
          : piece
      ),
    [settled, selectedDelegationUnitId]
  );
  const statusSubjects = useMemo(
    () => [...boardTileStatusSubjects(parentStatus), ...childStatus],
    [parentStatus, childStatus]
  );
  const stoppedIds = useMemo(
    () =>
      new Set(
        visible
          .filter(piece => piece.sessionState === 'stopped')
          .map(piece => piece.id)
      ),
    [visible]
  );
  const emergenceScale = useCallback(
    (id: string, now: number) =>
      stoppedIds.has(id) ? 1 : getTracker().scaleOf(id, now),
    [stoppedIds, getTracker]
  );
  const selected =
    parentStatus.find(piece => piece.selected) ??
    childStatus.find(piece => piece.selected);
  const candidate = visible.find(
    piece => piece.agentId === (pressedId ?? hoveredId)
  );
  return (
    <>
      <group rotation={[Math.PI / 2, 0, 0]}>
        <TileRenderer
          tiles={tiles}
          surface="plane"
          theme={theme}
          material={greybox ? 'matte' : material}
          shape={greybox ? 'hex' : 'rounded'}
          detail="adaptive"
          mark={greybox ? 'off' : 'relief'}
          motion={greybox ? NO_MOTION : DEFAULT_MOTION}
          signal="paint"
          readFrame={readFrame}
          marks={PRODUCT_MARKS}
          reducedMotion={reduced || ambient.cadence === 'parked'}
          calmAttention
          interactive={false}
          requestFrame={invalidate}
          onMotionFrame={onMotionFrame}
          transmission={
            layout.altitude !== 'fleet' &&
            !lowPower &&
            !theme.reducedTransparency
          }
        />
      </group>
      {!greybox && (
        <StatusMarkLayer
          pieces={statusSubjects}
          ambient={ambient}
          lens={lens}
          theme={theme}
          emergenceScale={emergenceScale}
        />
      )}
      {!greybox && (
        <PopulationStatusMarks
          field={populationField}
          lens={lens}
          ambient={false}
          theme={theme}
          backing
        />
      )}
      <DelegationUnitLayer
        units={delegationUnits}
        reduced={reduced}
        hover={hover}
        theme={theme}
      />
      <StoppedAgentOutlines pieces={visible} lens={lens} theme={theme} />
      {selected && (
        <SelectionRing
          key={selected.id}
          piece={selected}
          ambient={ambient}
          reduced={reduced}
          theme={theme}
        />
      )}
      {candidate && (
        <AgentCandidateReticle
          key={`candidate:${candidate.id}`}
          piece={candidate}
          pressed={pressedId === candidate.agentId}
          reduced={reduced}
          theme={theme}
        />
      )}
      {multiSelection && multiSelection.size > 0 && (
        <MultiSelectionLayer
          layout={layout}
          selection={multiSelection}
          theme={theme}
        />
      )}
    </>
  );
});

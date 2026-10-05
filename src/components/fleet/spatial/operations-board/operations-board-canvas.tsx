'use client';

import { Canvas, useThree } from '@react-three/fiber';
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as THREE from 'three';
import {
  selectSpatialDelegationUnits,
  type SpatialBoardLayout,
  type SpatialBoardLens,
  type SpatialBoardProjection,
  type SpatialBoardRect,
} from '@exawatt/ui-model';
import { createZoneLabelTierStore } from './operations-board-label-tier';
import { BoardField, BoardTransitionProvider } from './operations-board-field';
import {
  ALTITUDE_HANDOFF_CROSSFADE_MS,
  ALTITUDE_HANDOFF_HOLD_MS,
  altitudeHandoffActive,
} from '@/components/nav/altitude-handoff';
import { type SpatialThemeSnapshot } from '../spatial-theme';
import {
  type BoardClampEdges,
  type OperationsBoardViewport,
} from './operations-board-camera';

export type { OperationsBoardViewport } from './operations-board-camera';
import { useLowPowerMode, useReducedMotion } from './operations-board-env';
import {
  createAmbientFrameScheduler,
  resolveAmbientCadence,
  type AmbientCadence,
  type AmbientMotion,
} from './operations-board-ambient';
import { useHostRenderPolicy } from '@/lib/host-power/use-host-render-policy';
import { BoardCameraRig } from './operations-board-camera-rig';
import { BoardGrid, ZoneLayer } from './operations-board-zone-layer';
import {
  AgentPieceLayer,
  MultiSelectionLayer,
} from './operations-board-agent-layer';
import { PopulationDotLayer } from './operations-board-population-layer';
import { createBoardHoverStore } from './operations-board-hover';
import {
  AgentControls,
  DelegationControls,
  ProjectControls,
} from './operations-board-controls';

import type { OperationsBoardHandle } from './operations-board-camera-rig';

export type { OperationsBoardHandle } from './operations-board-camera-rig';

const OperationsBoardEffects = lazy(() => import('./operations-board-effects'));

/** Demand-loop bridge: material/DOM props update in place, then the existing
 * scene gets exactly one requested paint for the new resolved snapshot. */
function InvalidateOnSpatialTheme({ theme }: { theme: SpatialThemeSnapshot }) {
  const invalidate = useThree(state => state.invalidate);
  useEffect(() => invalidate(), [invalidate, theme]);
  return null;
}

/** A cadence change requests one frame; from there the rotors keep the loop
 * alive themselves. Without this, leaving `parked` (plugging in, unlocking,
 * returning to the tab) would wait for an unrelated paint. */
function ResumeAmbientMotion({ ambient }: { ambient: AmbientMotion }) {
  const invalidate = useThree(state => state.invalidate);
  useEffect(() => {
    if (ambient.cadence !== 'parked') invalidate();
  }, [ambient, invalidate]);
  return null;
}

/** Display changes can alter DPR without changing the canvas's CSS size.
 * R3F's resize observer then has nothing to report. Re-resolve its bounded
 * DPR through the store, retaining the camera, scene and demand loop. */
function BoardDisplayResolution({ lowPower }: { lowPower: boolean }) {
  const setDpr = useThree(state => state.setDpr);
  useEffect(() => {
    let query: MediaQueryList;
    const update = () => {
      query?.removeEventListener('change', update);
      setDpr([1, lowPower ? 1.25 : 2]);
      // Watch the new display's resolution after every change, in both
      // directions; keeping the first query misses subsequent displays.
      query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      query.addEventListener('change', update);
    };
    update();
    window.addEventListener('resize', update);
    return () => {
      query.removeEventListener('change', update);
      window.removeEventListener('resize', update);
    };
  }, [lowPower, setDpr]);
  return null;
}

export function OperationsBoardCanvas({
  layout,
  projection,
  lens = 'status',
  controllerRef,
  onViewportChange,
  onDrillProject,
  onSelectAgent,
  onBackground,
  multiSelection,
  onToggleAgentSelect,
  onToggleZoneSelect,
  onBandSelect,
  bandOverlayRef,
  followSelection = true,
  touchSelectionMode = false,
  onManualCameraInput,
  onClampEdges,
  onSelectDelegationChild,
  selectedDelegationUnitId = null,
  preserveDrawingBuffer = false,
  theme,
}: {
  layout: SpatialBoardLayout;
  projection: SpatialBoardProjection;
  lens?: SpatialBoardLens;
  controllerRef: { current: OperationsBoardHandle | null };
  onViewportChange?: (viewport: OperationsBoardViewport) => void;
  onDrillProject: (projectId: string) => void;
  onSelectAgent: (agentId: string) => void;
  onBackground: () => void;
  /** Multi-selection (V3.2): ephemeral Agent ids; rendering + toggles only —
   *  the single URL-addressed selection stays `layout.selectedAgentId`. */
  multiSelection?: ReadonlySet<string>;
  onToggleAgentSelect?: (agentId: string) => void;
  onToggleZoneSelect?: (zoneId: string) => void;
  onBandSelect?: (band: SpatialBoardRect) => void;
  bandOverlayRef?: { current: HTMLDivElement | null };
  followSelection?: boolean;
  touchSelectionMode?: boolean;
  onManualCameraInput?: () => void;
  onClampEdges?: (edges: BoardClampEdges | null) => void;
  /** Which delegated child an activation came through, so the selection panel
   *  can name the worker the operator actually clicked. */
  onSelectDelegationChild?: (parentAgentId: string, childId: string) => void;
  /** The delegated child arrow navigation sits on, so it wears the ring. */
  selectedDelegationUnitId?: string | null;
  preserveDrawingBuffer?: boolean;
  theme: SpatialThemeSnapshot;
}) {
  const reduced = useReducedMotion();
  // Weak hardware alone trades resolution and bloom. Battery is a cadence
  // input below and never reaches `dpr` (BUG-263).
  const lowPower = useLowPowerMode();
  const { onBattery, visible: pageVisible } = useHostRenderPolicy();
  const cadence: AmbientCadence = resolveAmbientCadence({
    reduced,
    visible: pageVisible,
    lowPower,
    onBattery,
  });
  const [ambientScheduler] = useState(() => createAmbientFrameScheduler());
  useEffect(() => () => ambientScheduler.dispose(), [ambientScheduler]);
  const ambient = useMemo<AmbientMotion>(
    () => ({
      cadence,
      requestFrame: invalidate => ambientScheduler.request(cadence, invalidate),
    }),
    [ambientScheduler, cadence]
  );
  // During a Team→Fleet handoff the lazy postprocessing chunk's shader
  // compile is the single biggest main-thread stall — landing it mid
  // crossfade cuts the flight short. Defer the bloom mount until the entry
  // choreography has settled; outside a handoff it mounts immediately.
  const [effectsReady, setEffectsReady] = useState(false);
  useEffect(() => {
    if (!altitudeHandoffActive()) {
      setEffectsReady(true);
      return;
    }
    const timer = window.setTimeout(
      () => setEffectsReady(true),
      ALTITUDE_HANDOFF_HOLD_MS + ALTITUDE_HANDOFF_CROSSFADE_MS + 400
    );
    return () => window.clearTimeout(timer);
  }, []);
  // Hover is a store, not root state: a pointer crossing a piece must not
  // re-render every layer under the canvas. See `operations-board-hover.ts`.
  const [hover] = useState(() => createBoardHoverStore());
  /** Band-drag end timestamp — the trailing click must not clear/ascend. */
  const suppressMissRef = useRef(0);
  const visibleZones = useMemo(
    () => layout.zones.filter(zone => zone.visible),
    [layout.zones]
  );
  // Delegation composition (V3.4): pure slot/overflow/lineage policy, resolved
  // once per layout. Aggregated tiers emit none by construction.
  const delegationUnits = useMemo(
    () => selectSpatialDelegationUnits(layout),
    [layout]
  );
  // Zone-label budget: full cards only when every zone's projected width can
  // afford them, so the bound is the NARROWEST visible zone (one overflowing
  // card is the failure the tier exists to prevent). Hysteresis keeps the
  // tier stable through damped zoom, and the state only flips at a boundary
  // crossing (never per frame). Recomputes on zoom AND on zone-width changes
  // (layout ticks can resize zones without any camera motion).
  // The tier lives in a store the zone controls subscribe to, not in state
  // here: a root-level flip mid-flight re-rendered every layer under the
  // canvas. See `operations-board-label-tier.ts`.
  const [labelTierStore] = useState(() => createZoneLabelTierStore('full'));
  const minZoneWidth =
    visibleZones.length > 0
      ? visibleZones.reduce(
          (min, zone) => Math.min(min, zone.rect.width),
          Number.POSITIVE_INFINITY
        )
      : 24;
  useEffect(() => {
    labelTierStore.setMinZoneWidth(minZoneWidth);
  }, [labelTierStore, minZoneWidth]);
  const handleZoomChange = useCallback(
    (zoom: number) => labelTierStore.setZoom(zoom),
    [labelTierStore]
  );
  return (
    <Canvas
      orthographic
      frameloop="demand"
      dpr={lowPower ? [1, 1.25] : [1, 2]}
      camera={{ position: [0, 0, 100], zoom: 1, near: 0.1, far: 200 }}
      gl={{ antialias: true, preserveDrawingBuffer }}
      style={{ touchAction: 'none' }}
      onPointerMissed={event => {
        // The click that trails a band drag is not a background click.
        if (performance.now() - suppressMissRef.current < 250) return;
        if (event.type === 'click' && event.target instanceof HTMLCanvasElement)
          onBackground();
      }}
      onCreated={({ gl, scene, camera }) => {
        if (process.env.NODE_ENV !== 'production') {
          const target = window as typeof window & {
            __EVAL_GL__?: THREE.WebGLRenderer;
            __EVAL_SCENE__?: THREE.Scene;
            __EVAL_CAM__?: THREE.Camera;
          };
          target.__EVAL_GL__ = gl;
          target.__EVAL_SCENE__ = scene;
          target.__EVAL_CAM__ = camera;
        }
      }}
      aria-hidden="true"
      data-board-canvas-theme={theme.themeId}
    >
      {/* The flat board ground is the scene clear itself: identical authored
          theme color without spending a draw call on a full-screen plane. */}
      <color attach="background" args={[theme.zone]} />
      <InvalidateOnSpatialTheme theme={theme} />
      <ResumeAmbientMotion ambient={ambient} />
      <BoardDisplayResolution lowPower={lowPower} />
      {/* Soft key + fill: gives zone plates and piece bodies a readable
          top/side split in the fixed-angle projection. */}
      <ambientLight intensity={1.15} />
      <directionalLight position={[26, 42, 80]} intensity={0.65} />
      <BoardTransitionProvider>
        <BoardCameraRig
          layout={layout}
          projection={projection}
          reduced={reduced}
          controllerRef={controllerRef}
          onViewportChange={onViewportChange}
          onZoomChange={handleZoomChange}
          onBandSelect={onBandSelect}
          bandOverlayRef={bandOverlayRef}
          suppressMissRef={suppressMissRef}
          followSelection={followSelection}
          touchSelectionMode={touchSelectionMode}
          onManualCameraInput={onManualCameraInput}
          onClampEdges={onClampEdges}
        />
        <BoardField
          pieces={layout.pieces}
          altitude={layout.altitude}
          focusedProjectId={layout.focusedProjectId}
          reduced={reduced}
        >
          <BoardGrid bounds={layout.bounds} theme={theme} />
          <ZoneLayer
            zones={visibleZones}
            altitude={layout.altitude}
            focusedProjectId={layout.focusedProjectId}
            reduced={reduced}
            onDrillProject={onDrillProject}
            onToggleZoneSelect={onToggleZoneSelect}
            hover={hover}
            theme={theme}
          />
          <AgentPieceLayer
            pieces={layout.pieces}
            delegationUnits={delegationUnits}
            hover={hover}
            selectedDelegationUnitId={selectedDelegationUnitId}
            altitude={layout.altitude}
            focusedProjectId={layout.focusedProjectId}
            reduced={reduced}
            ambient={ambient}
            lens={lens}
            onSelectAgent={onSelectAgent}
            onToggleAgentSelect={onToggleAgentSelect}
            theme={theme}
          />
          <PopulationDotLayer
            zones={layout.zones}
            pieces={layout.pieces}
            altitude={layout.altitude}
            reduced={reduced}
            lens={lens}
            theme={theme}
          />
          {multiSelection && multiSelection.size > 0 && (
            <MultiSelectionLayer
              layout={layout}
              selection={multiSelection}
              theme={theme}
            />
          )}
          <ProjectControls
            zones={visibleZones}
            altitude={layout.altitude}
            focusedProjectId={layout.focusedProjectId}
            labelTierStore={labelTierStore}
            reduced={reduced}
            lens={lens}
            onDrillProject={onDrillProject}
            onToggleZoneSelect={onToggleZoneSelect}
            theme={theme}
          />
          <AgentControls
            pieces={layout.pieces}
            altitude={layout.altitude}
            focusedProjectId={layout.focusedProjectId}
            onSelectAgent={onSelectAgent}
            onToggleAgentSelect={onToggleAgentSelect}
            onHoverChange={hover.setAgent}
            onPressedChange={hover.setPressed}
            multiSelection={multiSelection}
            reduced={reduced}
            theme={theme}
          />
          <DelegationControls
            units={delegationUnits}
            pieces={layout.pieces}
            altitude={layout.altitude}
            focusedProjectId={layout.focusedProjectId}
            onSelectAgent={onSelectAgent}
            onSelectDelegationChild={onSelectDelegationChild}
            onHoverChange={hover.setDelegation}
            reduced={reduced}
            theme={theme}
          />
        </BoardField>
      </BoardTransitionProvider>
      {!lowPower && effectsReady && theme.bloom.enabled && (
        <Suspense fallback={null}>
          <OperationsBoardEffects bloom={theme.bloom} />
        </Suspense>
      )}
    </Canvas>
  );
}

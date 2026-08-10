'use client';

import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import {
  selectSpatialDirectionalAgentId,
  type SpatialSelectionDirection,
  type SpatialBoardLayout,
  type SpatialBoardLens,
  type SpatialBoardProjection,
  type SpatialBoardRect,
} from '@exawatt/ui-model';
import { useAgentFieldGlide } from '@/components/hud/webgl/use-agent-field-glide';
import {
  OperationsBoardCanvas,
  type OperationsBoardHandle,
} from './operations-board-canvas';
import type {
  BoardClampEdges,
  OperationsBoardViewport,
} from './operations-board-camera';
import { RECENTER_SPATIAL_EVENT } from '@/components/nav/command-altitude-events';
import { altitudeHandoffActive } from '@/components/nav/altitude-handoff';
import { parseStoredViewport } from '../spatial-navigation-state';
import { statusLightStateForAgentStatus } from '@/components/status-light/protocol';
import { useAppearance } from '@/components/appearance/appearance-provider';
import { mixHexColors } from '@/lib/appearance/color';
import { resolvedAppearanceCssVariables } from '@/lib/appearance/dom-adapter';
import type { ResolvedAppearance } from '@/lib/appearance/types';
import {
  spatialColorWithAlpha,
  spatialProjectIdentityColor,
  spatialThemeFromResolvedAppearance,
  type SpatialThemeSnapshot,
} from '../spatial-theme';

function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(pointer: coarse)');
    const update = () => setCoarse(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return coarse;
}

function spatialMaterialFrame(theme: SpatialThemeSnapshot): CSSProperties {
  return {
    borderColor: theme.unitMuted,
    color: theme.label,
    boxShadow: `0 12px 32px ${theme.shadow}`,
  };
}

class BoardErrorBoundary extends Component<
  { children: ReactNode; theme: SpatialThemeSnapshot },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      const { theme } = this.props;
      return (
        <div
          className="grid h-full place-items-center p-8"
          style={{ background: theme.canvas }}
        >
          <div
            className="exa-material-raised max-w-sm border p-5 text-left"
            style={spatialMaterialFrame(theme)}
          >
            <p className="text-sm font-semibold" style={{ color: theme.label }}>
              The spatial renderer is unavailable
            </p>
            <p
              className="mt-2 text-xs leading-5"
              style={{ color: theme.labelMuted }}
            >
              Your fleet is still available in the text operations view.
            </p>
            <Link
              href="/fleet"
              className="mt-4 inline-flex min-h-11 items-center border px-3 text-xs font-semibold outline-none hover:brightness-105 focus-visible:ring-2 focus-visible:ring-ring"
              style={{
                borderColor: theme.selection,
                background: theme.selection,
                color: theme.material.raised.fallback,
              }}
            >
              Open Fleet view
            </Link>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function KeyHint({
  keyName,
  label,
  theme,
}: {
  keyName: string;
  label: string;
  theme: SpatialThemeSnapshot;
}) {
  return (
    <span
      className="flex items-center gap-1.5 whitespace-nowrap text-chrome-micro"
      style={{ color: theme.labelMuted }}
    >
      <kbd
        className="exa-material-raised border px-1.5 py-0.5 font-mono text-chrome-nano"
        style={{
          ...spatialMaterialFrame(theme),
          color: theme.selection,
          boxShadow: 'none',
        }}
      >
        {keyName}
      </kbd>
      <span className="uppercase tracking-[0.12em]">{label}</span>
    </span>
  );
}

/** How long a clamp indication stays up after the bound stops being pushed.
 *  Long enough to read a single flick, short enough never to look like state. */
const CLAMP_INDICATION_MS = 520;

/**
 * Clamp feedback (V3.3 F3, decision `0024`). The camera's elastic overshoot is
 * the primary answer to a bounded gesture; this is its redundant, motion-free
 * channel, so reduced motion and low power still see that the board answered
 * rather than dropped the input. Purely decorative — the board's semantics do
 * not change at a bound.
 */
function BoardClampIndicator({
  edges,
  theme,
}: {
  edges: BoardClampEdges;
  theme: SpatialThemeSnapshot;
}) {
  const edge = theme.selection;
  const bar = (position: string, size: string, gradient: string) => (
    <span
      className={`absolute ${position} ${size}`}
      style={{ background: gradient }}
    />
  );
  const wash = spatialColorWithAlpha(edge, 0.42);
  const fade = spatialColorWithAlpha(edge, 0);
  return (
    <div
      aria-hidden="true"
      data-board-clamp={boardClampIndicatorState(edges)}
      className="pointer-events-none absolute inset-0 z-10"
    >
      {edges.left &&
        bar('left-0 top-0 h-full', 'w-6', `linear-gradient(90deg, ${wash}, ${fade})`)}
      {edges.right &&
        bar(
          'right-0 top-0 h-full',
          'w-6',
          `linear-gradient(270deg, ${wash}, ${fade})`
        )}
      {edges.top &&
        bar('left-0 top-0 w-full', 'h-6', `linear-gradient(180deg, ${wash}, ${fade})`)}
      {edges.bottom &&
        bar(
          'bottom-0 left-0 w-full',
          'h-6',
          `linear-gradient(0deg, ${wash}, ${fade})`
        )}
      {(edges.zoomIn || edges.zoomOut) && (
        <span
          className="absolute inset-0 border"
          style={{ borderColor: spatialColorWithAlpha(edge, 0.32) }}
        />
      )}
    </div>
  );
}

function boardClampIndicatorState(edges: BoardClampEdges): string {
  const parts: string[] = [];
  if (edges.left) parts.push('left');
  if (edges.right) parts.push('right');
  if (edges.top) parts.push('top');
  if (edges.bottom) parts.push('bottom');
  if (edges.zoomIn) parts.push('zoom-in');
  if (edges.zoomOut) parts.push('zoom-out');
  return parts.join(' ');
}

function BoardMiniMap({
  layout,
  viewportRef,
  onRecenter,
  theme,
}: {
  layout: SpatialBoardLayout;
  viewportRef: { current: SVGRectElement | null };
  onRecenter: () => void;
  theme: SpatialThemeSnapshot;
}) {
  const bounds = layout.minimap.bounds;
  const width = Math.max(bounds.width, 1);
  const height = Math.max(bounds.height, 1);
  return (
    <button
      type="button"
      aria-label="Recenter board from minimap"
      onClick={onRecenter}
      className="exa-material-chrome block h-11 w-16 border p-1.5 outline-none transition-[filter] hover:brightness-105 focus-visible:ring-2 focus-visible:ring-ring sm:h-24 sm:w-40 sm:p-2"
      style={spatialMaterialFrame(theme)}
    >
      <svg
        viewBox={`${bounds.x} ${bounds.y} ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
        aria-hidden="true"
      >
        {layout.zones.map(zone => {
          const minimapRadius = zone.minimapRect.width / 2;
          const urgent = zone.statusCounts.blocked + zone.statusCounts.error;
          const active =
            zone.statusCounts.working + zone.statusCounts.reviewing;
          return (
            <circle
              key={zone.id}
              cx={zone.minimapRect.x + minimapRadius}
              cy={zone.minimapRect.y + minimapRadius}
              r={minimapRadius}
              fill={
                !zone.visible
                  ? theme.zone
                  : urgent > 0
                    ? mixHexColors(theme.zone, theme.status.fault, 0.24)
                    : active > 0
                      ? mixHexColors(theme.zone, theme.status.active, 0.18)
                      : theme.zoneHover
              }
              stroke={
                zone.selected
                  ? theme.selection
                  : urgent > 0
                    ? theme.status.fault
                    : spatialProjectIdentityColor(theme, zone.id)
              }
              strokeWidth={urgent > 0 ? 0.8 : 0.45}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        <rect
          ref={viewportRef}
          x={layout.cameraBounds.x}
          y={layout.cameraBounds.y}
          width={layout.cameraBounds.width}
          height={layout.cameraBounds.height}
          fill="none"
          stroke={theme.selection}
          strokeWidth={1.2}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </button>
  );
}

export function OperationsBoardSurface({
  layout,
  projection,
  lens = 'status',
  onDrillProject,
  onSelectAgent,
  onMoveAgentSelection,
  onOverview,
  onProjectionChange,
  multiSelection,
  onToggleAgentSelect,
  onToggleZoneSelect,
  onBandSelect,
  onSelectDelegationChild,
  sessionTransitionAgentId = null,
  viewportStorageKey = 'exawatt:spatial-viewport:v2:fleet:~:~:top-down',
  preserveDrawingBuffer = false,
  resolvedAppearance,
}: {
  layout: SpatialBoardLayout;
  projection: SpatialBoardProjection;
  /** Board color lens (ENG-008): status protocol by default; `burn` recolors
   *  the population field by normalized token share. Presentation-only —
   *  attention triage below never reads it. */
  lens?: SpatialBoardLens;
  onDrillProject: (projectId: string) => void;
  onSelectAgent: (agentId: string | null) => void;
  onMoveAgentSelection?: (agentId: string) => void;
  onOverview: () => void;
  onProjectionChange: (projection: SpatialBoardProjection) => void;
  /** Multi-selection (V3.2): real, ephemeral, client-owned. Selection is the
   *  shipped mechanism; the only announced part is the Direct verb. */
  multiSelection?: ReadonlySet<string>;
  onToggleAgentSelect?: (agentId: string) => void;
  onToggleZoneSelect?: (zoneId: string) => void;
  onBandSelect?: (band: SpatialBoardRect) => void;
  /** Which delegated child an activation came through (ENG-023 D3c). */
  onSelectDelegationChild?: (parentAgentId: string, childId: string) => void;
  sessionTransitionAgentId?: string | null;
  viewportStorageKey?: string;
  preserveDrawingBuffer?: boolean;
  /** Deterministic gallery/eval injection. Production omits this and consumes
   * the app-global AppearanceProvider snapshot. */
  resolvedAppearance?: ResolvedAppearance;
}) {
  const appearance = useAppearance();
  const resolved = resolvedAppearance ?? appearance.resolved;
  const theme = useMemo(
    () => spatialThemeFromResolvedAppearance(resolved),
    [resolved]
  );
  const appearanceVariables = useMemo(
    () => resolvedAppearanceCssVariables(resolved) as CSSProperties,
    [resolved]
  );
  const controller = useRef<OperationsBoardHandle | null>(null);
  const coarsePointer = useCoarsePointer();
  const [followSelection, setFollowSelection] = useState(true);
  const [touchSelectionMode, setTouchSelectionMode] = useState(false);
  const suspendSelectionFollow = useCallback(
    () => setFollowSelection(false),
    []
  );
  const viewportRect = useRef<SVGRectElement | null>(null);
  const bandOverlay = useRef<HTMLDivElement | null>(null);
  // Clamp feedback state is semantic (which bound is engaged), not positional,
  // so it renders through React; the rig only reports edge-set CHANGES.
  const [clampEdges, setClampEdges] = useState<BoardClampEdges | null>(null);
  const clampTimer = useRef<number | null>(null);
  const handleClampEdges = useCallback((edges: BoardClampEdges | null) => {
    if (clampTimer.current !== null) window.clearTimeout(clampTimer.current);
    if (edges) setClampEdges(edges);
    clampTimer.current = window.setTimeout(() => {
      clampTimer.current = null;
      setClampEdges(null);
    }, CLAMP_INDICATION_MS);
  }, []);
  useEffect(
    () => () => {
      if (clampTimer.current !== null) window.clearTimeout(clampTimer.current);
    },
    []
  );
  const pendingViewport = useRef<OperationsBoardViewport | null>(null);
  const didRestoreViewport = useRef(false);
  const viewportSaveTimer = useRef<number | null>(null);
  const visibleZones = useMemo(
    () => layout.zones.filter(zone => zone.visible),
    [layout.zones]
  );
  // The Agent navigator is the DOM equivalent of the WebGL field at EVERY
  // altitude (the in-world controls only exist below Fleet). Delegation is
  // rendered as units at Fleet altitude too, so its census has to ride here —
  // otherwise a whole population is visible to sighted operators and absent
  // for assistive tech.
  const accessibleAgents = useMemo(
    () =>
      layout.pieces
        .filter(
          piece =>
            piece.visible && piece.kind === 'agent' && Boolean(piece.agentId)
        )
        .map(piece => ({
          id: piece.agentId!,
          label: piece.delegation
            ? `${piece.label} — ${piece.delegation.count} delegated`
            : piece.label,
        })),
    [layout.pieces]
  );
  const delegatedCount = useMemo(
    () =>
      layout.pieces.reduce(
        (total, piece) =>
          piece.visible && piece.delegation
            ? total + piece.delegation.count
            : total,
        0
      ),
    [layout.pieces]
  );
  const attentionIds = useMemo(
    () =>
      layout.pieces
        .filter(
          piece =>
            piece.visible &&
            piece.agentId &&
            (piece.status === 'blocked' || piece.status === 'error')
        )
        .map(piece => piece.agentId!),
    [layout.pieces]
  );
  const visibleLightStates = useMemo(
    () =>
      [
        ...new Set(
          layout.pieces
            .filter(piece => piece.visible && piece.kind === 'agent')
            .map(piece => statusLightStateForAgentStatus(piece.status))
        ),
      ]
        .sort()
        .join(','),
    [layout.pieces]
  );

  useAgentFieldGlide(controller);

  useEffect(() => {
    const recenter = () => controller.current?.recenter();
    window.addEventListener(RECENTER_SPATIAL_EVENT, recenter);
    return () => window.removeEventListener(RECENTER_SPATIAL_EVENT, recenter);
  }, []);

  useEffect(() => {
    if (didRestoreViewport.current) return;
    didRestoreViewport.current = true;
    // A Team→Fleet handoff owns the arrival camera (ENG-004 V3.0): the
    // stored viewport must not yank the entry pose. Skipping the restore on
    // a handoff that later falls back costs one remembered viewport — the
    // fit pose is the correct fallback frame anyway.
    if (altitudeHandoffActive()) return;
    const viewport = parseStoredViewport(
      window.sessionStorage.getItem(viewportStorageKey)
    );
    if (!viewport) return;
    const frame = window.requestAnimationFrame(() => {
      controller.current?.restoreViewport(viewport);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [viewportStorageKey]);

  const updateViewport = useCallback(
    (viewport: OperationsBoardViewport) => {
      const rect = viewportRect.current;
      if (rect) {
        rect.setAttribute('x', String(viewport.centerX - viewport.width / 2));
        rect.setAttribute('y', String(viewport.centerY - viewport.height / 2));
        rect.setAttribute('width', String(viewport.width));
        rect.setAttribute('height', String(viewport.height));
      }
      pendingViewport.current = viewport;
      if (viewportSaveTimer.current !== null) return;
      viewportSaveTimer.current = window.setTimeout(() => {
        viewportSaveTimer.current = null;
        if (pendingViewport.current) {
          window.sessionStorage.setItem(
            viewportStorageKey,
            JSON.stringify(pendingViewport.current)
          );
        }
      }, 200);
    },
    [viewportStorageKey]
  );

  useEffect(
    () => () => {
      if (viewportSaveTimer.current !== null) {
        window.clearTimeout(viewportSaveTimer.current);
        viewportSaveTimer.current = null;
      }
      if (pendingViewport.current) {
        window.sessionStorage.setItem(
          viewportStorageKey,
          JSON.stringify(pendingViewport.current)
        );
      }
    },
    [viewportStorageKey]
  );

  useEffect(() => {
    if (sessionTransitionAgentId) {
      controller.current?.enterSession(sessionTransitionAgentId);
    }
  }, [sessionTransitionAgentId]);

  const triage = useCallback(
    (direction: 1 | -1) => {
      if (attentionIds.length === 0) return;
      const current = layout.selectedAgentId
        ? attentionIds.indexOf(layout.selectedAgentId)
        : -1;
      const next =
        current === -1
          ? direction === 1
            ? 0
            : attentionIds.length - 1
          : (current + direction + attentionIds.length) % attentionIds.length;
      onSelectAgent(attentionIds[next]!);
    },
    [attentionIds, layout.selectedAgentId, onSelectAgent]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      )
        return;
      // Shift+1–9 toggles the zone in the multi-selection (V3.2): the
      // keyboard equivalent of shift-clicking its plate. `code` because
      // shifted digits produce symbol `key`s.
      if (
        event.shiftKey &&
        onToggleZoneSelect &&
        /^Digit[1-9]$/.test(event.code)
      ) {
        const zone = visibleZones[Number(event.code.slice(5)) - 1];
        if (zone && !zone.isAggregate) {
          onToggleZoneSelect(zone.id);
          event.preventDefault();
        }
        return;
      }
      if (event.key >= '1' && event.key <= '9') {
        const zone = visibleZones[Number(event.key) - 1];
        if (zone && !zone.isAggregate) {
          onDrillProject(zone.id);
          event.preventDefault();
        }
        return;
      }
      if (event.key === '0') {
        if (layout.altitude === 'fleet') controller.current?.recenter();
        else onOverview();
        event.preventDefault();
      } else if (event.key.toLowerCase() === 'n') {
        triage(1);
        event.preventDefault();
      } else if (event.key.toLowerCase() === 'p') {
        triage(-1);
        event.preventDefault();
      } else if (event.key.toLowerCase() === 'v') {
        onProjectionChange(
          projection === 'top-down' ? 'fixed-angle' : 'top-down'
        );
        event.preventDefault();
      } else if (event.key.startsWith('Arrow')) {
        const direction = event.key
          .slice('Arrow'.length)
          .toLowerCase() as SpatialSelectionDirection;
        const agentId = selectSpatialDirectionalAgentId(
          layout,
          layout.selectedAgentId,
          direction
        );
        if (agentId) {
          controller.current?.focusAgent(agentId);
          onMoveAgentSelection?.(agentId);
        }
        event.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    layout,
    lens,
    onDrillProject,
    onMoveAgentSelection,
    onOverview,
    onProjectionChange,
    onToggleZoneSelect,
    projection,
    triage,
    visibleZones,
  ]);

  return (
    <div
      data-spatial-board
      data-board-projection={projection}
      data-board-lens={lens}
      data-board-projects={visibleZones.length}
      data-board-pieces={layout.stats.visiblePieceCount}
      data-board-status-lights={visibleLightStates}
      data-board-multi-count={multiSelection?.size ?? 0}
      data-session-handoff={sessionTransitionAgentId ?? undefined}
      data-spatial-theme={theme.themeId}
      data-spatial-bloom={theme.bloom.enabled ? 'on' : 'off'}
      data-exa-theme={resolved.themeId}
      data-exa-appearance={resolved.appearance}
      data-exa-contrast={resolved.enhancedContrast ? 'enhanced' : 'standard'}
      data-exa-transparency={
        resolved.reducedTransparency ? 'reduced' : 'standard'
      }
      data-exa-font={resolved.interfaceFont}
      data-exa-typography={resolved.theme.typography.profile}
      className="relative h-full w-full overflow-hidden"
      style={{
        ...appearanceVariables,
        background: theme.canvas,
        color: theme.label,
      }}
    >
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {layout.selectedAgentId
          ? `Selected Agent: ${
              layout.pieces.find(
                piece => piece.agentId === layout.selectedAgentId
              )?.label ?? layout.selectedAgentId
            }`
          : 'No Agent selected'}
      </span>
      {/* Board census. Delegated children render as units at every individual
          resolution but only have their own DOM controls below Fleet, so the
          population they add is stated here rather than being sight-only. */}
      <p className="sr-only">
        {`${accessibleAgents.length} ${
          accessibleAgents.length === 1 ? 'Agent' : 'Agents'
        } on the board`}
        {delegatedCount > 0
          ? `, plus ${delegatedCount} delegated ${
              delegatedCount === 1 ? 'Agent' : 'Agents'
            }`
          : ''}
      </p>
      {accessibleAgents.length > 0 && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 opacity-0 transition-opacity focus-within:pointer-events-auto focus-within:opacity-100 motion-reduce:transition-none">
          <select
            data-board-agent-navigator
            aria-label="Select Agent on board"
            value={layout.selectedAgentId ?? ''}
            onChange={event => {
              const agentId = event.currentTarget.value;
              if (!agentId) return;
              controller.current?.focusAgent(agentId);
              if (onMoveAgentSelection) onMoveAgentSelection(agentId);
              else onSelectAgent(agentId);
            }}
            className="exa-material-chrome min-h-11 max-w-72 border px-3 font-mono text-chrome-meta outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={spatialMaterialFrame(theme)}
          >
            <option value="" disabled>
              Select Agent…
            </option>
            {accessibleAgents.map(agent => (
              <option key={agent.id} value={agent.id}>
                {agent.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="absolute inset-0">
        <BoardErrorBoundary theme={theme}>
          <OperationsBoardCanvas
            layout={layout}
            projection={projection}
            lens={lens}
            controllerRef={controller}
            onViewportChange={updateViewport}
            onDrillProject={onDrillProject}
            onSelectAgent={agentId => onSelectAgent(agentId)}
            onBackground={() => onSelectAgent(null)}
            multiSelection={multiSelection}
            onToggleAgentSelect={onToggleAgentSelect}
            onToggleZoneSelect={onToggleZoneSelect}
            onBandSelect={onBandSelect}
            bandOverlayRef={bandOverlay}
            followSelection={followSelection}
            touchSelectionMode={touchSelectionMode}
            onManualCameraInput={suspendSelectionFollow}
            onClampEdges={handleClampEdges}
            onSelectDelegationChild={onSelectDelegationChild}
            preserveDrawingBuffer={preserveDrawingBuffer}
            theme={theme}
          />
        </BoardErrorBoundary>
      </div>

      {clampEdges && <BoardClampIndicator edges={clampEdges} theme={theme} />}

      {/* Shift-drag selection band (V3.2): positioned imperatively by the
          camera rig at pointer frequency; dashed per the board's selection
          language. Display:none until a band is being drawn. */}
      {onBandSelect && (
        <div
          ref={bandOverlay}
          data-board-band-overlay
          aria-hidden="true"
          className="pointer-events-none absolute z-10 border border-dashed"
          style={{
            display: 'none',
            borderColor: theme.selection,
            background: theme.selectionWash,
          }}
        />
      )}

      {visibleZones.length === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-8">
          <div
            className="exa-material-overlay max-w-sm border p-4 text-center"
            style={spatialMaterialFrame(theme)}
          >
            <p className="text-sm font-medium" style={{ color: theme.label }}>
              No Agents match this view
            </p>
            <p
              className="mt-1 text-xs leading-5"
              style={{ color: theme.labelMuted }}
            >
              Clear the active search or status filters to restore the board.
            </p>
          </div>
        </div>
      )}

      <div
        className={`transition-opacity duration-150 motion-reduce:transition-none ${
          sessionTransitionAgentId ? 'pointer-events-none opacity-0' : ''
        }`}
      >
        {attentionIds.length > 0 && (
          <button
            type="button"
            onClick={() => triage(1)}
            className="exa-material-raised absolute bottom-16 left-3 z-10 min-h-11 border px-2.5 py-1.5 font-mono text-chrome-micro outline-none transition-[filter] hover:brightness-105 focus-visible:ring-2 focus-visible:ring-ring sm:bottom-3"
            style={{
              ...spatialMaterialFrame(theme),
              borderColor: theme.attention,
              color: theme.attention,
            }}
          >
            {attentionIds.length} need attention
          </button>
        )}

        {/* One tool cluster (S4/F6): hints, touch mode, projection, minimap,
            and zoom share a single stable region so the board carries at most
            this and the needs-you queue besides the selection panel. */}
        <div
          data-board-tool-cluster
          className="absolute bottom-3 right-3 z-10 flex flex-row items-end gap-1.5 sm:flex-col"
        >
          <div
            className="exa-material-chrome pointer-events-none hidden flex-wrap items-center justify-end gap-x-3 gap-y-1.5 border px-2.5 py-2 xl:flex"
            style={spatialMaterialFrame(theme)}
          >
            {layout.altitude === 'fleet' && (
              <KeyHint keyName="1–9" label="Project" theme={theme} />
            )}
            <KeyHint keyName="←↑↓→" label="select" theme={theme} />
            <KeyHint
              keyName={coarsePointer ? 'drag' : 'wheel WASD middle-drag'}
              label="pan"
              theme={theme}
            />
            <KeyHint keyName="pinch + −" label="zoom" theme={theme} />
            {onBandSelect && !coarsePointer && (
              <KeyHint keyName="drag" label="select" theme={theme} />
            )}
            <KeyHint keyName="V" label="view" theme={theme} />
            {attentionIds.length > 0 && (
              <KeyHint keyName="N" label="attention" theme={theme} />
            )}
            <KeyHint
              keyName={layout.altitude === 'fleet' ? '0' : 'Esc'}
              label={layout.altitude === 'fleet' ? 'recenter' : 'zoom out'}
              theme={theme}
            />
          </div>
          {coarsePointer && onBandSelect && (
            <button
              type="button"
              data-board-touch-select
              aria-pressed={touchSelectionMode}
              onClick={() => setTouchSelectionMode(value => !value)}
              className="exa-material-chrome min-h-11 border px-3 font-mono text-chrome-micro font-semibold outline-none transition-[filter] hover:brightness-105 focus-visible:ring-2 focus-visible:ring-ring"
              style={
                touchSelectionMode
                  ? {
                      ...spatialMaterialFrame(theme),
                      background: theme.selection,
                      color: theme.material.chrome.fallback,
                    }
                  : spatialMaterialFrame(theme)
              }
            >
              Select units
            </button>
          )}
          <div
            className="exa-material-chrome flex border p-1"
            aria-label="Board projection"
            style={spatialMaterialFrame(theme)}
          >
            {(['top-down', 'fixed-angle'] as const).map(option => (
              <button
                key={option}
                type="button"
                aria-pressed={projection === option}
                onClick={() => onProjectionChange(option)}
                className="min-h-11 px-2 font-mono text-chrome-micro font-semibold uppercase tracking-[0.1em] outline-none transition-[filter] hover:brightness-105 focus-visible:ring-2 focus-visible:ring-ring sm:px-3"
                style={
                  projection === option
                    ? {
                        background: theme.selection,
                        color: theme.material.chrome.fallback,
                      }
                    : { color: theme.labelMuted }
                }
              >
                {option === 'top-down' ? 'Top' : 'Angle'}
              </button>
            ))}
          </div>

          <BoardMiniMap
            layout={layout}
            viewportRef={viewportRect}
            onRecenter={() => controller.current?.recenter()}
            theme={theme}
          />

          <div
            className="exa-material-chrome flex border p-1"
            style={spatialMaterialFrame(theme)}
          >
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => controller.current?.zoom(-1)}
              className="grid h-11 w-11 place-items-center font-mono text-sm outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring"
              style={{ color: theme.labelMuted }}
            >
              −
            </button>
            <button
              type="button"
              aria-label="Recenter board"
              onClick={() => controller.current?.recenter()}
              className="grid h-11 min-w-11 place-items-center border-x px-1 font-mono text-chrome-micro uppercase tracking-[0.08em] outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring sm:px-2"
              style={{ borderColor: theme.unitMuted, color: theme.selection }}
            >
              Center
            </button>
            <button
              type="button"
              aria-label={
                followSelection ? 'Pause Agent follow' : 'Follow selected Agent'
              }
              aria-pressed={followSelection}
              disabled={!layout.selectedAgentId}
              onClick={() => {
                if (followSelection) {
                  setFollowSelection(false);
                  return;
                }
                setFollowSelection(true);
                if (layout.selectedAgentId) {
                  controller.current?.focusAgent(layout.selectedAgentId, true);
                }
              }}
              className="grid h-11 w-11 place-items-center border-r font-mono text-sm outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-35"
              style={{
                borderColor: theme.unitMuted,
                color: followSelection ? theme.selection : theme.labelMuted,
              }}
              title={
                followSelection ? 'Following selection' : 'Follow selection'
              }
            >
              ◎
            </button>
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => controller.current?.zoom(1)}
              className="grid h-11 w-11 place-items-center font-mono text-sm outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring"
              style={{ color: theme.labelMuted }}
            >
              +
            </button>
          </div>
        </div>
      </div>

      {sessionTransitionAgentId && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute inset-0 z-20 grid place-items-center"
          style={{
            background: `radial-gradient(ellipse at center, ${spatialColorWithAlpha(theme.canvas, 0)} 30%, ${spatialColorWithAlpha(theme.canvas, 0.72)} 100%)`,
          }}
        >
          <div
            className="exa-material-overlay board-control-enter border px-4 py-2 text-center"
            style={{
              ...spatialMaterialFrame(theme),
              borderColor: theme.selection,
            }}
          >
            <span
              className="block font-mono text-chrome-micro uppercase tracking-[0.14em]"
              style={{ color: theme.selection }}
            >
              Opening session
            </span>
            {(() => {
              const piece = layout.pieces.find(
                entry => entry.agentId === sessionTransitionAgentId
              );
              return piece ? (
                <span
                  className="mt-0.5 block max-w-56 truncate text-chrome-meta font-medium"
                  style={{ color: theme.label }}
                >
                  {piece.label}
                </span>
              ) : null;
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

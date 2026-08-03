'use client';

import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import type {
  SpatialBoardLayout,
  SpatialBoardLens,
  SpatialBoardProjection,
  SpatialBoardRect,
  SpatialScopeActivity,
} from '@exawatt/ui-model';
import { exact, tokens } from '@/components/consumption/flux';
import { AnnouncedChip } from '@/components/readiness';
import { useAgentFieldGlide } from '@/components/hud/webgl/use-agent-field-glide';
import {
  OperationsBoardCanvas,
  type OperationsBoardHandle,
  type OperationsBoardViewport,
} from './operations-board-canvas';
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
  spatialPressureColor,
  spatialProjectIdentityColor,
  spatialThemeFromResolvedAppearance,
  type SpatialThemeSnapshot,
} from '../spatial-theme';

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

/** One count in the scope readout: protocol-colored dot + mono figure. The
 *  dot echoes the D40 light the bucket folds into (D30 redundant channels:
 *  the word carries the meaning; the hue only echoes it). */
function ScopeCount({
  color,
  count,
  label,
  theme,
}: {
  color: string;
  count: number;
  label: string;
  theme: SpatialThemeSnapshot;
}) {
  return (
    <span className="flex items-center gap-1 whitespace-nowrap">
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: color, opacity: count > 0 ? 1 : 0.35 }}
      />
      <span className="font-mono tabular-nums" style={{ color: theme.label }}>
        {count}
      </span>
      <span style={{ color: theme.labelMuted }}>{label}</span>
    </span>
  );
}

/**
 * Fleet-scope activity readout (V3.2): fleet totals by default, the
 * selection's totals while a multi-selection exists. Working/blocked/idle
 * ride the D40 buckets; token burn is the scope's reported total — absent
 * (not zero) when nothing in scope reports. On a selection the panel also
 * carries the announced "Direct N Agents" verb — dashed, inert, honest.
 */
function ScopeReadout({
  activity,
  selectionCount,
  onClearSelection,
  theme,
}: {
  activity: SpatialScopeActivity;
  selectionCount: number;
  onClearSelection?: () => void;
  theme: SpatialThemeSnapshot;
}) {
  const selection = selectionCount > 0;
  return (
    <div
      data-board-scope={selection ? 'selection' : 'fleet'}
      data-board-scope-agents={activity.agentCount}
      className="exa-material-chrome absolute left-3 top-3 z-10 flex flex-col gap-1.5 border px-2.5 py-2"
      style={spatialMaterialFrame(theme)}
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className="font-mono text-chrome-micro uppercase tracking-[0.12em]"
          style={{ color: theme.selection }}
        >
          {selection
            ? `${selectionCount} selected`
            : `${activity.agentCount} agents`}
        </span>
        {selection && onClearSelection && (
          <button
            type="button"
            aria-label="Clear selection"
            onClick={onClearSelection}
            className="grid h-5 w-5 place-items-center font-mono text-xs leading-none outline-none transition-opacity hover:opacity-70 focus-visible:ring-2 focus-visible:ring-ring"
            style={{ color: theme.labelMuted }}
          >
            ×
          </button>
        )}
      </div>
      <div className="flex items-center gap-2.5 text-chrome-micro">
        <ScopeCount
          color={theme.status.active}
          count={activity.working}
          label="working"
          theme={theme}
        />
        <ScopeCount
          color={theme.status['needs-you']}
          count={activity.blocked}
          label="blocked"
          theme={theme}
        />
        <ScopeCount
          color={theme.status.off}
          count={activity.idle}
          label="idle"
          theme={theme}
        />
      </div>
      {activity.burn && (
        <div
          data-board-scope-burn
          className="flex items-baseline gap-1.5 text-chrome-micro"
          title={`${exact(activity.burn.rawTokens)} raw tokens, session to date, across ${activity.burn.reportedCount} reporting ${activity.burn.reportedCount === 1 ? 'Agent' : 'Agents'}${activity.burn.unreportedCount > 0 ? ` · ${activity.burn.unreportedCount} unreported` : ''}`}
        >
          <span
            className="font-mono tabular-nums"
            style={{ color: theme.label }}
          >
            {tokens(activity.burn.rawTokens)}
          </span>
          {/* the figure states its basis and window like every consumption
              readout: raw units, each Agent's session to date */}
          <span style={{ color: theme.labelMuted }}>raw · session</span>
          {activity.burn.unreportedCount > 0 && (
            <span style={{ color: theme.consumption.unknown }}>
              {activity.burn.unreportedCount} unreported
            </span>
          )}
        </div>
      )}
      {selection && (
        <AnnouncedChip
          coming={`direct all ${selectionCount} selected Agents at once`}
          className="mt-0.5 self-start"
        >
          Direct {selectionCount} {selectionCount === 1 ? 'Agent' : 'Agents'}
        </AnnouncedChip>
      )}
    </div>
  );
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
        preserveAspectRatio="none"
        className="h-full w-full"
        aria-hidden="true"
      >
        {layout.zones.map(zone => (
          <rect
            key={zone.id}
            x={zone.rect.x}
            y={zone.rect.y}
            width={zone.rect.width}
            height={zone.rect.height}
            fill={zone.visible ? theme.zoneHover : theme.zone}
            stroke={
              zone.selected
                ? theme.selection
                : spatialProjectIdentityColor(theme, zone.id)
            }
            strokeWidth={0.45}
            vectorEffect="non-scaling-stroke"
          />
        ))}
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

export interface SpatialBoardHero {
  agentId: string;
  title: string;
  reason: string;
}

export function OperationsBoardSurface({
  layout,
  projection,
  lens = 'status',
  hero = null,
  onDrillProject,
  onSelectAgent,
  onOverview,
  onProjectionChange,
  onLensChange,
  multiSelection,
  onToggleAgentSelect,
  onToggleZoneSelect,
  onBandSelect,
  onClearMultiSelect,
  scopeActivity = null,
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
  hero?: SpatialBoardHero | null;
  onDrillProject: (projectId: string) => void;
  onSelectAgent: (agentId: string | null) => void;
  onOverview: () => void;
  onProjectionChange: (projection: SpatialBoardProjection) => void;
  onLensChange?: (lens: SpatialBoardLens) => void;
  /** Multi-selection (V3.2): real, ephemeral, client-owned. Selection is the
   *  shipped mechanism; the only announced part is the Direct verb. */
  multiSelection?: ReadonlySet<string>;
  onToggleAgentSelect?: (agentId: string) => void;
  onToggleZoneSelect?: (zoneId: string) => void;
  onBandSelect?: (band: SpatialBoardRect) => void;
  onClearMultiSelect?: () => void;
  /** Scope-aware activity readout (fleet totals, or the selection's). */
  scopeActivity?: SpatialScopeActivity | null;
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
  const viewportRect = useRef<SVGRectElement | null>(null);
  const bandOverlay = useRef<HTMLDivElement | null>(null);
  const pendingViewport = useRef<OperationsBoardViewport | null>(null);
  const viewportSaveTimer = useRef<number | null>(null);
  const visibleZones = useMemo(
    () => layout.zones.filter(zone => zone.visible),
    [layout.zones]
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
    const rect = viewportRect.current;
    if (!rect) return;
    rect.setAttribute('x', String(layout.cameraBounds.x));
    rect.setAttribute('y', String(layout.cameraBounds.y));
    rect.setAttribute('width', String(layout.cameraBounds.width));
    rect.setAttribute('height', String(layout.cameraBounds.height));
  }, [layout.cameraBounds]);

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
      } else if (event.key.toLowerCase() === 'b' && onLensChange) {
        onLensChange(lens === 'status' ? 'burn' : 'status');
        event.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    layout.altitude,
    lens,
    onDrillProject,
    onLensChange,
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
            preserveDrawingBuffer={preserveDrawingBuffer}
            theme={theme}
          />
        </BoardErrorBoundary>
      </div>

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
        {scopeActivity &&
          ((multiSelection && multiSelection.size > 0) ||
            (layout.altitude === 'fleet' && scopeActivity.agentCount > 0)) && (
            <ScopeReadout
              activity={scopeActivity}
              selectionCount={multiSelection?.size ?? 0}
              onClearSelection={onClearMultiSelect}
              theme={theme}
            />
          )}
        {hero && layout.altitude !== 'agent' && (
          <button
            type="button"
            onClick={() => onSelectAgent(hero.agentId)}
            className="exa-material-overlay absolute left-1/2 top-3 z-10 max-w-[min(30rem,calc(100%-2rem))] -translate-x-1/2 border px-3 py-2 text-left outline-none transition-[filter,transform] duration-150 hover:brightness-105 active:translate-y-px focus-visible:ring-2 focus-visible:ring-ring"
            style={{
              ...spatialMaterialFrame(theme),
              borderColor: theme.attention,
              background: mixHexColors(
                theme.material.overlay.fallback,
                theme.attention,
                theme.appearance === 'light' ? 0.08 : 0.14
              ),
            }}
          >
            <span
              className="block truncate text-xs font-semibold"
              style={{ color: theme.label }}
            >
              {hero.title}
            </span>
            <span
              className="mt-0.5 block truncate text-chrome-micro"
              style={{ color: theme.attention }}
            >
              {hero.reason}
            </span>
          </button>
        )}

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

        <div
          className="exa-material-chrome pointer-events-none absolute bottom-3 left-1/2 z-10 hidden -translate-x-1/2 flex-wrap items-center justify-center gap-x-3 gap-y-1.5 border px-2.5 py-2 xl:flex"
          style={spatialMaterialFrame(theme)}
        >
          {layout.altitude === 'fleet' && (
            <KeyHint keyName="1–9" label="Project" theme={theme} />
          )}
          <KeyHint keyName="drag ←↑↓→" label="pan" theme={theme} />
          <KeyHint keyName="pinch + −" label="zoom" theme={theme} />
          {onBandSelect && (
            <KeyHint keyName="⇧ drag" label="select" theme={theme} />
          )}
          <KeyHint keyName="V" label="view" theme={theme} />
          {onLensChange && <KeyHint keyName="B" label="burn" theme={theme} />}
          {attentionIds.length > 0 && (
            <KeyHint keyName="N" label="attention" theme={theme} />
          )}
          <KeyHint
            keyName={layout.altitude === 'fleet' ? '0' : 'Esc'}
            label={layout.altitude === 'fleet' ? 'recenter' : 'zoom out'}
            theme={theme}
          />
        </div>

        <div className="absolute bottom-3 right-3 z-10 flex flex-row items-end gap-1.5 sm:flex-col">
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

          {onLensChange && (
            <div className="flex flex-col items-stretch gap-1">
              <div
                className="exa-material-chrome flex border p-1"
                aria-label="Board color lens"
                style={spatialMaterialFrame(theme)}
              >
                {(['status', 'burn'] as const).map(option => (
                  <button
                    key={option}
                    type="button"
                    data-board-lens-option={option}
                    aria-pressed={lens === option}
                    aria-label={
                      option === 'burn'
                        ? 'Color by token burn (normalized share)'
                        : 'Color by agent status'
                    }
                    onClick={() => onLensChange(option)}
                    className="min-h-11 px-2 font-mono text-chrome-micro font-semibold uppercase tracking-[0.1em] outline-none transition-[filter] hover:brightness-105 focus-visible:ring-2 focus-visible:ring-ring sm:px-3"
                    style={
                      lens === option
                        ? {
                            background:
                              option === 'burn'
                                ? theme.consumption.mid
                                : theme.selection,
                            color: theme.material.chrome.fallback,
                          }
                        : { color: theme.labelMuted }
                    }
                  >
                    {option === 'status' ? 'Status' : 'Burn'}
                  </button>
                ))}
              </div>
              {lens === 'burn' && (
                <div
                  data-board-lens-legend
                  className="exa-material-chrome hidden border px-1.5 py-1 sm:block"
                  style={spatialMaterialFrame(theme)}
                >
                  <span
                    aria-hidden="true"
                    className="block h-1 w-full"
                    style={{
                      background: `linear-gradient(90deg, ${theme.consumption.calm}, ${theme.consumption.mid}, ${theme.consumption.warm}, ${theme.consumption.hot})`,
                    }}
                  />
                  <span
                    className="mt-1 block font-mono text-chrome-nano tracking-[0.08em]"
                    style={{ color: theme.labelMuted }}
                  >
                    share of normalized burn ·{' '}
                    <span style={{ color: theme.consumption.unknown }}>
                      grey
                    </span>{' '}
                    unreported
                  </span>
                </div>
              )}
            </div>
          )}

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

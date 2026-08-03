'use client';

import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import type {
  SpatialBoardLayout,
  SpatialBoardProjection,
} from '@exawatt/ui-model';
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

class BoardErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="grid h-full place-items-center bg-[oklch(0.135_0.009_220)] p-8">
          <div className="max-w-sm border border-[oklch(0.34_0.018_215)] bg-[oklch(0.16_0.01_220)] p-5 text-left">
            <p className="text-sm font-semibold text-[oklch(0.88_0.01_210)]">
              The spatial renderer is unavailable
            </p>
            <p className="mt-2 text-xs leading-5 text-[oklch(0.62_0.012_210)]">
              Your fleet is still available in the text operations view.
            </p>
            <Link
              href="/fleet"
              className="mt-4 inline-flex min-h-11 items-center border border-[oklch(0.55_0.07_185)] bg-[oklch(0.24_0.045_185)] px-3 text-xs font-semibold text-[oklch(0.9_0.025_185)] outline-none hover:bg-[oklch(0.28_0.055_185)] focus-visible:ring-2 focus-visible:ring-[oklch(0.7_0.09_185/0.45)]"
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

function KeyHint({ keyName, label }: { keyName: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap text-chrome-micro text-[oklch(0.6_0.012_210)]">
      <kbd className="border border-[oklch(0.35_0.015_210)] bg-[oklch(0.14_0.009_215/0.94)] px-1.5 py-0.5 font-mono text-chrome-nano text-[oklch(0.73_0.035_190)]">
        {keyName}
      </kbd>
      <span className="uppercase tracking-[0.12em]">{label}</span>
    </span>
  );
}

function BoardMiniMap({
  layout,
  viewportRef,
  onRecenter,
}: {
  layout: SpatialBoardLayout;
  viewportRef: { current: SVGRectElement | null };
  onRecenter: () => void;
}) {
  const bounds = layout.minimap.bounds;
  const width = Math.max(bounds.width, 1);
  const height = Math.max(bounds.height, 1);
  return (
    <button
      type="button"
      aria-label="Recenter board from minimap"
      onClick={onRecenter}
      className="block h-11 w-16 border border-[oklch(0.34_0.014_210)] bg-[oklch(0.15_0.009_220/0.96)] p-1.5 outline-none transition-colors hover:border-[oklch(0.52_0.055_185)] focus-visible:ring-2 focus-visible:ring-[oklch(0.7_0.09_185/0.4)] sm:h-24 sm:w-40 sm:p-2"
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
            fill={
              zone.visible ? 'oklch(0.35 0.025 200)' : 'oklch(0.2 0.01 215)'
            }
            stroke={
              zone.selected ? 'oklch(0.75 0.09 185)' : 'oklch(0.48 0.025 210)'
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
          stroke="oklch(0.82 0.11 185)"
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
  hero = null,
  onDrillProject,
  onSelectAgent,
  onOverview,
  onProjectionChange,
  sessionTransitionAgentId = null,
  viewportStorageKey = 'exawatt:spatial-viewport:v2:fleet:~:~:top-down',
  preserveDrawingBuffer = false,
}: {
  layout: SpatialBoardLayout;
  projection: SpatialBoardProjection;
  hero?: SpatialBoardHero | null;
  onDrillProject: (projectId: string) => void;
  onSelectAgent: (agentId: string | null) => void;
  onOverview: () => void;
  onProjectionChange: (projection: SpatialBoardProjection) => void;
  sessionTransitionAgentId?: string | null;
  viewportStorageKey?: string;
  preserveDrawingBuffer?: boolean;
}) {
  const controller = useRef<OperationsBoardHandle | null>(null);
  const viewportRect = useRef<SVGRectElement | null>(null);
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
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    layout.altitude,
    onDrillProject,
    onOverview,
    onProjectionChange,
    projection,
    triage,
    visibleZones,
  ]);

  return (
    <div
      data-spatial-board
      data-board-projection={projection}
      data-board-projects={visibleZones.length}
      data-board-pieces={layout.stats.visiblePieceCount}
      data-board-status-lights={visibleLightStates}
      data-session-handoff={sessionTransitionAgentId ?? undefined}
      className="relative h-full w-full overflow-hidden bg-[oklch(0.135_0.009_220)]"
    >
      <div className="absolute inset-0">
        <BoardErrorBoundary>
          <OperationsBoardCanvas
            layout={layout}
            projection={projection}
            controllerRef={controller}
            onViewportChange={updateViewport}
            onDrillProject={onDrillProject}
            onSelectAgent={agentId => onSelectAgent(agentId)}
            onBackground={() => onSelectAgent(null)}
            preserveDrawingBuffer={preserveDrawingBuffer}
          />
        </BoardErrorBoundary>
      </div>

      {visibleZones.length === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-8">
          <div className="max-w-sm border border-[oklch(0.31_0.012_215)] bg-[oklch(0.15_0.009_220/0.96)] p-4 text-center shadow-[0_18px_60px_oklch(0.06_0.01_220/0.45)]">
            <p className="text-sm font-medium text-[oklch(0.84_0.012_210)]">
              No Agents match this view
            </p>
            <p className="mt-1 text-xs leading-5 text-[oklch(0.6_0.012_210)]">
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
        {hero && layout.altitude !== 'agent' && (
          <button
            type="button"
            onClick={() => onSelectAgent(hero.agentId)}
            className="absolute left-1/2 top-3 z-10 max-w-[min(30rem,calc(100%-2rem))] -translate-x-1/2 border border-[oklch(0.56_0.12_28)] bg-[oklch(0.19_0.045_28/0.97)] px-3 py-2 text-left shadow-[0_12px_32px_oklch(0.07_0.025_28/0.5)] outline-none transition-[border-color,transform] duration-150 hover:border-[oklch(0.68_0.14_28)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[oklch(0.72_0.12_28/0.45)]"
          >
            <span className="block truncate text-xs font-semibold text-[oklch(0.92_0.025_28)]">
              {hero.title}
            </span>
            <span className="mt-0.5 block truncate text-chrome-micro text-[oklch(0.72_0.05_28)]">
              {hero.reason}
            </span>
          </button>
        )}

        {attentionIds.length > 0 && (
          <button
            type="button"
            onClick={() => triage(1)}
            className="absolute bottom-16 left-3 z-10 min-h-11 border border-[oklch(0.52_0.1_28)] bg-[oklch(0.18_0.035_28/0.94)] px-2.5 py-1.5 font-mono text-chrome-micro text-[oklch(0.78_0.09_28)] outline-none transition-colors hover:bg-[oklch(0.22_0.045_28/0.98)] focus-visible:ring-2 focus-visible:ring-[oklch(0.68_0.12_28/0.4)] sm:bottom-3"
          >
            {attentionIds.length} need attention
          </button>
        )}

        <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 hidden -translate-x-1/2 flex-wrap items-center justify-center gap-x-3 gap-y-1.5 border border-[oklch(0.29_0.01_215)] bg-[oklch(0.13_0.008_220/0.9)] px-2.5 py-2 xl:flex">
          {layout.altitude === 'fleet' && (
            <KeyHint keyName="1–9" label="Project" />
          )}
          <KeyHint keyName="drag ←↑↓→" label="pan" />
          <KeyHint keyName="pinch + −" label="zoom" />
          <KeyHint keyName="V" label="view" />
          {attentionIds.length > 0 && <KeyHint keyName="N" label="attention" />}
          <KeyHint
            keyName={layout.altitude === 'fleet' ? '0' : 'Esc'}
            label={layout.altitude === 'fleet' ? 'recenter' : 'zoom out'}
          />
        </div>

        <div className="absolute bottom-3 right-3 z-10 flex flex-row items-end gap-1.5 sm:flex-col">
          <div
            className="flex border border-[oklch(0.34_0.014_210)] bg-[oklch(0.15_0.009_220/0.96)] p-1"
            aria-label="Board projection"
          >
            {(['top-down', 'fixed-angle'] as const).map(option => (
              <button
                key={option}
                type="button"
                aria-pressed={projection === option}
                onClick={() => onProjectionChange(option)}
                className={`min-h-11 px-2 font-mono text-chrome-micro font-semibold uppercase tracking-[0.1em] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[oklch(0.7_0.09_185/0.4)] sm:px-3 ${
                  projection === option
                    ? 'bg-[oklch(0.32_0.055_185)] text-[oklch(0.92_0.025_185)]'
                    : 'text-[oklch(0.62_0.012_210)] hover:bg-[oklch(0.2_0.015_210)] hover:text-[oklch(0.82_0.015_210)]'
                }`}
              >
                {option === 'top-down' ? 'Top' : 'Angle'}
              </button>
            ))}
          </div>

          <BoardMiniMap
            layout={layout}
            viewportRef={viewportRect}
            onRecenter={() => controller.current?.recenter()}
          />

          <div className="flex border border-[oklch(0.34_0.014_210)] bg-[oklch(0.15_0.009_220/0.96)] p-1">
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => controller.current?.zoom(-1)}
              className="grid h-11 w-11 place-items-center font-mono text-sm text-[oklch(0.72_0.02_210)] outline-none hover:bg-[oklch(0.21_0.015_210)] focus-visible:ring-2 focus-visible:ring-[oklch(0.7_0.09_185/0.4)]"
            >
              −
            </button>
            <button
              type="button"
              aria-label="Recenter board"
              onClick={() => controller.current?.recenter()}
              className="grid h-11 min-w-11 place-items-center border-x border-[oklch(0.3_0.012_210)] px-1 font-mono text-chrome-micro uppercase tracking-[0.08em] text-[oklch(0.68_0.025_190)] outline-none hover:bg-[oklch(0.21_0.015_210)] focus-visible:ring-2 focus-visible:ring-[oklch(0.7_0.09_185/0.4)] sm:px-2"
            >
              Center
            </button>
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => controller.current?.zoom(1)}
              className="grid h-11 w-11 place-items-center font-mono text-sm text-[oklch(0.72_0.02_210)] outline-none hover:bg-[oklch(0.21_0.015_210)] focus-visible:ring-2 focus-visible:ring-[oklch(0.7_0.09_185/0.4)]"
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
            background:
              'radial-gradient(ellipse at center, oklch(0.08 0.008 220 / 0) 30%, oklch(0.08 0.008 220 / 0.55) 100%)',
          }}
        >
          <div className="board-control-enter border border-[oklch(0.48_0.055_185)] bg-[oklch(0.13_0.012_220/0.94)] px-4 py-2 text-center shadow-[0_16px_48px_oklch(0.04_0.01_220/0.55)]">
            <span className="block font-mono text-chrome-micro uppercase tracking-[0.14em] text-[oklch(0.82_0.055_185)]">
              Opening session
            </span>
            {(() => {
              const piece = layout.pieces.find(
                entry => entry.agentId === sessionTransitionAgentId
              );
              return piece ? (
                <span className="mt-0.5 block max-w-56 truncate text-chrome-meta font-medium text-[oklch(0.9_0.01_210)]">
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

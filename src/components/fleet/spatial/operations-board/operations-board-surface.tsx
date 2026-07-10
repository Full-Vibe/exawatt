'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { SpatialBoardLayout } from '@exawatt/ui-model';
import { useAgentFieldGlide } from '@/components/hud/webgl/use-agent-field-glide';
import {
  OperationsBoardCanvas,
  type OperationsBoardHandle,
} from './operations-board-canvas';

function KeyHint({ keyName, label }: { keyName: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap text-[10px] text-[oklch(0.6_0.012_210)]">
      <kbd className="border border-[oklch(0.35_0.015_210)] bg-[oklch(0.14_0.009_215/0.94)] px-1.5 py-0.5 font-mono text-[9px] text-[oklch(0.73_0.035_190)]">
        {keyName}
      </kbd>
      <span className="uppercase tracking-[0.12em]">{label}</span>
    </span>
  );
}

export interface SpatialBoardHero {
  agentId: string;
  title: string;
  reason: string;
}

export function OperationsBoardSurface({
  layout,
  hero = null,
  onDrillProject,
  onSelectAgent,
  onOverview,
  preserveDrawingBuffer = false,
}: {
  layout: SpatialBoardLayout;
  hero?: SpatialBoardHero | null;
  onDrillProject: (projectId: string) => void;
  onSelectAgent: (agentId: string | null) => void;
  onOverview: () => void;
  preserveDrawingBuffer?: boolean;
}) {
  const controller = useRef<OperationsBoardHandle | null>(null);
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

  useAgentFieldGlide(controller);

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
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [layout.altitude, onDrillProject, onOverview, triage, visibleZones]);

  return (
    <div
      data-spatial-board
      data-board-projection="top-down"
      data-board-projects={visibleZones.length}
      data-board-pieces={layout.stats.visiblePieceCount}
      className="relative h-full w-full overflow-hidden bg-[oklch(0.135_0.009_220)]"
    >
      <div className="absolute inset-0">
        <OperationsBoardCanvas
          layout={layout}
          controllerRef={controller}
          onDrillProject={onDrillProject}
          onSelectAgent={agentId => onSelectAgent(agentId)}
          onBackground={() => onSelectAgent(null)}
          preserveDrawingBuffer={preserveDrawingBuffer}
        />
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

      {hero && layout.altitude !== 'agent' && (
        <button
          type="button"
          onClick={() => onSelectAgent(hero.agentId)}
          className="absolute left-1/2 top-3 z-10 max-w-[min(30rem,calc(100%-2rem))] -translate-x-1/2 border border-[oklch(0.56_0.12_28)] bg-[oklch(0.19_0.045_28/0.97)] px-3 py-2 text-left shadow-[0_12px_32px_oklch(0.07_0.025_28/0.5)] outline-none transition-[border-color,transform] duration-150 hover:border-[oklch(0.68_0.14_28)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[oklch(0.72_0.12_28/0.45)]"
        >
          <span className="block truncate text-xs font-semibold text-[oklch(0.92_0.025_28)]">
            {hero.title}
          </span>
          <span className="mt-0.5 block truncate text-[10px] text-[oklch(0.72_0.05_28)]">
            {hero.reason}
          </span>
        </button>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-3 p-3">
        <div className="pointer-events-auto">
          {attentionIds.length > 0 && (
            <button
              type="button"
              onClick={() => triage(1)}
              className="border border-[oklch(0.52_0.1_28)] bg-[oklch(0.18_0.035_28/0.94)] px-2.5 py-1.5 font-mono text-[10px] text-[oklch(0.78_0.09_28)] outline-none transition-colors hover:bg-[oklch(0.22_0.045_28/0.98)] focus-visible:ring-2 focus-visible:ring-[oklch(0.68_0.12_28/0.4)]"
            >
              {attentionIds.length} need attention
            </button>
          )}
        </div>
        <div className="hidden flex-wrap items-center justify-end gap-x-3 gap-y-1.5 border border-[oklch(0.29_0.01_215)] bg-[oklch(0.13_0.008_220/0.9)] px-2.5 py-2 md:flex">
          {layout.altitude === 'fleet' && (
            <KeyHint keyName="1–9" label="Project" />
          )}
          <KeyHint keyName="←↑↓→" label="pan" />
          <KeyHint keyName="+ −" label="zoom" />
          {attentionIds.length > 0 && <KeyHint keyName="N" label="attention" />}
          <KeyHint
            keyName={layout.altitude === 'fleet' ? '0' : 'Esc'}
            label={layout.altitude === 'fleet' ? 'recenter' : 'zoom out'}
          />
        </div>
      </div>
    </div>
  );
}

import type { AgentStatus } from '@exawatt/core';
import type { Altitude, SpatialBoardProjection } from '@exawatt/ui-model';
import type { StatusLightState } from '@/components/status-light';
import type { OperationsBoardViewport } from './operations-board/operations-board-camera';

export const SPATIAL_FILTERABLE_STATUSES: AgentStatus[] = [
  'working',
  'blocked',
  'reviewing',
  'idle',
  'complete',
  'error',
];

export const SPATIAL_FILTER_SIGNALS: StatusLightState[] = [
  'active',
  'needs-you',
  'fault',
  'result',
  'off',
];

export const SPATIAL_SIGNAL_STATUSES: Record<
  StatusLightState,
  readonly AgentStatus[]
> = {
  active: ['working', 'reviewing'],
  'needs-you': ['blocked'],
  fault: ['error'],
  result: ['complete'],
  off: ['idle'],
};

export function spatialFilterSignals(
  statuses: readonly AgentStatus[]
): StatusLightState[] {
  const selected = new Set(statuses);
  return SPATIAL_FILTER_SIGNALS.filter(signal =>
    SPATIAL_SIGNAL_STATUSES[signal].some(status => selected.has(status))
  );
}

export function toggleSpatialFilterSignal(
  statuses: readonly AgentStatus[],
  signal: StatusLightState
): AgentStatus[] {
  const next = new Set(statuses);
  const members = SPATIAL_SIGNAL_STATUSES[signal];
  const selected = members.some(status => next.has(status));
  for (const status of members) {
    if (selected) next.delete(status);
    else next.add(status);
  }
  return SPATIAL_FILTERABLE_STATUSES.filter(status => next.has(status));
}

export interface SpatialFilters {
  query: string;
  statuses: AgentStatus[];
}

export function readSpatialFilters(
  params: Pick<URLSearchParams, 'get'>
): SpatialFilters {
  const requested = (params.get('status') ?? '').split(',');
  return {
    query: params.get('q') ?? '',
    statuses: SPATIAL_FILTERABLE_STATUSES.filter(status =>
      requested.includes(status)
    ),
  };
}

export function writeSpatialFilters(
  params: URLSearchParams,
  filters: SpatialFilters
): URLSearchParams {
  const next = new URLSearchParams(params);
  const query = filters.query.trim();
  if (query) next.set('q', query);
  else next.delete('q');

  const statuses = SPATIAL_FILTERABLE_STATUSES.filter(status =>
    filters.statuses.includes(status)
  );
  if (statuses.length) next.set('status', statuses.join(','));
  else next.delete('status');
  return next;
}

export function spatialViewportStorageKey({
  altitude,
  projectId,
  agentId,
  projection,
}: {
  altitude: Altitude;
  projectId: string | null;
  agentId: string | null;
  projection: SpatialBoardProjection;
}): string {
  const segment = (value: string | null) =>
    value === null ? '~' : encodeURIComponent(value);
  return [
    'exawatt:spatial-viewport:v2',
    altitude,
    segment(projectId),
    segment(agentId),
    projection,
  ].join(':');
}

export function parseStoredViewport(
  value: string | null
): OperationsBoardViewport | null {
  if (!value) return null;
  try {
    const candidate = JSON.parse(value) as Partial<OperationsBoardViewport>;
    const values = [
      candidate.centerX,
      candidate.centerY,
      candidate.width,
      candidate.height,
    ];
    if (
      !values.every(item => typeof item === 'number' && Number.isFinite(item))
    ) {
      return null;
    }
    const maxMagnitude = 1_000_000;
    if (
      Math.abs(candidate.centerX!) > maxMagnitude ||
      Math.abs(candidate.centerY!) > maxMagnitude ||
      candidate.width! < 0.01 ||
      candidate.height! < 0.01 ||
      candidate.width! > maxMagnitude ||
      candidate.height! > maxMagnitude
    ) {
      return null;
    }
    return candidate as OperationsBoardViewport;
  } catch {
    return null;
  }
}

import type { AgentStatus } from '@exawatt/core';
import type { Altitude, SpatialBoardProjection } from '@exawatt/ui-model';
import type { OperationsBoardViewport } from './operations-board/operations-board-canvas';

export const SPATIAL_FILTERABLE_STATUSES: AgentStatus[] = [
  'working',
  'blocked',
  'reviewing',
  'idle',
];

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
  return [
    'exawatt:spatial-viewport:v1',
    altitude,
    projectId ?? '-',
    agentId ?? '-',
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
    if (candidate.width! <= 0 || candidate.height! <= 0) return null;
    return candidate as OperationsBoardViewport;
  } catch {
    return null;
  }
}

import { describe, expect, it } from 'vitest';
import {
  parseStoredViewport,
  readSpatialFilters,
  spatialViewportStorageKey,
  writeSpatialFilters,
} from './spatial-navigation-state';

describe('spatial navigation state', () => {
  it('round trips canonical query and status filters', () => {
    const params = writeSpatialFilters(
      new URLSearchParams('altitude=project'),
      {
        query: ' build ',
        statuses: ['idle', 'working'],
      }
    );
    expect(params.toString()).toBe(
      'altitude=project&q=build&status=working%2Cidle'
    );
    expect(readSpatialFilters(params)).toEqual({
      query: 'build',
      statuses: ['working', 'idle'],
    });
  });

  it('ignores unknown filters and removes empty values', () => {
    const params = writeSpatialFilters(
      new URLSearchParams('q=old&status=unknown'),
      { query: '', statuses: [] }
    );
    expect(params.toString()).toBe('');
    expect(readSpatialFilters(new URLSearchParams('status=unknown'))).toEqual({
      query: '',
      statuses: [],
    });
  });

  it('keys camera memory by semantic board address', () => {
    expect(
      spatialViewportStorageKey({
        altitude: 'agent',
        projectId: 'project-a',
        agentId: 'agent-a',
        projection: 'fixed-angle',
      })
    ).toBe('exawatt:spatial-viewport:v1:agent:project-a:agent-a:fixed-angle');
  });

  it('accepts only finite, positive stored viewports', () => {
    expect(
      parseStoredViewport(
        JSON.stringify({ centerX: 1, centerY: 2, width: 30, height: 20 })
      )
    ).toEqual({ centerX: 1, centerY: 2, width: 30, height: 20 });
    expect(parseStoredViewport('{bad')).toBeNull();
    expect(
      parseStoredViewport(
        JSON.stringify({ centerX: 1, centerY: 2, width: 0, height: 20 })
      )
    ).toBeNull();
  });
});

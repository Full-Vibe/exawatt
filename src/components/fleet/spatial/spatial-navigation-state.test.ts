import { describe, expect, it } from 'vitest';
import {
  parseStoredViewport,
  readSpatialFilters,
  spatialFilterSignals,
  spatialViewportStorageKey,
  toggleSpatialFilterSignal,
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

  it('maps the five visible signals to all six source statuses', () => {
    expect(spatialFilterSignals(['working', 'reviewing', 'error'])).toEqual([
      'active',
      'fault',
    ]);
    expect(toggleSpatialFilterSignal([], 'active')).toEqual([
      'working',
      'reviewing',
    ]);
    expect(
      toggleSpatialFilterSignal(['working', 'reviewing', 'complete'], 'active')
    ).toEqual(['complete']);
    expect(toggleSpatialFilterSignal([], 'result')).toEqual(['complete']);
    expect(toggleSpatialFilterSignal([], 'fault')).toEqual(['error']);
  });

  it('keys camera memory by semantic board address', () => {
    expect(
      spatialViewportStorageKey({
        altitude: 'agent',
        projectId: 'project-a',
        agentId: 'agent-a',
        projection: 'fixed-angle',
      })
    ).toBe('exawatt:spatial-viewport:v2:agent:project-a:agent-a:fixed-angle');
    expect(
      spatialViewportStorageKey({
        altitude: 'agent',
        projectId: 'project:a',
        agentId: 'agent:b',
        projection: 'top-down',
      })
    ).toBe('exawatt:spatial-viewport:v2:agent:project%3Aa:agent%3Ab:top-down');
  });

  it('preserves optional camera zoom and rejects invalid zoom without dropping old viewports', () => {
    const viewport = { centerX: 1, centerY: 2, width: 30, height: 20 };
    expect(parseStoredViewport(JSON.stringify(viewport))).toEqual(viewport);
    expect(
      parseStoredViewport(JSON.stringify({ ...viewport, zoom: 2.5 }))
    ).toEqual({ ...viewport, zoom: 2.5 });
    for (const zoom of [null, '2', 0, -1, 1_000_001]) {
      expect(
        parseStoredViewport(JSON.stringify({ ...viewport, zoom }))
      ).toBeNull();
    }
  });

  it('restores a native perspective pose and rejects corrupt pose coordinates', () => {
    const viewport = {
      centerX: 1,
      centerY: 2,
      width: 30,
      height: 20,
      perspective: {
        target: [1, 0, 2],
        distance: 30,
        azimuth: -0.12,
        polar: 0.8,
      },
    };
    expect(parseStoredViewport(JSON.stringify(viewport))).toEqual(viewport);
    for (const patch of [
      { target: [1, 2] },
      { target: [null, 0, 0] },
      { distance: 0 },
      { polar: Math.PI },
      { azimuth: 'bad' },
    ])
      expect(
        parseStoredViewport(
          JSON.stringify({
            ...viewport,
            perspective: { ...viewport.perspective, ...patch },
          })
        )
      ).toBeNull();
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
    expect(
      parseStoredViewport(
        JSON.stringify({
          centerX: 10_000_000,
          centerY: 2,
          width: 30,
          height: 20,
        })
      )
    ).toBeNull();
  });
});

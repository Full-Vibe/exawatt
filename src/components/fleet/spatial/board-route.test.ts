import { describe, expect, it } from 'vitest';
import {
  moveBoardRoute,
  readBoardRoute,
  sameBoardRoute,
  writeBoardRoute,
} from './board-route';

describe('board route', () => {
  it('round-trips through the URL without inventing parameters', () => {
    const params = new URLSearchParams('fleet=voltaic&altitude=project&project=p1');
    const route = readBoardRoute(params);
    expect(route).toEqual({
      altitude: 'project',
      projectId: 'p1',
      agentId: null,
      projection: 'top-down',
    });
    const written = writeBoardRoute(new URLSearchParams('fleet=voltaic'), route);
    expect(written.toString()).toBe('fleet=voltaic&altitude=project&project=p1');
  });

  it('leaves defaults out of the URL', () => {
    const written = writeBoardRoute(
      new URLSearchParams('fleet=voltaic&altitude=agent&agent=a&projection=fixed-angle'),
      { altitude: 'fleet', projectId: null, agentId: null, projection: 'top-down' }
    );
    expect(written.toString()).toBe('fleet=voltaic');
  });

  it('keeps unrelated parameters intact', () => {
    const written = writeBoardRoute(new URLSearchParams('q=hello&status=blocked'), {
      altitude: 'project',
      projectId: 'p2',
      agentId: null,
      projection: 'top-down',
    });
    expect(written.get('q')).toBe('hello');
    expect(written.get('status')).toBe('blocked');
  });

  it('treats an unknown altitude as Fleet', () => {
    expect(readBoardRoute(new URLSearchParams('altitude=galaxy')).altitude).toBe('fleet');
  });

  it('moves only what a verb names', () => {
    const start = readBoardRoute(new URLSearchParams('altitude=project&project=p1&projection=fixed-angle'));
    const drilled = moveBoardRoute(start, { altitude: 'agent', agent: 'a1' });
    expect(drilled).toEqual({ altitude: 'agent', projectId: 'p1', agentId: 'a1', projection: 'fixed-angle' });
    const ascended = moveBoardRoute(drilled, { altitude: 'fleet', project: null, agent: null });
    expect(ascended.projection).toBe('fixed-angle');
    expect(sameBoardRoute(ascended, { altitude: 'fleet', projectId: null, agentId: null, projection: 'fixed-angle' })).toBe(true);
  });
});

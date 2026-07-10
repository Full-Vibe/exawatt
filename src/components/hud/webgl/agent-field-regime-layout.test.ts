import { describe, expect, it } from 'vitest';
import type { ClusterInfo, FieldAgent } from './agent-field-types';
import {
  layoutProjectDeck,
  projectUnitPosition,
} from './agent-field-regime-layout';

const cluster: ClusterInfo = {
  index: 0,
  id: 'project-1',
  label: 'Project One',
  cx: 12,
  cy: -8,
  radius: 16,
  count: 3,
  dominant: 'working',
  attention: 1,
  critical: true,
};

const agent = (
  id: string,
  status: FieldAgent['status'] = 'working'
): FieldAgent => ({
  id,
  name: id,
  status,
  cluster: 0,
  x: 0,
  y: 0,
});

describe('Project semantic-regime layout', () => {
  it('keeps positions stable when status changes', () => {
    const before = layoutProjectDeck(
      [agent('charlie'), agent('alpha'), agent('bravo')],
      cluster
    );
    const after = layoutProjectDeck(
      [agent('charlie', 'blocked'), agent('alpha'), agent('bravo')],
      cluster
    );
    expect(after.units.map(({ agent: a, x, y }) => [a.id, x, y])).toEqual(
      before.units.map(({ agent: a, x, y }) => [a.id, x, y])
    );
  });

  it('centers an incomplete final row around the Project', () => {
    const layout = layoutProjectDeck(
      [agent('alpha'), agent('bravo'), agent('charlie')],
      cluster
    );
    const last = layout.units[2];
    expect(last.x).toBe(cluster.cx);
  });

  it('returns the semantic position used by camera focus', () => {
    const layout = layoutProjectDeck([agent('alpha'), agent('bravo')], cluster);
    expect(projectUnitPosition(layout, 'bravo')).toEqual({
      x: layout.units[1].x,
      y: layout.units[1].y,
    });
    expect(projectUnitPosition(layout, 'missing')).toBeNull();
  });

  it('ignores agents belonging to another Project', () => {
    const outsider = { ...agent('outsider'), cluster: 1 };
    const layout = layoutProjectDeck([agent('alpha'), outsider], cluster);
    expect(layout.units.map(unit => unit.agent.id)).toEqual(['alpha']);
  });
});

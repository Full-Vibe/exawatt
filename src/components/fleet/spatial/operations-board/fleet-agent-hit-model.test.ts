import { describe, expect, it } from 'vitest';
import type { SpatialBoardPiece } from '@exawatt/ui-model';
import {
  createFleetAgentHitSelector,
  fleetAgentHitId,
} from './fleet-agent-hit-model';

const piece = (id: string, overrides: Partial<SpatialBoardPiece> = {}) =>
  ({
    id,
    agentId: id,
    kind: 'agent',
    visible: true,
    x: 1,
    y: 2,
    size: 3,
    ...overrides,
  }) as SpatialBoardPiece;

describe('Fleet Agent picking ownership', () => {
  it('only targets visible addressable bodies and forgets departed or stopped Agents', () => {
    const select = createFleetAgentHitSelector();
    const live = piece('live');
    const input = [
      live,
      piece('hidden', { visible: false }),
      piece('aggregate', { kind: 'aggregate' }),
      piece('unaddressed', { agentId: null }),
      piece('stopped', { sessionState: 'stopped' }),
    ];
    expect(select(input)).toEqual([live]);
    expect(select([piece('live', { sessionState: 'stopped' })])).toEqual([]);
  });
  it('reuses picking geometry through status churn but updates positions and identities', () => {
    const select = createFleetAgentHitSelector();
    const initial = select([piece('one')]);
    expect(select([piece('one', { status: 'working' })])).toBe(initial);
    expect(select([piece('one', { x: 7 })])).not.toBe(initial);
    expect(select([piece('two')])[0]?.agentId).toBe('two');
  });
  it('modifies exactly the addressed Agent and leaves ordinary clicks and drags to their owners', () => {
    const targets = [piece('one'), piece('two')];
    expect(
      fleetAgentHitId(targets, { shiftKey: true, delta: 0, instanceId: 1 })
    ).toBe('two');
    expect(
      fleetAgentHitId(targets, { shiftKey: false, delta: 0, instanceId: 1 })
    ).toBeNull();
    expect(
      fleetAgentHitId(targets, { shiftKey: true, delta: 6, instanceId: 1 })
    ).toBeNull();
    expect(
      fleetAgentHitId(targets, { shiftKey: true, delta: 0, instanceId: 2 })
    ).toBeNull();
  });
});

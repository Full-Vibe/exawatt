import { describe, expect, it } from 'vitest';
import { sampleAgentLife, type AgentLifePose } from './agent-life';
import {
  STATUS_LIGHT_META,
  type StatusLightState,
} from '@/components/status-light/protocol';
const sample = (
  id: number,
  state: StatusLightState,
  time: number,
  hover = 0,
  reduced = false
) => {
  const out: AgentLifePose = { lift: 0, yaw: 0, lean: 0, pulse: 1 };
  sampleAgentLife(id, state, time, hover, reduced, out);
  return out;
};
describe('agent activity motion', () => {
  it('keeps rest still while working agents move with individual phases', () => {
    expect(sample(4, 'off', 0)).toEqual(sample(4, 'off', 5));
    expect(sample(0, 'active', 0)).not.toEqual(sample(0, 'active', 1));
    expect(sample(0, 'active', 1)).not.toEqual(sample(1, 'active', 1));
  });
  it('removes ambient motion for every state with reduced motion', () => {
    for (const state of Object.keys(STATUS_LIGHT_META) as StatusLightState[])
      expect(sample(0, state, 0, 0, true)).toEqual(
        sample(0, state, 5, 0, true)
      );
  });
  it('responds to hover without moving an agent out of its territory', () => {
    const rest = sample(0, 'active', 1),
      hover = sample(0, 'active', 1, 1);
    expect(hover.lift).toBeGreaterThan(rest.lift);
    expect(hover.lift).toBeLessThan(0.3);
    expect(hover.lean).toBeGreaterThan(rest.lean);
  });
});

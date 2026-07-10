import { describe, expect, it } from 'vitest';
import { isLowPowerSpatialDevice } from './agent-field-capabilities';

describe('AgentField capability hint', () => {
  it('keeps effects on for an unconstrained desktop', () => {
    expect(
      isLowPowerSpatialDevice({ hardwareConcurrency: 10, deviceMemory: 16 })
    ).toBe(false);
  });

  it('gates effects for constrained CPU, memory, or save-data signals', () => {
    expect(isLowPowerSpatialDevice({ hardwareConcurrency: 4 })).toBe(true);
    expect(isLowPowerSpatialDevice({ deviceMemory: 4 })).toBe(true);
    expect(isLowPowerSpatialDevice({ saveData: true })).toBe(true);
  });

  it('does not punish browsers that expose no hardware hints', () => {
    expect(isLowPowerSpatialDevice({})).toBe(false);
  });
});

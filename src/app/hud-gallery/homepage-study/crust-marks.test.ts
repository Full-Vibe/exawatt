import { describe, expect, it } from 'vitest';
import { fleetModel, sourceAdapterId } from './fleet-model';
import { MARK_COUNT, markIndexFor } from './visuals/crust-marks';

describe('harness marks', () => {
  it('give every harness in the study fleet its own mark', () => {
    const model = fleetModel();
    const bySource = new Map<string, number>();
    for (const agent of model.agents)
      bySource.set(agent.source, markIndexFor(sourceAdapterId(agent.source)));
    expect(bySource.size).toBeGreaterThan(1);
    expect(new Set(bySource.values()).size).toBe(bySource.size);
    for (const index of bySource.values()) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(MARK_COUNT);
    }
  });

  it('have no mark for a harness the product may not draw', () => {
    expect(markIndexFor('antigravity')).toBe(-1);
    expect(markIndexFor('Something new')).toBe(-1);
  });
});

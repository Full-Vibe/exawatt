import { describe, expect, it } from 'vitest';
import { fleetModel } from './fleet-model';
import { GLYPH_COUNT, glyphIndexFor } from './visuals/crust-glyphs';

describe('kind marks', () => {
  it('give every harness in the study fleet its own glyph', () => {
    const model = fleetModel();
    const bySource = new Map<string, number>();
    for (const agent of model.agents)
      bySource.set(agent.source, glyphIndexFor(agent.source));
    expect(new Set(bySource.values()).size).toBe(bySource.size);
    expect(bySource.size).toBe(GLYPH_COUNT);
    for (const index of bySource.values()) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(GLYPH_COUNT);
    }
  });

  it('fall back to the hexagon for a harness the study does not know', () => {
    expect(glyphIndexFor('Something new')).toBe(0);
  });
});

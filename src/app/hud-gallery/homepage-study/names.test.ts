import { describe, expect, it } from 'vitest';
import { nameShown, nameStyleOf } from './names';
import { STAGES } from './stages';

const index = (id: string) => STAGES.findIndex(stage => stage.id === id);

describe('project names', () => {
  it('borders the Projects up close and tags them over the whole fleet', () => {
    expect(nameStyleOf('auto', STAGES[index('third')], false)).toBe('border');
    expect(nameStyleOf('auto', STAGES[index('fleet')], false)).toBe('tag');
    expect(nameStyleOf('auto', STAGES[index('landing')], false)).toBeNull();
  });

  it('names no Project over the whole fleet on a narrow screen', () => {
    expect(nameStyleOf('auto', STAGES[index('fleet')], true)).toBeNull();
    expect(nameStyleOf('tag', STAGES[index('working')], true)).toBe('tag');
  });

  it('never changes style while it can be seen', () => {
    const from = index('third');
    // the middle of the move from the last Project scene to the fleet
    const middle = from + 0.5;
    expect(nameShown('auto', 'border', middle, false)).toBe(0);
    expect(nameShown('auto', 'tag', middle, false)).toBe(0);
    // at either end, the stage's own style, whole
    expect(nameShown('auto', 'border', from, false)).toBe(1);
    expect(nameShown('auto', 'tag', from + 1, false)).toBe(1);
  });

  it('keeps one style whole across a move between stages that both draw it', () => {
    const middle = index('working') + 0.5;
    expect(nameShown('auto', 'border', middle, false)).toBe(1);
  });

  it('only ever switches style where neither can be seen, across the whole story', () => {
    // the frame loop draws the style of the scene the camera is nearer and
    // shows it by `nameShown`; sweep the rail finely, as a frame rate would
    const styleAt = (rail: number) => {
      const from = Math.min(STAGES.length - 2, Math.floor(rail));
      const t = rail - from;
      // the rail's own ease puts the middle of the move at the middle
      return nameStyleOf('auto', STAGES[t < 0.5 ? from : from + 1], false);
    };
    let previous = styleAt(0);
    for (let rail = 0; rail <= STAGES.length - 1; rail += 0.002) {
      const style = styleAt(rail);
      if (style !== previous) {
        if (previous)
          expect(nameShown('auto', previous, rail, false)).toBeLessThan(0.02);
        if (style)
          expect(nameShown('auto', style, rail, false)).toBeLessThan(0.02);
      }
      previous = style;
    }
  });
});

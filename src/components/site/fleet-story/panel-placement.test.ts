import { describe, expect, it } from 'vitest';
import {
  panelWidth,
  placePanel,
  type PanelPlacementInput,
  type PanelSide,
} from './panel-placement';

const WIDE = { width: 1440, height: 812 };
const PHONE = { width: 390, height: 796 };
const INSET = { top: 112, bottom: 36 };

function wide(
  tile: { x: number; y: number },
  column: PanelSide,
  extra: Partial<PanelPlacementInput> = {}
): PanelPlacementInput {
  return {
    stage: WIDE,
    tile,
    panel: { width: 236, height: 190 },
    column,
    narrow: false,
    inset: INSET,
    ...extra,
  };
}

const hits = (input: PanelPlacementInput) => {
  const p = placePanel(input);
  const nx = Math.min(Math.max(input.tile.x, p.x), p.x + input.panel.width);
  const ny = Math.min(Math.max(input.tile.y, p.y), p.y + input.panel.height);
  const clear = Math.min(
    92,
    Math.max(48, Math.min(input.stage.width, input.stage.height) * 0.1)
  );
  return Math.hypot(input.tile.x - nx, input.tile.y - ny) < clear;
};

describe('the open panel placement', () => {
  it('docks opposite the reading column', () => {
    expect(placePanel(wide({ x: 900, y: 400 }, 1)).side).toBe(-1);
    expect(placePanel(wide({ x: 700, y: 400 }, -1)).side).toBe(1);
  });

  it('docks opposite the tile when the type is centred', () => {
    expect(placePanel(wide({ x: 400, y: 450 }, 0)).side).toBe(1);
    expect(placePanel(wide({ x: 1000, y: 450 }, 0)).side).toBe(-1);
  });

  it('stays at the edge, not beside the tile', () => {
    const p = placePanel(wide({ x: 720, y: 420 }, 0));
    const edgeGap = Math.min(p.x, WIDE.width - 236 - p.x);
    expect(edgeGap).toBeLessThan(60);
  });

  it('stays inside the stage and clear of the chrome', () => {
    for (let x = 0; x <= WIDE.width; x += 120)
      for (let y = 0; y <= WIDE.height; y += 90)
        for (const column of [-1, 0, 1] as const) {
          const p = placePanel(wide({ x, y }, column));
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.x + 236).toBeLessThanOrEqual(WIDE.width);
          expect(p.y).toBeGreaterThanOrEqual(INSET.top);
          expect(p.y + 190).toBeLessThanOrEqual(WIDE.height - INSET.bottom);
        }
  });

  it('drifts a little with the selection and no more', () => {
    const high = placePanel(wide({ x: 700, y: 200 }, -1));
    const low = placePanel(wide({ x: 700, y: 700 }, -1));
    expect(low.y).toBeGreaterThan(high.y);
    // the whole sweep of a tile top to bottom moves the panel less than a
    // quarter of the stage
    expect(low.y - high.y).toBeLessThan(WIDE.height * 0.25);
    const left = placePanel(wide({ x: 300, y: 420 }, -1));
    const right = placePanel(wide({ x: 1300, y: 420 }, -1));
    expect(Math.abs(right.x - left.x)).toBeLessThanOrEqual(40);
  });

  it('never covers the tile it describes, wherever the tile is', () => {
    const covered: string[] = [];
    for (let x = 40; x < WIDE.width; x += 60)
      for (let y = 140; y < WIDE.height; y += 50)
        for (const column of [-1, 0, 1] as const)
          if (hits(wide({ x, y }, column))) covered.push(`${x},${y},${column}`);
    expect(covered).toEqual([]);
  });

  it('slides clear before it changes side when the tile is under it', () => {
    // the reading column is on the left, so the panel wants the right edge;
    // a tile right there pushes it up or down, not over to the type
    const input = wide({ x: 1300, y: 400 }, -1);
    const p = placePanel(input);
    expect(p.side).toBe(1);
    expect(hits(input)).toBe(false);
  });

  it('does not flip when the tile hovers near the middle', () => {
    let side: PanelSide = 1;
    const flips: number[] = [];
    for (let x = 700; x <= 740; x += 4) {
      const p = placePanel(wide({ x, y: 420 }, 0, { previousSide: side }));
      if (p.side !== side) flips.push(x);
      side = p.side;
    }
    expect(flips).toHaveLength(0);
  });

  describe('on a phone', () => {
    const phone = (
      tile: { x: number; y: number },
      column: PanelSide = 1
    ): PanelPlacementInput => ({
      stage: PHONE,
      tile,
      panel: { width: panelWidth(PHONE.width, true), height: 170 },
      column,
      narrow: true,
      inset: { top: 96, bottom: 24 },
    });

    it('is a sheet across the width', () => {
      const w = panelWidth(PHONE.width, true);
      expect(w).toBeLessThanOrEqual(340);
      expect(w).toBeLessThanOrEqual(PHONE.width - 32);
      const p = placePanel(phone({ x: 195, y: 300 }));
      expect(p.x).toBeCloseTo((PHONE.width - w) / 2, 5);
    });

    it('takes the top beside a scene whose type is at the foot, unless the tile is up there', () => {
      const middle = placePanel(phone({ x: 195, y: 420 }));
      expect(middle.y).toBe(96);
      const high = placePanel(phone({ x: 195, y: 190 }));
      expect(high.y).toBeGreaterThan(300);
    });

    it('takes the foot under a scene whose type is centred at the top', () => {
      const middle = placePanel(phone({ x: 195, y: 420 }, 0));
      expect(middle.y).toBe(PHONE.height - 24 - 170);
      const low = placePanel(phone({ x: 195, y: PHONE.height - 120 }, 0));
      expect(low.y).toBe(96);
    });

    it('stands as far from the tile as it can when both ends reach it', () => {
      // a short phone and a tall card: both ends come within the tile's clear
      const short = { width: 390, height: 520 };
      const tall = { width: panelWidth(390, true), height: 240 };
      const input = (y: number): PanelPlacementInput => ({
        stage: short,
        tile: { x: 195, y },
        panel: tall,
        column: 1,
        narrow: true,
        inset: { top: 40, bottom: 24 },
      });
      const nearTop = placePanel(input(250));
      expect(nearTop.y).toBe(short.height - 24 - 240);
      const nearFoot = placePanel(input(300));
      expect(nearFoot.y).toBe(40);
    });

    it('never covers the tile, wherever it is', () => {
      for (let y = 110; y < PHONE.height; y += 30) {
        const input = phone({ x: 195, y });
        const p = placePanel(input);
        expect(p.y).toBeGreaterThanOrEqual(96);
        expect(p.y + 170).toBeLessThanOrEqual(PHONE.height - 24);
        // the zone it takes is clear of the tile unless the tile is in both
        // (a sheet that tall leaves the middle of a phone for the tile)
        const bothCover =
          hits({
            ...input,
            inset: { top: 96, bottom: PHONE.height - 96 - 170 },
          }) &&
          hits({
            ...input,
            inset: { top: PHONE.height - 24 - 170, bottom: 24 },
          });
        if (!bothCover) expect(hits(input)).toBe(false);
      }
    });
  });
});

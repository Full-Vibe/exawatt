import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  AX_TILEABLE_WINDOW_SHAPE,
  REFERENCE_DISPLAY_SIZES,
  smallestTilingCell,
} from './window-shape';

/**
 * Divvy, Rectangle, Moom and Hammerspoon all tile through the macOS
 * Accessibility API. Each assertion below is one thing that API needs to see,
 * paired with the reason — so a future chrome change that would make Exawatt
 * untileable has to delete a stated invariant rather than quietly flip a flag.
 */
describe('the window an AX window manager can tile', () => {
  it('accepts a frame written through AXSize', () => {
    expect(AX_TILEABLE_WINDOW_SHAPE.resizable).toBe(true);
  });

  it('keeps the standard window buttons AXZoomButton reads', () => {
    // `hiddenInset` hides the title bar, not the buttons. `frame: false` or a
    // fully custom title bar removes them.
    expect(AX_TILEABLE_WINDOW_SHAPE.titleBarStyle).toBe('hiddenInset');
    expect(AX_TILEABLE_WINDOW_SHAPE.frame).toBe(true);
    expect(AX_TILEABLE_WINDOW_SHAPE.maximizable).toBe(true);
    expect(AX_TILEABLE_WINDOW_SHAPE.fullscreenable).toBe(true);
  });

  it('reports the shape it draws', () => {
    expect(AX_TILEABLE_WINDOW_SHAPE.transparent).toBe(false);
  });

  it('has a size floor below the smallest cell an operator tiles into', () => {
    // macOS clamps an AX-set frame to the window minimum, so a floor above the
    // cell silently vetoes the tile and reads as "it can't resize Exawatt".
    const cell = smallestTilingCell();
    expect(AX_TILEABLE_WINDOW_SHAPE.minWidth).toBeLessThan(cell.width);
    expect(AX_TILEABLE_WINDOW_SHAPE.minHeight).toBeLessThan(cell.height);
  });

  it('derives that cell from real displays rather than a remembered number', () => {
    const cell = smallestTilingCell();
    const smallest = REFERENCE_DISPLAY_SIZES.reduce((a, b) =>
      a.width * a.height <= b.width * b.height ? a : b
    );
    expect(cell.width).toBe(Math.floor(smallest.width / 2));
    expect(cell.height).toBe(Math.floor(smallest.height / 2));
  });
});

describe('the window main.ts actually builds', () => {
  it('takes its AX-relevant options from the contract, not inline literals', () => {
    // The regression this guards is a chrome change that reintroduces one of
    // these as a literal in `createWindow` and drifts from the contract.
    const source = fs.readFileSync(path.join(__dirname, 'main.ts'), 'utf8');
    const construction = source.slice(
      source.indexOf('mainWindow = new BrowserWindow({'),
      source.indexOf('webPreferences: {')
    );
    expect(construction).toContain('...AX_TILEABLE_WINDOW_SHAPE');
    for (const option of Object.keys(AX_TILEABLE_WINDOW_SHAPE)) {
      expect(construction).not.toMatch(new RegExp(`\\b${option}\\s*:`));
    }
  });
});

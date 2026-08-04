import { describe, expect, it } from 'vitest';
import { boardPointerAction, pinchZoomTarget } from './operations-board-input';

describe('operations board pointer grammar', () => {
  it('uses primary mouse and pen drag for band selection', () => {
    for (const pointerType of ['mouse', 'pen']) {
      expect(
        boardPointerAction({
          pointerType,
          button: 0,
          touchSelectionMode: false,
          canBandSelect: true,
        })
      ).toBe('band');
    }
  });

  it('uses direct touch for pan until explicit selection mode is armed', () => {
    expect(
      boardPointerAction({
        pointerType: 'touch',
        button: 0,
        touchSelectionMode: false,
        canBandSelect: true,
      })
    ).toBe('pan');
    expect(
      boardPointerAction({
        pointerType: 'touch',
        button: 0,
        touchSelectionMode: true,
        canBandSelect: true,
      })
    ).toBe('band');
  });

  it('keeps middle drag as pan and ignores other buttons', () => {
    expect(
      boardPointerAction({
        pointerType: 'mouse',
        button: 1,
        touchSelectionMode: false,
        canBandSelect: true,
      })
    ).toBe('pan');
    expect(
      boardPointerAction({
        pointerType: 'mouse',
        button: 2,
        touchSelectionMode: false,
        canBandSelect: true,
      })
    ).toBe('ignore');
  });

  it('derives pinch zoom from the gesture distance ratio', () => {
    expect(pinchZoomTarget(8, 100, 125)).toBe(10);
    expect(pinchZoomTarget(8, 100, 75)).toBe(6);
  });
});

export type BoardPointerAction = 'band' | 'pan' | 'ignore';

/** Platform-specific gesture grammar, kept outside the renderer for testing. */
export function boardPointerAction({
  pointerType,
  button,
  touchSelectionMode,
  canBandSelect,
}: {
  pointerType: string;
  button: number;
  touchSelectionMode: boolean;
  canBandSelect: boolean;
}): BoardPointerAction {
  if (button !== 0 && button !== 1) return 'ignore';
  if (button === 1) return 'pan';
  if (pointerType === 'touch') {
    return touchSelectionMode && canBandSelect ? 'band' : 'pan';
  }
  return canBandSelect ? 'band' : 'pan';
}

export function pinchZoomTarget(
  startZoom: number,
  startDistance: number,
  distance: number
): number {
  return startZoom * (Math.max(1, distance) / Math.max(1, startDistance));
}

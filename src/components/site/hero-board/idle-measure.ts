/**
 * Idle-motion measurement for the hero board study (ENG-031 W2).
 *
 * The budget is a measurement, so the study measures rather than asserts:
 * two frames one second apart, compared per channel. Displaying the live
 * numbers next to the board is the only way an operator can see a budget being
 * met instead of being promised.
 *
 * Method, stated so the numbers are interpretable:
 * - the canvas is sampled at its own resolution, downscaled only if it exceeds
 *   `SAMPLE_MAX_WIDTH`, which keeps the cost of a sample bounded;
 * - `meanChannelDelta` is the mean absolute difference across R, G and B over
 *   every sampled pixel, in 0..255 units;
 * - a pixel counts as CHANGED when any channel moves by at least
 *   `CHANGED_CHANNEL_THRESHOLD`, which ignores dither and rounding noise;
 * - alpha is excluded: an opaque board has none to give.
 *
 * Reading the pixels back needs `preserveDrawingBuffer`, so measurement is a
 * study and eval mode, never how the production hero is configured.
 */

export const SAMPLE_MAX_WIDTH = 640;
export const CHANGED_CHANNEL_THRESHOLD = 2;

export interface IdleFrameDelta {
  /** Mean absolute per-channel delta, 0..255. Budget: under 2. */
  meanChannelDelta: number;
  /** Share of pixels with any channel moving at least the threshold. Budget:
   *  under 0.05. Above 0.10 reads as a screensaver. */
  changedPixelShare: number;
  /** The largest single-channel move seen, for diagnosing a spike. */
  maxChannelDelta: number;
  pixels: number;
}

export function compareFrames(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  threshold = CHANGED_CHANNEL_THRESHOLD
): IdleFrameDelta {
  const pixels = Math.min(a.length, b.length) / 4;
  let total = 0;
  let changed = 0;
  let max = 0;
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * 4;
    const dr = Math.abs(a[offset]! - b[offset]!);
    const dg = Math.abs(a[offset + 1]! - b[offset + 1]!);
    const db = Math.abs(a[offset + 2]! - b[offset + 2]!);
    total += dr + dg + db;
    const peak = Math.max(dr, dg, db);
    if (peak > max) max = peak;
    if (peak >= threshold) changed += 1;
  }
  return {
    meanChannelDelta: pixels === 0 ? 0 : total / (pixels * 3),
    changedPixelShare: pixels === 0 ? 0 : changed / pixels,
    maxChannelDelta: max,
    pixels,
  };
}

export interface IdleBudgetVerdict {
  meanOk: boolean;
  shareOk: boolean;
  screensaver: boolean;
  ok: boolean;
}

export function gradeIdleDelta(
  delta: IdleFrameDelta,
  budget: { meanChannelDelta: number; changedPixelShare: number }
): IdleBudgetVerdict {
  const meanOk = delta.meanChannelDelta < budget.meanChannelDelta;
  const shareOk = delta.changedPixelShare < budget.changedPixelShare;
  return {
    meanOk,
    shareOk,
    screensaver: delta.changedPixelShare >= 0.1,
    ok: meanOk && shareOk,
  };
}

/** Sample a canvas into RGBA bytes, bounded by `SAMPLE_MAX_WIDTH`. */
export function sampleCanvas(
  source: HTMLCanvasElement,
  scratch: HTMLCanvasElement
): Uint8ClampedArray | null {
  if (source.width === 0 || source.height === 0) return null;
  const scale = Math.min(1, SAMPLE_MAX_WIDTH / source.width);
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  if (scratch.width !== width) scratch.width = width;
  if (scratch.height !== height) scratch.height = height;
  const context = scratch.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(source, 0, 0, width, height);
  return context.getImageData(0, 0, width, height).data;
}

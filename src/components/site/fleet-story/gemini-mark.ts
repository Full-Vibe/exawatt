/**
 * The Gemini spark (ENG-031 W15q, operator 2026-10-15: "incorporate the
 * Gemini or anti-gravity agent logo into the homepage agent view"). Gemini
 * is a harness Exawatt ships (the Antigravity CLI, ENG-003 S5.3, named
 * Gemini per S5.3.1), but the product's chrome draws no mark for it
 * (`SOURCE_MARKS.antigravity` is null: Google permits only its own artwork,
 * unaltered), so the homepage draws it from here, under decision `0047`'s
 * accepted risk.
 *
 * - The outline is Google's own path, byte for byte: the clip path of the
 *   current Gemini product logo,
 *   `gstatic.com/images/branding/productlogos/gemini_2026/v1/192px.svg`,
 *   in its 192 box. That outline is the spark's whole silhouette.
 * - Google fills it with a raster of its four colours blending into each
 *   other, which a part of one colour cannot carry, on the tile or in the
 *   card. So the colours are the logo's own zones, posterised: every pixel
 *   of that raster put to the nearest of the four colours, which divides
 *   the spark into four sectors about one point, (64, 86), where they meet
 *   (blue to green at 53 degrees, green to yellow at 95, yellow to red at
 *   202, red to blue at 320, clockwise from the right). Red, yellow and
 *   green are the outline clipped to their sectors and flattened to lines
 *   (to 0.06 of a unit); blue is the outline itself, under them.
 * - The colours are Google's: the blue the stop Google's own 2025 vector
 *   logo names (#3186FF), the others sampled at the spark's tips from the
 *   2026 raster (`mark-tones.ts`).
 *
 * Overlapping parts stand on different layers (the tile renderer lifts a
 * layer above the one below, so they never z-fight): the blue spark at the
 * bottom, red and green, which meet only at the hub, on the next, yellow,
 * which borders both, above them. Provenance and the accepted risk:
 * `LICENSES/brand/harness-marks.md`.
 */

import type { MarkPaths } from './concept-marks';

const GEMINI_SPARK_D =
  'M95.99 6.99a4.1 4.1 0 0 1 3.95 3.09q2.1 8.31 5.48 16.2 8.85 20.57 24.29 36a115 115 0 0 0 36.01 24.29 106 106 0 0 0 16.2 5.48 4.07 4.07 0 0 1 0 7.9 114.3 114.3 0 0 0-52.21 29.77 115 115 0 0 0-24.29 36.01 106 106 0 0 0-5.48 16.2 4.07 4.07 0 0 1-7.9 0 114 114 0 0 0-29.77-52.21 114 114 0 0 0-36-24.29 106 106 0 0 0-16.2-5.48 4.07 4.07 0 0 1 0-7.9q8.31-2.1 16.2-5.48 20.57-8.85 36-24.29a115 115 0 0 0 24.29-36 106 106 0 0 0 5.48-16.2 4.1 4.1 0 0 1 3.95-3.09';
const GEMINI_RED_D =
  'M95.99 6.99L97.1 7.15L98.12 7.6L98.99 8.32L99.63 9.24L99.88 9.86L101.07 14.21L102.36 18.29L103.81 22.31L105.42 26.28L106.94 29.67L109.39 34.63L112.05 39.42L114.59 43.55L64 86L43.22 77.6L47.05 75.05L51.41 71.84L55.62 68.43L59.66 64.81L62.27 62.28L66.03 58.32L69.6 54.19L72.97 49.89L76.13 45.44L79.08 40.84L81.8 36.11L84.3 31.25L86.84 25.62L88.68 20.98L90.29 16.26L92.1 9.86L92.35 9.24L92.99 8.32L93.86 7.6L94.88 7.15Z';
const GEMINI_YELLOW_D =
  'M60.34 127.84L56.96 124.74L54.19 122.38L48.42 117.93L42.39 113.86L36.1 110.18L29.6 106.91L22.97 104.07L17.6 102.14L14.2 101.07L9.64 99.82L8.84 99.41L7.84 98.51L7.37 97.74L7.08 96.89L7.01 95.55L7.2 94.67L7.59 93.86L8.47 92.85L9.64 92.18L14.88 90.72L18.95 89.4L23.63 87.66L27.98 85.82L32.98 83.44L36.23 81.73L39.41 79.94L43.22 77.6L64 86Z';
const GEMINI_GREEN_D =
  'M113 151.02L111.06 154.31L108.49 159.13L106.9 162.4L105.14 166.39L103.81 169.69L102.35 173.72L101.06 177.8L99.81 182.36L99.4 183.16L98.84 183.86L98.13 184.41L97.32 184.8L96.44 184.99L95.54 184.99L94.25 184.63L93.48 184.16L92.84 183.53L92.17 182.36L89.9 174.64L87.29 167.5L84.2 160.55L80.66 153.83L76.67 147.35L73.78 143.19L70.71 139.16L65.77 133.38L62.27 129.72L60.34 127.84L64 86Z';

export const GEMINI_MARK: MarkPaths = {
  viewBox: 192,
  fillRule: 'nonzero',
  parts: [
    { d: GEMINI_SPARK_D, tone: 'blue', layer: 0 },
    { d: GEMINI_RED_D, tone: 'red', layer: 1 },
    { d: GEMINI_GREEN_D, tone: 'green', layer: 1 },
    { d: GEMINI_YELLOW_D, tone: 'yellow', layer: 2 },
  ],
};

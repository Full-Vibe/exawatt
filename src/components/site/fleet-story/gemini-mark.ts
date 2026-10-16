/**
 * The Gemini spark (ENG-031 W15q, operator 2026-10-15: "incorporate the
 * Gemini or anti-gravity agent logo into the homepage agent view"). Gemini
 * is a harness Exawatt ships (the Antigravity CLI, ENG-003 S5.3, named
 * Gemini per S5.3.1), but the product's chrome draws no mark for it
 * (`SOURCE_MARKS.antigravity` is null: Google permits only its own artwork,
 * unaltered), so the homepage draws it from here, under decision `0047`'s
 * accepted risk.
 *
 * The outline is Google's own path, byte for byte: the clip path of the
 * current Gemini product logo,
 * `gstatic.com/images/branding/productlogos/gemini_2026/v1/192px.svg`, in
 * its 192 box. Google fills it with its four colours; the story draws the
 * silhouette alone in one tone (operator 2026-10-15, on the four-colour
 * spark: "Gemini logo sticks out too much, make it less colorful or
 * single-color"), so it sits among the other marks as a peer. Provenance
 * and the accepted risk: `LICENSES/brand/harness-marks.md`.
 */

import type { MarkPaths } from './concept-marks';

const GEMINI_SPARK_D =
  'M95.99 6.99a4.1 4.1 0 0 1 3.95 3.09q2.1 8.31 5.48 16.2 8.85 20.57 24.29 36a115 115 0 0 0 36.01 24.29 106 106 0 0 0 16.2 5.48 4.07 4.07 0 0 1 0 7.9 114.3 114.3 0 0 0-52.21 29.77 115 115 0 0 0-24.29 36.01 106 106 0 0 0-5.48 16.2 4.07 4.07 0 0 1-7.9 0 114 114 0 0 0-29.77-52.21 114 114 0 0 0-36-24.29 106 106 0 0 0-16.2-5.48 4.07 4.07 0 0 1 0-7.9q8.31-2.1 16.2-5.48 20.57-8.85 36-24.29a115 115 0 0 0 24.29-36 106 106 0 0 0 5.48-16.2 4.1 4.1 0 0 1 3.95-3.09';

export const GEMINI_MARK: MarkPaths = {
  viewBox: 192,
  fillRule: 'nonzero',
  parts: [{ d: GEMINI_SPARK_D, tone: 'ink', layer: 0 }],
};

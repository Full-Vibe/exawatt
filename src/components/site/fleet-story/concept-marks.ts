/**
 * Concept harness marks (ENG-031 W15n). The homepage's fleet shows agents
 * the product does not run yet, to show that every kind of agent can live
 * in one place (operator 2026-10-14: "add a few more agent harness logo
 * types: grok bot, Muse, Instinct, and Dot... to demonstrate the concept
 * that all agent types can live in the app"; and, told none of them can be
 * launched today, "that's fine, it's on the roadmap. Homepage is
 * aspirational and illustrative and I'll add support for them soon").
 *
 * Same shape as the product's registry (`HARNESS_MARK_PATHS` in
 * `harness-icons.tsx`), and the story's mark lookups read both, but these
 * live here and not there: the product draws a mark only for a harness it
 * runs. When an adapter for one of these ships, its mark moves into the
 * product's registry and its entry here is deleted.
 *
 * - Grok Bot: xAI's own mark from the Grok Bot page, byte for byte, a head
 *   and two eyes in the page's box (-15 -15 259 259: the 259 box moved by
 *   15). The page paints the head in its ink and the eyes in its ground, so
 *   here the three are one path with the eyes cut out of the head, which
 *   reads the same on any ground. (The page also scales the face by 1.04
 *   about its centre, a presentation the registry has no field for.)
 * - Muse: Meta's own path, byte for byte, in its 100 box. Meta draws it in
 *   a blue gradient; the story paints its middle stop.
 * - Instinct: the `I` from Instinct's own favicon, byte for byte, in the
 *   40 box it draws it in.
 * - dots: OpenAI publishes no mark for dots, so this one is Exawatt's own
 *   drawing, three dots of three sizes.
 *
 * Provenance and the operator's decision on the vendors' brand terms:
 * `LICENSES/brand/harness-marks.md`.
 */

import {
  HARNESS_MARK_PATHS,
  type HarnessMarkId,
} from '@/components/workspace/harness-icons';

type MarkPaths = (typeof HARNESS_MARK_PATHS)[HarnessMarkId];

const GROK_BOT_HEAD_D =
  'M228.541 114.228C228.541 130.133 225.184 145.994 218.738 160.534C212.674 174.217 203.904 186.669 193.065 196.988C155.933 232.34 99.497 238.596 55.5255 212.24C45.097 205.99 35.6851 198.072 27.7451 188.866C19.1926 178.953 12.3686 167.569 7.65781 155.351C2.60712 142.264 0 128.257 0 114.228C0 98.3219 3.35751 82.4611 9.80315 67.9215C15.8672 54.2382 24.6377 41.7862 35.4767 31.4668C72.6081 -3.88483 129.044 -10.1413 173.016 16.2153C183.444 22.4653 192.856 30.3829 200.796 39.5896C209.349 49.5018 216.173 60.8859 220.883 73.1037C225.934 86.1906 228.541 100.198 228.541 114.228Z';
const GROK_BOT_EYES_D = [
  'M118.17 70.73L120.45 71.04L122.59 71.76L124.55 72.87L126.18 74.38L127.42 76.24L128.34 78.29L129.10 80.42L129.83 82.57L130.55 84.72L131.27 86.86L131.97 89.02L132.64 91.19L133.29 93.36L133.91 95.55L134.50 97.74L135.05 99.95L135.36 102.23L135.16 104.55L134.41 106.80L133.11 108.84L131.36 110.51L129.28 111.73L127.01 112.45L124.68 112.65L122.41 112.33L120.31 111.51L118.45 110.26L116.93 108.62L115.81 106.69L115.01 104.57L114.39 102.39L113.80 100.19L113.17 98.01L112.52 95.84L111.85 93.66L111.17 91.51L110.47 89.35L109.75 87.20L108.94 85.09L108.17 82.96L107.64 80.75L107.63 78.44L108.31 76.16L109.61 74.14L111.41 72.51L113.54 71.41L115.84 70.83Z',
  'M179.77 59.76L182.04 60.05L184.10 60.75L185.92 61.77L187.55 63.03L188.95 64.50L190.10 66.16L191.07 67.95L191.90 69.82L192.67 71.74L193.41 73.66L194.13 75.60L194.80 77.56L195.42 79.55L196.02 81.54L196.56 83.57L197.06 85.61L197.50 87.67L197.90 89.77L198.06 91.94L197.82 94.21L197.15 96.51L195.85 98.72L193.75 100.38L191.30 101.01L189.00 100.81L186.99 100.03L185.30 98.85L183.91 97.38L182.84 95.66L182.05 93.76L181.48 91.76L181.00 89.71L180.53 87.64L180.02 85.60L179.48 83.58L178.89 81.58L178.26 79.60L177.60 77.62L176.90 75.68L176.15 73.76L175.36 71.86L174.53 69.98L173.78 68.06L173.41 65.97L173.71 63.70L175.05 61.53L177.32 60.14Z',
];
const MUSE_D =
  'M24.6257 16.1214C28.2365 16.1214 30.8187 18.9408 30.8187 23.3643C30.8185 27.7868 30.1055 31.7765 28.9225 40.2466C28.0743 46.1813 26.62 55.2418 26.0132 59.0088C27.1782 56.7815 29.9074 51.5757 30.3914 50.5982C36.1081 39.061 42.0657 28.7544 43.7826 26.0254C46.0594 22.382 48.062 20.9229 51.1597 20.9229C52.7685 20.923 54.6826 21.7357 55.6315 22.819C56.9178 24.2895 57.1859 26.6602 57.1411 29.244C57.0738 33.2073 56.5599 39.5264 55.8553 46.5698C55.5416 49.7057 54.9365 56.1066 54.5288 60.4004C58.1883 53.8532 64.9609 41.8109 67.6921 37.6058C70.0727 33.9402 72.466 31.5797 75.6836 31.5796C78.4595 31.5796 81.8809 33.5416 81.6772 38.7573C81.3774 46.4556 80.2673 63.2232 79.7607 70.7479C83.1662 65.7913 87.6377 58.4543 89.3148 55.6966C91.0104 52.908 92.75 50.6542 95.3898 50.5778C98.0987 50.4995 99.913 52.341 99.9959 55.1839C100.078 58.0277 98.3835 61.2256 96.1344 64.856C93.6937 68.7957 90.9621 73.0123 87.6383 76.9491C84.3148 80.8856 81.2604 83.8782 76.5991 83.8786C72.4243 83.8786 69.4869 81.1043 69.283 76.0254C69.1768 73.364 69.6804 67.6405 70.0602 63.1673C70.5 57.9875 71.0315 52.9861 71.403 49.6786C67.7337 56.3979 60.0101 70.4676 56.5348 75.9603C53.1343 81.3339 51.4774 83.2269 47.8882 83.2275C44.2977 83.2275 42.7226 80.6416 42.6717 76.7497C42.6142 72.5285 45.7852 47.1821 46.8587 38.737C45.1183 42.4616 40.839 51.6056 38.1551 57.0435C35.5587 62.3055 31.204 71.3978 28.0436 76.6357C25.7668 80.4094 23.2092 83.2273 19.4173 83.2275C15.6252 83.2275 13.4847 80.6784 13.4847 76.5788C13.4847 72.4794 14.6716 65.6492 15.9465 57.1777C16.5839 53.0781 17.3108 48.6133 18.1315 43.8761C18.7324 40.448 19.7764 34.4169 20.4183 30.7129C17.502 35.2539 12.2536 43.4278 10.6567 45.8903C8.88113 48.6291 7.28747 50.626 4.64681 50.6266C1.7329 50.6266 0.000532901 48.3522 0 45.7113C0 43.0703 1.34323 41.0344 3.52376 37.4512C6.32403 32.8465 11.3578 26.57 14.1154 23.2747C17.3656 19.3912 20.6139 16.1219 24.6257 16.1214Z';
const INSTINCT_D =
  'M18.5709 31.4316V8.10527C18.5709 5.60045 18.1519 3.8784 17 2H23.5458C22.3938 3.93067 21.9748 5.60059 21.9748 8.10542V31.4318C21.9748 33.9366 22.3938 35.6586 23.5458 37.5374H17C18.1519 35.6064 18.5709 33.9364 18.5709 31.4316Z';
const DOTS_D =
  'M2.6 15.35a5.2 5.2 0 1 0 10.4 0a5.2 5.2 0 1 0 -10.4 0ZM11.7 7.35a4.1 4.1 0 1 0 8.2 0a4.1 4.1 0 1 0 -8.2 0ZM15.4 17.75a3 3 0 1 0 6 0a3 3 0 1 0 -6 0Z';

type ConceptMarkId = 'grok-bot' | 'muse' | 'instinct' | 'dots';

const CONCEPT_MARK_PATHS: Record<ConceptMarkId, MarkPaths> = {
  'grok-bot': {
    viewBox: 259,
    fillRule: 'evenodd',
    translate: [15, 15],
    parts: [
      {
        d: [GROK_BOT_HEAD_D, ...GROK_BOT_EYES_D].join(' '),
        tone: 'ink',
        layer: 0,
      },
    ],
  },
  muse: {
    viewBox: 100,
    fillRule: 'nonzero',
    parts: [{ d: MUSE_D, tone: 'brand', layer: 0 }],
  },
  instinct: {
    viewBox: 40,
    fillRule: 'nonzero',
    parts: [{ d: INSTINCT_D, tone: 'ink', layer: 0 }],
  },
  dots: {
    viewBox: 24,
    fillRule: 'nonzero',
    parts: [{ d: DOTS_D, tone: 'ink', layer: 0 }],
  },
};

/** A mark the story can draw: the product's, or a concept's. */
export type StoryMarkId = HarnessMarkId | ConceptMarkId;

/** Every mark the story draws, the product's first, in one registry. */
export const STORY_MARK_PATHS: Record<StoryMarkId, MarkPaths> = {
  ...HARNESS_MARK_PATHS,
  ...CONCEPT_MARK_PATHS,
};

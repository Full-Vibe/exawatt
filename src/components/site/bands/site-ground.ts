import {
  heroBoardTheme,
  HERO_DEFAULT_THEME,
} from '@/components/site/hero-board/hero-board-theme';

/**
 * The page's one ground (ENG-031 W6b).
 *
 * Every band below the board used to paint `bg-black` while the board painted
 * its own resolved canvas, so the page had two nearly-identical grounds with a
 * seam between them, and the document behind them both was the app's light
 * `--background`, which macOS rubber-band overscroll pulled into frame. This
 * is the board's own colour, derived rather than typed, so a palette decision
 * in W7 moves the whole page in one edit.
 *
 * The document-level half of this lives in `globals.css`, where the literal
 * has to be spelled out; `home-theme-stability.test.ts` fails if the two ever
 * disagree.
 */
export const SITE_GROUND = heroBoardTheme(HERO_DEFAULT_THEME).canvas;

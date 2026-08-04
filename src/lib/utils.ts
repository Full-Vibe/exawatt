import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * This project defines its own font-size scale in `@theme` (`text-chrome-label`,
 * `text-reading`, `text-display`, …). tailwind-merge cannot infer that those
 * are sizes rather than colours, so it filed them in the `text-color` group and
 * treated `cn('text-chrome-micro', 'text-hud-text-dim')` as a conflict —
 * silently dropping whichever came first. That produced text rendering at the
 * inherited size wherever a size and a colour met in one `cn` call, found while
 * building the ENG-016 D49 launcher. Declaring the scale is the framework's own
 * fix for a custom theme, not a workaround around it.
 */
const EXAWATT_FONT_SIZES = [
  'chrome-nano',
  'chrome-micro',
  'chrome-meta',
  'chrome-label',
  'chrome-title',
  'reading',
  'surface-title',
  'display',
];

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: EXAWATT_FONT_SIZES }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

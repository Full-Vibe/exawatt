/**
 * ⌘K ranking filter (ENG-016).
 *
 * cmdk's default `command-score` filter returns 0.99 for ANY value that
 * begins with the query, then breaks ties by DOM order — so a Session title
 * prefix and a Navigation row's own name tie, and the Sessions group (earlier
 * in the DOM) always wins. Typing "usage" therefore ranked a fuzzy Session
 * above the Usage nav row, and "go to usage" (not an ordered subsequence of
 * any value) returned nothing.
 *
 * The fix is structural score bands ABOVE cmdk's fuzzy range (0..1]:
 *
 *   exact-name (8) > name-prefix (7) > word-in-name (6) > keyword (5)
 *     > cmdk defaultFilter fallback (0..1]
 *
 * Every palette row's `value` is its primary display name plus a unique
 * suffix behind an invisible separator (cmdk requires unique values), with
 * auxiliary search terms moved to cmdk's `keywords` prop. Session-name
 * prefixes score in the SAME band as nav-name prefixes on purpose: within a
 * band cmdk falls back to DOM precedence, so session switching — ⌘K's
 * primary daily use — keeps winning its own queries.
 *
 * "go to X" / "go X" phrasings are re-scored with the verb stripped, a hair
 * below what the bare query would earn, so "go to usage" finds Usage without
 * ever outranking a literal match of the raw query.
 *
 * These bands only decide ranking WITHIN a group. cmdk orders the groups
 * themselves by each group's best item score, and that ordering is only as
 * good as its bookkeeping: it used to go arbitrary the moment any row
 * unmounted (FIX-007). Fixed in `patches/cmdk.patch`, pinned by
 * `src/components/ui/command-group-order.test.tsx`. There is deliberately no
 * second, React-side group sort here — one owner, or the two fight over the
 * same DOM nodes.
 */
import { defaultFilter } from 'cmdk';

/** Invisible separator (U+2063) between a row's display name and its unique
 *  suffix. Never typed by a user, valid in a DOM attribute, invisible if a
 *  value ever leaks into UI. */
export const PALETTE_VALUE_SEPARATOR = '\u2063';

/** Build a palette row value: primary display name + unique suffix. */
export function paletteValue(name: string, uniqueSuffix: string): string {
  return `${name}${PALETTE_VALUE_SEPARATOR}${uniqueSuffix}`;
}

/** Structural bands — all above defaultFilter's (0..1] fuzzy range. */
export const PALETTE_SCORE = {
  exactName: 8,
  namePrefix: 7,
  wordInName: 6,
  keyword: 5,
} as const;

/** "go usage" / "go to usage" — strip the verb and re-score the rest. */
const GO_PREFIX = /^go(?:\s+to)?\s+/i;
/** A hair: keeps the stripped interpretation inside its band but below any
 *  row the RAW query earns the same band for. */
const GO_PENALTY = 0.01;

/** True when `query` appears in `text` starting at a word boundary. */
function atWordBoundary(text: string, query: string): boolean {
  let idx = text.indexOf(query);
  while (idx !== -1) {
    if (idx === 0 || !/[a-z0-9]/i.test(text.charAt(idx - 1))) return true;
    idx = text.indexOf(query, idx + 1);
  }
  return false;
}

function bandScore(
  value: string,
  search: string,
  keywords: string[] | undefined
): number {
  const query = search.trim().toLowerCase();
  if (!query) return 1;
  const name = value
    .split(PALETTE_VALUE_SEPARATOR, 1)[0]
    .trim()
    .toLowerCase();
  if (name === query) return PALETTE_SCORE.exactName;
  if (name.startsWith(query)) return PALETTE_SCORE.namePrefix;
  if (atWordBoundary(name, query)) return PALETTE_SCORE.wordInName;
  if (
    keywords?.some(k => {
      const keyword = k.trim().toLowerCase();
      return keyword === query || atWordBoundary(keyword, query);
    })
  ) {
    return PALETTE_SCORE.keyword;
  }
  // Fuzzy fallback: cmdk's own scorer, unchanged, over value + keywords.
  return defaultFilter(value, search, keywords);
}

/** Custom cmdk `filter` for the command palette root. */
export function paletteFilter(
  value: string,
  search: string,
  keywords?: string[]
): number {
  const direct = bandScore(value, search, keywords);
  const raw = search.trimStart();
  const stripped = raw.replace(GO_PREFIX, '');
  if (stripped === raw || !stripped.trim()) return direct;
  const goScore = bandScore(value, stripped, keywords);
  if (goScore <= 0) return direct;
  // A hair below the raw query; halve instead of subtract inside the fuzzy
  // band so a small fallback score cannot be pushed to zero.
  const adjusted =
    goScore > GO_PENALTY * 2 ? goScore - GO_PENALTY : goScore / 2;
  return Math.max(direct, adjusted);
}

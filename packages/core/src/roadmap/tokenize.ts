import {
  isLineTerminatorChar,
  isWhitespaceChar,
  trimTrailingRun,
} from '../text/runs';

/**
 * The roadmap convention's line grammar, read in one pass per line (BUG-128).
 *
 * The parser runs on every repository a user opens, so a roadmap line is
 * untrusted input. The regexes this replaces (`^##\s+(.+?)\s*$` and its
 * kin) backtrack quadratically on a long run of spaces that ends short of
 * the line's end, and CodeQL reported fourteen of them. Each reader below
 * walks its line forward once and returns exactly what the regex captured,
 * edge cases included, so a roadmap parses the same as it always has.
 *
 * Semantics kept from the regexes: whitespace is a regex `\s`
 * ({@link isWhitespaceChar}); a captured span refuses a line terminator,
 * as `.` does; keyword prefixes match ASCII letters without case, as `/i`
 * does in a non-Unicode regex.
 */

export type RoadmapLabel = 'scope' | 'exitCriteria' | 'milestones' | 'docPaths';

type RoadmapLineToken =
  /** `## Heading`: a queue section, or prose the parser does not queue. */
  | { kind: 'section'; heading: string }
  /** `### Heading`: an item inside the current section. */
  | { kind: 'item'; heading: string }
  | { kind: 'blank' }
  /** `Status: note`. `text` is the trimmed line, for a second Status line. */
  | { kind: 'status'; text: string; note: string }
  /** `Scope:`, `Exit criteria:`, `Milestones:` or `Project doc:` alone. */
  | { kind: 'label'; text: string; label: RoadmapLabel }
  /** `- bullet` or `* bullet`. */
  | { kind: 'bullet'; text: string; bullet: string }
  | { kind: 'prose'; text: string };

const LABELS: ReadonlyArray<readonly [string, RoadmapLabel]> = [
  ['scope:', 'scope'],
  ['exit criteria:', 'exitCriteria'],
  ['milestones:', 'milestones'],
  ['project doc:', 'docPaths'],
];

const DONE_MARKERS = ['landed', 'shipped'];
const RETIRED_MARKERS = ['rescoped', 'retired', 'dropped', 'superseded', 'cut'];

function isAsciiUpper(char: string | undefined): boolean {
  return char !== undefined && char >= 'A' && char <= 'Z';
}

function isAsciiDigit(char: string | undefined): boolean {
  return char !== undefined && char >= '0' && char <= '9';
}

/** A regex word character: `[A-Za-z0-9_]`, what `\b` divides. */
function isWordChar(char: string | undefined): boolean {
  if (char === undefined) return false;
  return (
    isAsciiDigit(char) ||
    char === '_' ||
    (char >= 'a' && char <= 'z') ||
    isAsciiUpper(char)
  );
}

/** `text` starts at `at` with `lowerAscii`, ASCII letters compared caseless. */
function startsWithCaseless(text: string, lowerAscii: string, at = 0): boolean {
  if (text.length - at < lowerAscii.length) return false;
  for (let i = 0; i < lowerAscii.length; i++) {
    const code = text.charCodeAt(at + i);
    const folded = code >= 0x41 && code <= 0x5a ? code + 0x20 : code;
    if (folded !== lowerAscii.charCodeAt(i)) return false;
  }
  return true;
}

function skipWhitespace(text: string, from: number): number {
  let at = from;
  while (at < text.length && isWhitespaceChar(text[at])) at++;
  return at;
}

function lastLineTerminator(text: string, from: number): number {
  for (let at = text.length - 1; at >= from; at--) {
    if (isLineTerminatorChar(text[at])) return at;
  }
  return -1;
}

/**
 * `\s{min,}(.+)$` read at `from`: the whitespace run, then the rest of the
 * text, which must be non-empty and hold no line terminator. Backtracking
 * would hand the run's last characters to the capture when nothing follows
 * it, so the capture starts at the latest point that leaves it valid.
 */
function restAfterWhitespace(
  text: string,
  from: number,
  min: 0 | 1
): string | null {
  const runEnd = skipWhitespace(text, from);
  const start = Math.min(runEnd, text.length - 1);
  if (start < from + min) return null;
  if (start <= lastLineTerminator(text, start)) return null;
  return text.slice(start);
}

/**
 * `^<marker>\s+(.+?)\s*$`: a Markdown heading's text. The lazy capture ends
 * at the last non-whitespace character. When only whitespace follows the
 * marker the capture is one whitespace character, the last one a `.` can
 * match, which keeps `##` followed by two spaces a section heading with a
 * blank name, as the regex read it.
 */
function headingText(line: string, markerLength: number): string | null {
  const runEnd = skipWhitespace(line, markerLength);
  if (runEnd === markerLength) return null;
  if (runEnd < line.length) {
    let end = line.length;
    while (isWhitespaceChar(line[end - 1])) end--;
    for (let at = runEnd; at < end; at++) {
      if (isLineTerminatorChar(line[at])) return null;
    }
    return line.slice(runEnd, end);
  }
  for (let at = line.length - 1; at > markerLength; at--) {
    if (!isLineTerminatorChar(line[at])) return line[at];
  }
  return null;
}

/** Classifies one roadmap line (trailing `\r` already removed). */
export function tokenizeRoadmapLine(line: string): RoadmapLineToken {
  if (line.startsWith('##') && !line.startsWith('###')) {
    const heading = headingText(line, 2);
    if (heading !== null) return { kind: 'section', heading };
  } else if (line.startsWith('###') && !line.startsWith('####')) {
    const heading = headingText(line, 3);
    if (heading !== null) return { kind: 'item', heading };
  }

  const text = line.trim();
  if (text === '') return { kind: 'blank' };

  if (startsWithCaseless(text, 'status:')) {
    const note = restAfterWhitespace(text, 'status:'.length, 0);
    if (note !== null) return { kind: 'status', text, note };
  }

  for (const [spelling, label] of LABELS) {
    if (text.length === spelling.length && startsWithCaseless(text, spelling)) {
      return { kind: 'label', text, label };
    }
  }

  if (text[0] === '-' || text[0] === '*') {
    const bullet = restAfterWhitespace(text, 1, 1);
    if (bullet !== null) return { kind: 'bullet', text, bullet };
  }

  return { kind: 'prose', text };
}

/** End of a leading `[A-Z][A-Z0-9]*-\d+`, or -1 when `text` has none. */
function itemIdEnd(text: string): number {
  if (!isAsciiUpper(text[0])) return -1;
  let at = 1;
  while (isAsciiUpper(text[at]) || isAsciiDigit(text[at])) at++;
  if (text[at] !== '-' || !isAsciiDigit(text[at + 1])) return -1;
  at += 2;
  while (isAsciiDigit(text[at])) at++;
  return at;
}

/** `ENG-016 Daily driver` → `{ id: 'ENG-016', title: 'Daily driver' }`. */
export function splitItemHeading(
  heading: string
): { id: string; title: string } | null {
  const end = itemIdEnd(heading);
  if (end < 0) return null;
  const title = restAfterWhitespace(heading, end, 1);
  return title === null ? null : { id: heading.slice(0, end), title };
}

/** The heading opens with an item id (`APP-018…`) followed by a word break. */
export function startsWithItemId(heading: string): boolean {
  const end = itemIdEnd(heading);
  return end >= 0 && !isWordChar(heading[end]);
}

/** The whole text is one item id, as a backlog record's owner must be. */
export function isItemId(text: string): boolean {
  return itemIdEnd(text) === text.length;
}

/**
 * A Status note's position word: up to the first whitespace, without
 * trailing `.,;:`, lower-cased. `done.` and `Done,` both read `done`.
 */
export function statusWord(note: string): string {
  let end = 0;
  while (end < note.length && !isWhitespaceChar(note[end])) end++;
  return trimTrailingRun(note.slice(0, end), '.,;:').toLowerCase();
}

/** Length of a leading `[ ] `, `[x] ` or `[X] ` checkbox, and its state. */
export function milestoneCheckbox(
  text: string
): { done: boolean; length: number } | null {
  if (text[0] !== '[' || text[2] !== ']') return null;
  const mark = text[1];
  if (mark !== ' ' && mark !== 'x' && mark !== 'X') return null;
  const end = skipWhitespace(text, 3);
  return end === 3 ? null : { done: mark !== ' ', length: end };
}

/**
 * `\(word[^)]*\)` anywhere, ASCII caseless: an opening parenthesis followed
 * by one of `words`, closed somewhere after it.
 */
function hasParenthesizedMarker(text: string, words: readonly string[]) {
  const close = text.lastIndexOf(')');
  for (
    let open = text.indexOf('(');
    open >= 0 && open < close;
    open = text.indexOf('(', open + 1)
  ) {
    for (const word of words) {
      if (
        open + word.length < close &&
        startsWithCaseless(text, word, open + 1)
      )
        return true;
    }
  }
  return false;
}

/** `(landed 2026-07-10)` or `(shipped …)` marks a milestone done. */
export function hasDoneMarker(text: string): boolean {
  return hasParenthesizedMarker(text, DONE_MARKERS);
}

/** `(rescoped …)`, `(retired)`, `(dropped …)`, `(superseded …)`, `(cut)`. */
export function hasRetiredMarker(text: string): boolean {
  return hasParenthesizedMarker(text, RETIRED_MARKERS);
}

/**
 * A leading milestone id, `[A-Z]{1,4}\d+(\.\d+)*` ending at a word break,
 * and the length through the `[\s:]*` that follows it. A dotted tail that
 * runs into a word (`D1.2x`) gives back its last segment, as the regex did.
 */
export function milestoneId(
  text: string
): { id: string; length: number } | null {
  let at = 0;
  while (at < text.length && isAsciiUpper(text[at])) at++;
  if (at < 1 || at > 4 || !isAsciiDigit(text[at])) return null;
  while (isAsciiDigit(text[at])) at++;
  let lastSegmentStart = -1;
  while (text[at] === '.' && isAsciiDigit(text[at + 1])) {
    lastSegmentStart = at;
    at += 2;
    while (isAsciiDigit(text[at])) at++;
  }
  if (isWordChar(text[at])) {
    if (lastSegmentStart < 0) return null;
    at = lastSegmentStart;
  }
  let length = at;
  while (
    length < text.length &&
    (text[length] === ':' || isWhitespaceChar(text[length]))
  ) {
    length++;
  }
  return { id: text.slice(0, at), length };
}

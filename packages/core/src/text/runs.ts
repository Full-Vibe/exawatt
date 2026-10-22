/**
 * Linear-time reads of character runs (BUG-128).
 *
 * `text.replace(/[set]+$/, '')` looks linear and is not: the regex is tried
 * at every start position, and each attempt walks the run to its end, so a
 * long run that stops short of the end costs time quadratic in its length.
 * Every input here can come from a file or a process the user does not
 * control (a roadmap line, a session's cwd, a harness id), so these helpers
 * walk the string once from the edge instead.
 *
 * A character set is either a string of literal characters or a predicate
 * over one UTF-16 code unit, which is what a non-Unicode regex class matches.
 */
type CharSet = string | ((char: string) => boolean);

function membership(set: CharSet): (char: string) => boolean {
  return typeof set === 'string' ? char => set.includes(char) : set;
}

/** `text` without the run of `set` characters at its end. */
export function trimTrailingRun(text: string, set: CharSet): string {
  const isMember = membership(set);
  let end = text.length;
  while (end > 0 && isMember(text[end - 1])) end--;
  return end === text.length ? text : text.slice(0, end);
}

/** `text` without the runs of `set` characters at its start and its end. */
export function trimEdgeRuns(text: string, set: CharSet): string {
  const isMember = membership(set);
  let start = 0;
  while (start < text.length && isMember(text[start])) start++;
  let end = text.length;
  while (end > start && isMember(text[end - 1])) end--;
  return start === 0 && end === text.length ? text : text.slice(start, end);
}

/**
 * What a regex `\s` matches: ECMAScript WhiteSpace plus LineTerminator, the
 * same set `String.prototype.trim` removes.
 */
export function isWhitespaceChar(char: string): boolean {
  const code = char.charCodeAt(0);
  if (code <= 0x20) return code === 0x20 || (code >= 0x09 && code <= 0x0d);
  if (code < 0xa0) return false;
  return (
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

/** The characters a regex `.` refuses without the `s` flag. */
export function isLineTerminatorChar(char: string): boolean {
  return (
    char === '\n' || char === '\r' || char === '\u2028' || char === '\u2029'
  );
}

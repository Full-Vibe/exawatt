/**
 * The ONE thing the terminal knows about actionable targets (BUG-004).
 *
 * Every way an operator can reach a link in a Session — hovering plain text,
 * left-clicking an OSC 8 hyperlink an Agent emitted, or right-clicking for a
 * menu — resolves through this module. Before it existed the pane had four
 * independent owners of "what is a link and what happens to it":
 *
 *   1. xterm's built-in OSC 8 provider, whose UNCONFIGURED default pops
 *      `confirm('Do you want to navigate to …')` and then calls
 *      `window.open()`, which Electron's `setWindowOpenHandler` denies — the
 *      operator's exact report: the dialog appears and OK does nothing;
 *   2. the same provider's http-only filter, which silently DROPS every
 *      `file://` hyperlink, the dominant kind in an Agent's own output;
 *   3. `WebLinksAddon`, which recognised URLs and nothing else;
 *   4. an ad-hoc path regex that could not see wrapped lines and rejected
 *      bare repo-relative paths.
 *
 * Recognition is deliberately separate from the xterm buffer (see
 * `terminal-link-provider.ts`) and from the act of opening (see the pane), so
 * the vocabulary can be unit-tested against real Agent output.
 */

export type TerminalTarget =
  | { kind: 'url'; text: string; url: string }
  | {
      kind: 'path';
      text: string;
      path: string;
      line?: number;
      column?: number;
    };

export interface TerminalTargetMatch {
  target: TerminalTarget;
  /** 0-based index of the first character in the supplied line */
  start: number;
  /** 0-based index ONE PAST the last character */
  end: number;
}

/** Characters that commonly open a quotation or bracket before a target. */
const OPENERS = new Set(['(', '[', '{', '<', '"', "'", '`', '«', '“', '‘']);
/** Characters that commonly close or punctuate AFTER a target. */
const CLOSERS = new Set([
  '.',
  ',',
  ';',
  ':',
  '!',
  '?',
  ')',
  ']',
  '}',
  '>',
  '"',
  "'",
  '`',
  '»',
  '”',
  '’',
]);

const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//;
const LOCATION_SUFFIX = /^(.*?):(\d+)(?::(\d+))?$/;
/** last path segment carries a file extension, e.g. `foo.tsx` */
const HAS_EXTENSION = /\.[A-Za-z0-9]{1,10}$/;
/** conservative path alphabet — anything else is prose, not a target */
const PATH_SAFE = /^[\w~@.+#%,/\\-]+$/;

/**
 * Recognise every actionable target in ONE logical line of terminal text.
 *
 * The caller supplies a line that has already been unwrapped, so a path or
 * URL split across two rows by the terminal's own wrapping is recognised as
 * the single target the operator sees.
 */
export function findTerminalTargets(line: string): TerminalTargetMatch[] {
  const matches: TerminalTargetMatch[] = [];
  const runs = /\S+/g;
  let run: RegExpExecArray | null;
  while ((run = runs.exec(line)) !== null) {
    const runStart = run.index;
    let text = run[0];
    let start = runStart;

    // strip openers the writer put in front of the target
    while (text.length > 0 && OPENERS.has(text[0]!)) {
      text = text.slice(1);
      start += 1;
    }
    // strip sentence punctuation the writer put after it, keeping a closing
    // bracket that the target itself opened
    while (text.length > 0 && CLOSERS.has(text[text.length - 1]!)) {
      const last = text[text.length - 1]!;
      if (last === ')' && countChar(text, '(') >= countChar(text, ')')) break;
      if (last === ']' && countChar(text, '[') >= countChar(text, ']')) break;
      text = text.slice(0, -1);
    }
    if (!text) continue;

    const target = classifyTerminalToken(text);
    if (!target) continue;
    matches.push({ target, start, end: start + text.length });
  }
  return matches;
}

function countChar(value: string, char: string): number {
  let total = 0;
  for (const c of value) if (c === char) total += 1;
  return total;
}

/**
 * Classify a single already-trimmed token. Exported for the URI path below
 * and for tests; callers that have terminal text want `findTerminalTargets`.
 */
export function classifyTerminalToken(text: string): TerminalTarget | null {
  const scheme = text.match(SCHEME);
  if (scheme) return targetFromAbsoluteUri(text, scheme[1]!.toLowerCase());
  if (text.includes('://')) return null;
  return pathTarget(text);
}

function targetFromAbsoluteUri(
  text: string,
  scheme: string
): TerminalTarget | null {
  if (scheme === 'http' || scheme === 'https') {
    try {
      const url = new URL(text);
      if (!url.hostname) return null;
      return { kind: 'url', text, url: url.toString() };
    } catch {
      return null;
    }
  }
  if (scheme === 'file') {
    try {
      const url = new URL(text);
      const path = decodeURIComponent(url.pathname);
      if (!path.startsWith('/')) return null;
      // Agents cite a location as `#L12` or `#L12,4`
      const location = url.hash.match(/^#L(\d+)(?:[,:](\d+))?$/);
      return {
        kind: 'path',
        text: path,
        path,
        ...(location?.[1] ? { line: Number(location[1]) } : {}),
        ...(location?.[2] ? { column: Number(location[2]) } : {}),
      };
    } catch {
      return null;
    }
  }
  return null;
}

function pathTarget(text: string): TerminalTarget | null {
  if (text.startsWith('//')) return null;

  // The `:line[:column]` suffix is location, not path — strip it BEFORE
  // deciding whether the remainder is a path at all.
  const location = text.match(LOCATION_SUFFIX);
  const path = location?.[1] ?? text;
  const line = location?.[2] ? Number(location[2]) : undefined;
  const column = location?.[3] ? Number(location[3]) : undefined;
  if (!path || path.startsWith('//')) return null;
  if (!PATH_SAFE.test(path)) return null;

  const anchored =
    path.startsWith('/') || path.startsWith('~/') || /^\.{1,2}\//.test(path);
  if (!anchored) {
    // A bare repo-relative path is the form Agents print most often
    // (`src/components/workspace/terminal-pane.tsx:186`). Admit it only when
    // it cannot be mistaken for prose (`and/or`), a ratio (`24/7`), or a
    // bare host (`example.com/docs`).
    if (!path.includes('/')) return null;
    const segments = path.split('/');
    if (segments.some(segment => segment.length === 0)) return null;
    if (segments[0]!.includes('.')) return null;
    if (!HAS_EXTENSION.test(segments[segments.length - 1]!) && line === undefined)
      return null;
  }
  if (path === '/' || path === '~/') return null;

  return {
    kind: 'path',
    text,
    path,
    ...(line !== undefined ? { line } : {}),
    ...(column !== undefined ? { column } : {}),
  };
}

/**
 * Normalise an OSC 8 hyperlink URI into the SAME vocabulary as recognised
 * text, so a hyperlink and a printed path are opened by one code path.
 * Returns null for schemes Exawatt will not act on.
 */
export function terminalTargetFromUri(uri: string): TerminalTarget | null {
  const scheme = uri.match(SCHEME);
  if (!scheme) return null;
  return targetFromAbsoluteUri(uri, scheme[1]!.toLowerCase());
}

/** What the operator sees named in a menu item or a failure notice. */
export function terminalTargetLabel(target: TerminalTarget): string {
  if (target.kind === 'url') return target.url;
  return target.line ? `${target.path}:${target.line}` : target.path;
}

/** What lands on the clipboard when the operator copies this target. */
export function terminalTargetCopyText(target: TerminalTarget): string {
  return target.kind === 'url' ? target.url : terminalTargetLabel(target);
}

/** Menu verb for copying — link and path are different nouns to an operator. */
export function terminalTargetCopyVerb(target: TerminalTarget): string {
  return target.kind === 'url' ? 'Copy Link' : 'Copy Path';
}

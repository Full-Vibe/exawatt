import { readFileSync, statSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';

/**
 * One read of a configuration or credential file that another program owns:
 * a harness's settings, an OpenClaw configuration, a secret beside it.
 *
 * Three answers, never two. `missing` is a fact (nothing is configured, and
 * the owning program would say the same). `unreadable` is the absence of a
 * fact: the file is there and Exawatt could not learn what it says, so no
 * caller may report it as "nothing configured", "signed out" or "no models"
 * (BUG-242, BUG-245). A reader that folds `unreadable` into `missing` returns
 * the same value for a failed read as for an empty one, which is how a
 * permission error or a half-saved file became "Sign-in required".
 */
export type ConfigFileRead<T> =
  | { status: 'missing' }
  | { status: 'unreadable'; cause: ConfigFileUnreadableCause }
  | { status: 'ok'; value: T };

/**
 * Why a present file could not be read. It never carries the parser's
 * message: `JSON.parse` quotes the text around an error, and some of these
 * files hold credentials.
 */
export type ConfigFileUnreadableCause =
  /** The operating system refused or failed the read (`EACCES`, `EIO`...). */
  | { kind: 'io'; code: string }
  /** A directory, device or pipe where a file belongs. */
  | { kind: 'not-a-file' }
  /** Larger than anything the owning program writes there. */
  | { kind: 'too-large'; limitBytes: number }
  /** Read fine, and the owning program's own grammar rejects it. */
  | { kind: 'rejected'; grammar: string };

/**
 * How the owning program reads the file. `parse` returns null, or throws, for
 * text that program would reject; it must be exactly as tolerant as the
 * program is, no stricter (a valid file reported broken) and no looser (a
 * broken file reported as configuration the program never runs with).
 */
export interface ConfigFileGrammar<T> {
  /** Named in the unreadable cause, for example "JSON" or "TOML". */
  name: string;
  parse(text: string): T | null;
  /** Refused before a byte is read. Defaults to 4 MiB. */
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

/**
 * A path that cannot exist is missing: `ENOENT`, or `ENOTDIR` when a parent
 * component is a file, which is how a project with no `.claude` directory but
 * a `.claude` file reads to Claude Code as well.
 */
function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function ioFailure<T>(error: unknown): ConfigFileRead<T> {
  if (isMissing(error)) return { status: 'missing' };
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return {
    status: 'unreadable',
    cause: { kind: 'io', code: typeof code === 'string' ? code : 'unknown' },
  };
}

function parsed<T>(
  text: string,
  grammar: ConfigFileGrammar<T>
): ConfigFileRead<T> {
  let value: T | null;
  try {
    value = grammar.parse(text);
  } catch {
    value = null;
  }
  return value === null
    ? {
        status: 'unreadable',
        cause: { kind: 'rejected', grammar: grammar.name },
      }
    : { status: 'ok', value };
}

function shapeFailure<T>(
  stats: { isFile(): boolean; size: number },
  limitBytes: number
): ConfigFileRead<T> | null {
  if (!stats.isFile())
    return { status: 'unreadable', cause: { kind: 'not-a-file' } };
  if (stats.size > limitBytes) {
    return { status: 'unreadable', cause: { kind: 'too-large', limitBytes } };
  }
  return null;
}

/**
 * The file checked before it is opened: `isFile` refuses a pipe or device,
 * whose read would never end, and the size bound refuses anything larger
 * than the owning program writes there.
 */
export function readConfigFileSync<T>(
  file: string,
  grammar: ConfigFileGrammar<T>
): ConfigFileRead<T> {
  const limit = grammar.maxBytes ?? DEFAULT_MAX_BYTES;
  let text: string;
  try {
    const refused = shapeFailure<T>(statSync(file), limit);
    if (refused) return refused;
    text = readFileSync(file, 'utf8');
  } catch (error) {
    return ioFailure(error);
  }
  return parsed(text, grammar);
}

export async function readConfigFile<T>(
  file: string,
  grammar: ConfigFileGrammar<T>
): Promise<ConfigFileRead<T>> {
  const limit = grammar.maxBytes ?? DEFAULT_MAX_BYTES;
  let text: string;
  try {
    const refused = shapeFailure<T>(await stat(file), limit);
    if (refused) return refused;
    text = await readFile(file, 'utf8');
  } catch (error) {
    return ioFailure(error);
  }
  return parsed(text, grammar);
}

/** The cause in a few words an operator can act on. Never the file's text. */
export function describeUnreadableConfig(
  cause: ConfigFileUnreadableCause
): string {
  switch (cause.kind) {
    case 'io':
      return cause.code === 'EACCES' || cause.code === 'EPERM'
        ? 'permission denied'
        : `read failed (${cause.code})`;
    case 'not-a-file':
      return 'not a regular file';
    case 'too-large':
      return 'larger than expected';
    case 'rejected':
      return `not valid ${cause.grammar}`;
  }
}

/** Text as a byte-order mark leaves it: the harnesses here all skip one. */
export function withoutByteOrderMark(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** A parsed document that is an object, or null for anything else. */
export function asConfigObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

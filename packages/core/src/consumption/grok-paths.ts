/**
 * Grok Build's on-disk session layout (ENG-003 S4).
 *
 * `<grok home>/sessions/<encoded cwd>/<session uuid>/` with `summary.json`
 * (identity, model, timestamps, counts), `updates.jsonl` (the typed ACP event
 * stream, which is where token usage rides), `signals.json` (turn/tool
 * counters and live context-window occupancy), and `plan.json`.
 *
 * The directory-name encoding is reproduced from the harness's own
 * `xai_grok_config::paths::encode_cwd_dirname`, which has two branches:
 *
 * 1. **Short paths** — the URL-encoded cwd when that is <= 255 bytes (the
 *    APFS/ext4/NTFS component limit). Rust's `urlencoding::encode` percent-
 *    encodes every byte outside the RFC 3986 unreserved set with UPPERCASE
 *    hex, so `/` becomes `%2F` and a space becomes `%20` — never `+`.
 *    `encodeURIComponent` is NOT equivalent: it leaves `!'()*` unescaped.
 * 2. **Long paths** — `{slug}-{blake3_hex16}`, and the harness writes the
 *    original path into a `.cwd` file inside the directory precisely so a
 *    reader can recover it (`decode_cwd_from_dirname` reads it too).
 *
 * Exawatt reproduces branch 1 exactly and resolves branch 2 through the
 * harness's own `.cwd` metadata rather than reimplementing BLAKE3. That is
 * not a shortcut around the rule: `.cwd` is the source's documented recovery
 * path, it cannot drift from the hash the source actually used, and a hash
 * Exawatt recomputed could silently disagree after any upstream change.
 * `encodeGrokCwdDirname` therefore returns `null` for the long case, and
 * callers resolve it by decoding the directories that exist.
 */

/** APFS / ext4 / NTFS single-component limit, and the harness's threshold. */
export const GROK_MAX_DIRNAME_BYTES = 255;

const UNRESERVED = new Set(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
);

/** Rust `urlencoding::encode`: unreserved bytes verbatim, everything else
 *  `%XX` with uppercase hex, over the UTF-8 bytes. */
export function grokUrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let out = '';
  for (const byte of bytes) {
    const char = String.fromCharCode(byte);
    if (byte < 0x80 && UNRESERVED.has(char)) out += char;
    else out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/**
 * The `sessions/<dir>` component for a working directory, or `null` when the
 * harness would have used its slug+hash fallback (encoded form > 255 bytes).
 * A `null` is a real answer — "resolve this by reading the corpus" — not a
 * failure, and never a guess.
 */
export function encodeGrokCwdDirname(cwd: string): string | null {
  const encoded = grokUrlEncode(cwd);
  // Byte length, not code units: the harness compares the encoded byte count,
  // and every byte of a percent-encoded name is ASCII, so length is bytes.
  return encoded.length <= GROK_MAX_DIRNAME_BYTES ? encoded : null;
}

/**
 * Recover the cwd a `sessions/<dir>` component was built from.
 *
 * URL-decoding first (short/legacy names), exactly as the harness does, and
 * the absolute-path shape is what distinguishes the two encodings: a decoded
 * short name always starts with `/` (or a Windows drive letter), and the
 * slug-hash form never does. `readCwdFile` supplies the `.cwd` contents for
 * the long case; omit it to decode only what the name itself carries.
 */
export function decodeGrokCwdDirname(
  dirname: string,
  cwdFileContents?: string | null
): string | null {
  try {
    const decoded = decodeURIComponent(dirname);
    if (decoded.startsWith('/') || /^[A-Za-z]:/.test(decoded)) return decoded;
  } catch {
    // Not a valid percent-encoding — the slug+hash form reaches here too.
  }
  const recovered = cwdFileContents?.trim();
  return recovered ? recovered : null;
}

/** One Grok Build session directory's file names, as the harness writes them. */
export const GROK_SESSION_FILES = {
  summary: 'summary.json',
  updates: 'updates.jsonl',
  signals: 'signals.json',
  plan: 'plan.json',
  /** Written only for the slug+hash directory form. */
  cwd: '.cwd',
} as const;

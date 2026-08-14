import os from 'os';

/**
 * One redaction pass, shared by every diagnostics writer (ENG-025 F5.1).
 *
 * This logic began inside `auth-diagnostics.ts`, which meant `auth.jsonl` was
 * sanitized and the two later JSONL logs written through `diagnostics-log.ts`
 * (`summarizer.jsonl`, `updater.jsonl`) were not. That was only ever safe
 * while nothing read those files off the machine. ENG-025 F5 attaches their
 * tails to a bug report, so redaction moves to write time here: a log is safe
 * on disk before anything decides to send it, rather than being scrubbed by
 * whichever caller remembers to.
 *
 * Home-directory anonymization is new and applies everywhere. `/Users/dan/...`
 * identifies a person; `~/...` answers the same diagnostic question.
 */

const MAX_TEXT_LENGTH = 2_000;
const MAX_DEPTH = 5;
const MAX_ARRAY_ITEMS = 16;

/** Escape a literal for embedding in a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Built once: the home path does not change within a process. */
const HOME_PATTERN = (() => {
  const home = os.homedir();
  // A pathological short or root home would rewrite half the log.
  if (!home || home === '/' || home.length < 4) return null;
  return new RegExp(escapeRegExp(home), 'g');
})();

export function anonymizeHomePath(value: string): string {
  return HOME_PATTERN ? value.replace(HOME_PATTERN, '~') : value;
}

/** Guard against running the sweep over a pathologically large value. Well
 *  above any real log field, and far above every caller's `maxLength`. */
const MAX_SCAN_LENGTH = 64_000;

/**
 * Redact credential-shaped substrings and shorten the result.
 *
 * **Redaction happens before truncation, and the order is load-bearing.** The
 * original auth-only implementation sliced first, which let a secret survive
 * by straddling the cut: the surviving fragment was too short to match the
 * 96-character opaque-run sweep, and a truncated JWT no longer matched the
 * three-segment pattern at all. Slicing first leaked 66 characters of a
 * 150-character token in a direct probe. Everything now goes through a
 * diagnostics bundle that leaves the machine, so the fragment case is not
 * theoretical.
 *
 * Within the sweep, the specific `key=value` forms run before the generic
 * long-token sweep so a matched secret is labeled rather than swallowed as an
 * opaque run.
 */
export function redactDiagnosticText(
  value: string,
  maxLength = MAX_TEXT_LENGTH
): string {
  return anonymizeHomePath(value.slice(0, MAX_SCAN_LENGTH))
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,}]+/gi, '$1[REDACTED]')
    .replace(
      /([?&](?:access_token|refresh_token|token|code|code_verifier)=)[^&\s]+/gi,
      '$1[REDACTED]'
    )
    .replace(
      /(["']?(?:access_token|refresh_token|token|code|code_verifier)["']?\s*[:=]\s*["'])[^"']+/gi,
      '$1[REDACTED]'
    )
    .replace(
      /\b(access_token|refresh_token|token|code|code_verifier)\s*[:=]\s*["']?(?!\[REDACTED\])[^\s,"';}\]]+/gi,
      '$1=[REDACTED]'
    )
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      '[REDACTED_JWT]'
    )
    .replace(/\b[A-Za-z0-9_-]{96,}\b/g, '[REDACTED_LONG_VALUE]')
    .slice(0, maxLength);
}

export function redactDiagnosticValue(
  value: unknown,
  depth = 0,
  maxLength = MAX_TEXT_LENGTH
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactDiagnosticText(value, maxLength);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= MAX_DEPTH) return '[MAX_DEPTH]';
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map(item => redactDiagnosticValue(item, depth + 1, maxLength));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        redactDiagnosticValue(nested, depth + 1, maxLength),
      ])
    );
  }
  return redactDiagnosticText(String(value), maxLength);
}

export function redactDiagnosticFields(
  fields: Record<string, unknown>,
  maxLength = MAX_TEXT_LENGTH
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      redactDiagnosticValue(value, 0, maxLength),
    ])
  );
}

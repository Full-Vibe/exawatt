/**
 * Input the connected-source subsystem did not produce (ENG-010).
 *
 * Two kinds arrive, and they are untrusted for different reasons: a Gateway's
 * payloads and refusal sentences, because a server the operator trusts may
 * still be compromised, downgraded, or simply buggy; and the JSON files this
 * process writes under `userData`, because anything on the machine can edit
 * them between one launch and the next.
 *
 * One owner, because bounding and redaction are exactly the rules that get
 * re-implemented per call site and then diverge in silence. They already had:
 * the Gateway session collapsed a source's own words to one line and stripped
 * control characters before quoting them into operator copy, and the runtime
 * sliced the same untrusted sentence and quoted it raw. Both fed strings a
 * person reads.
 */

/**
 * A Gateway session key is long by design, so this bounds an identifier
 * against a hostile peer rather than describing what a real one looks like.
 */
export const MAX_ID_LENGTH = 4_096;

/** A display name, a version, or one of Exawatt's own sentences. */
export const MAX_TEXT_LENGTH = 512;

/**
 * One quoted refusal, embedded inside a sentence Exawatt wrote. Shorter than
 * `MAX_TEXT_LENGTH` because it is the guest in someone else's sentence: the
 * operator has to be able to read what surrounds it.
 */
export const MAX_SOURCE_SENTENCE_LENGTH = 240;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A string that is present and bounded. Not a validator of meaning: what a
 * native Agent id or a Project id may contain is the caller's rule, and this
 * only refuses what could not be one at all.
 */
export function validText(
  value: unknown,
  max = MAX_TEXT_LENGTH
): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

/**
 * One line, no control characters, bounded.
 *
 * Applied before any untrusted string reaches a log line, a persisted file, or
 * a sentence in front of an operator. A remote peer that answers with a
 * terminal escape or a thousand newlines gets one readable line instead.
 */
function boundedText(value: string, max: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, max);
}

/**
 * A source's own account of a refusal, made safe to quote.
 *
 * Null when the failure carried nothing worth quoting, which is what keeps a
 * caller from printing an empty pair of quotes.
 */
export function sourceSentence(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const collapsed = boundedText(error.message, MAX_SOURCE_SENTENCE_LENGTH);
  return collapsed.length === 0 ? null : collapsed;
}

/**
 * The same words when they ARE the whole answer rather than a quotation, so
 * they carry the longer bound. Falls back to Exawatt's own sentence when the
 * failure said nothing, because "the Gateway did not answer" is more useful to
 * an operator than an empty string.
 */
export function describeSourceError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const collapsed = boundedText(error.message, MAX_TEXT_LENGTH);
  return collapsed.length === 0 ? fallback : collapsed;
}

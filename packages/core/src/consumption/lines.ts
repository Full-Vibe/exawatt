/**
 * JSONL framing that degrades honestly.
 *
 * Harness logs are appended to while Exawatt reads them, and a harness that
 * crashes mid-write leaves a final line with no terminating newline. Splitting
 * on `\n` and parsing every piece would either throw or silently invent a
 * record. `splitCompleteLines` instead returns only lines the writer finished,
 * plus the byte offset those lines end at, so an incremental scanner can resume
 * exactly where the last complete record ended.
 */

export interface LineSplit {
  /** Complete, newline-terminated lines, blanks removed. */
  lines: string[];
  /**
   * Byte length of `text` up to and including the last newline. An incremental
   * reader should advance its watermark by exactly this much.
   */
  consumedBytes: number;
  /** The unterminated remainder, if any. Never parsed. */
  truncatedTail: string | null;
}

const encoder =
  typeof TextEncoder === 'undefined' ? null : new TextEncoder();

function byteLength(value: string): number {
  if (encoder) return encoder.encode(value).length;
  /* c8 ignore next */
  return value.length;
}

export function splitCompleteLines(text: string): LineSplit {
  const lastNewline = text.lastIndexOf('\n');
  if (lastNewline === -1) {
    return {
      lines: [],
      consumedBytes: 0,
      truncatedTail: text.length > 0 ? text : null,
    };
  }
  const complete = text.slice(0, lastNewline + 1);
  const tail = text.slice(lastNewline + 1);
  return {
    lines: complete.split('\n').filter(line => line.trim().length > 0),
    consumedBytes: byteLength(complete),
    truncatedTail: tail.length > 0 ? tail : null,
  };
}

/**
 * Parse one JSONL line into an object, or null. Never throws. A non-object
 * (`null`, a bare number, an array) is treated the same as invalid JSON: the
 * caller counts it as unparsable rather than pretending it was a record.
 */
export function parseJsonObject(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function readString(
  record: Record<string, unknown> | null | undefined,
  key: string
): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function readObject(
  record: Record<string, unknown> | null | undefined,
  key: string
): Record<string, unknown> | null {
  const value = record?.[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Non-negative integer, or 0. Negative and non-finite values become 0. */
export function readCount(
  record: Record<string, unknown> | null | undefined,
  key: string
): number {
  const value = record?.[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.trunc(value);
}

/** Positive integer, or null. Used for optional measures like context window. */
export function readPositiveInt(
  record: Record<string, unknown> | null | undefined,
  key: string
): number | null {
  const value = record?.[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.trunc(value);
}

/** Normalize any recognizable timestamp to ISO 8601, or null. */
export function toIso(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Codex reports `resets_at` in epoch seconds.
    const ms = value > 1e11 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value !== 'string' || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

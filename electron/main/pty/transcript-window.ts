/**
 * A bounded terminal transcript whose append AND replay cost the delta, not
 * the window (ENG-016 BUG-023/BUG-024, incident 0008).
 *
 * The transcript used to be one immutable string, so every trim was a full
 * rebuild: `text.slice(-limit)` on a 4,000,000-char window copies ~8 MB and
 * allocates another ~8 MB, and both the live append path and the journal
 * replay path did exactly that once per unit of new output. On the operator's
 * real disk a single Session's journal holds 10,018 records, every one of them
 * at the retention cap, so resuming it rebuilt the window 10,018 times: ~80 GB
 * of transient copying in one synchronous loop on the Electron main process.
 *
 * The representation here is a deque of chunks with an absolute cursor. New
 * output is pushed; trimming advances a head offset and drops whole chunks, so
 * a trim touches at most one chunk boundary. The joined string is materialised
 * only when a caller genuinely wants the whole transcript (replaying into a
 * pane, rewriting the on-disk snapshot) and is memoised until the next append.
 */

/** What the history store needs of a transcript to persist it incrementally. */
export interface TranscriptSource {
  /** Absolute count of characters ever produced, including trimmed ones. */
  readonly cursor: number;
  /** Characters currently retained. */
  readonly length: number;
  range(fromCursor: number, count: number): string;
  tail(count: number): string;
  text(): string;
}

/**
 * Copy a short string out of whatever it was sliced from.
 *
 * V8 represents `big.slice(-4096)` as a view onto `big`, so keeping a 4 KB
 * continuity tail would pin the whole 4 MB transcript it came from — exactly
 * the megabytes this representation exists to stop holding.
 */
export function detach(value: string): string {
  if (value.length === 0) return '';
  return Buffer.from(value, 'utf16le').toString('utf16le');
}

/** Bound on chunk count: small PTY writes coalesce into the tail chunk. */
const COALESCE_BELOW = 8192;
/** Keep the array from growing without bound as the head advances. */
const COMPACT_AFTER = 64;

export class TranscriptWindow implements TranscriptSource {
  private chunks: string[] = [];
  /** Index of the first live chunk; everything before it has been trimmed. */
  private first = 0;
  /** Characters already dropped from the front of `chunks[first]`. */
  private headOffset = 0;
  private retained = 0;
  private end = 0;
  private joined: string | null = '';
  /**
   * Absolute offset up to which the head region is known to hold no newline.
   * Content never changes once appended and the head only advances, so each
   * trim rescans only the few characters it just exposed.
   */
  private scannedTo = 0;

  /**
   * `Number.POSITIVE_INFINITY` disables self-trimming, which is what journal
   * replay wants: each record states the exact window the writer retained, and
   * reproducing a different one would desynchronise the cursor arithmetic.
   */
  constructor(private readonly limit: number = 4_000_000) {}

  get cursor(): number {
    return this.end;
  }

  get length(): number {
    return this.retained;
  }

  /** Absolute offset of the first retained character. */
  get start(): number {
    return this.end - this.retained;
  }

  reset(): void {
    this.chunks = [];
    this.first = 0;
    this.headOffset = 0;
    this.retained = 0;
    this.end = 0;
    this.joined = '';
    this.scannedTo = 0;
  }

  seed(text: string, cursor = text.length): void {
    this.reset();
    if (text.length > 0) {
      this.chunks = [text];
      this.retained = text.length;
      this.joined = text;
    }
    this.end = Math.max(cursor, this.retained);
    if (this.retained > this.limit) this.trim();
  }

  append(data: string): void {
    if (data.length === 0) return;
    const last = this.chunks.length - 1;
    if (
      last >= this.first &&
      this.chunks[last].length < COALESCE_BELOW &&
      data.length < COALESCE_BELOW
    ) {
      this.chunks[last] += data;
    } else {
      this.chunks.push(data);
    }
    this.retained += data.length;
    this.end += data.length;
    this.joined = null;
    if (this.retained > this.limit) this.trim();
  }

  /**
   * Retain exactly `length` characters, dropping older ones. Journal replay
   * uses this to reproduce the writer's window byte for byte.
   */
  trimTo(length: number): void {
    if (this.retained > length) this.drop(this.retained - length);
  }

  text(): string {
    if (this.joined !== null) return this.joined;
    if (this.first >= this.chunks.length) {
      this.joined = '';
      return this.joined;
    }
    const parts = this.chunks.slice(this.first);
    if (this.headOffset > 0) parts[0] = parts[0].slice(this.headOffset);
    const joined = parts.length === 1 ? parts[0] : parts.join('');
    // Collapse to the single string we just built. Later trims only advance
    // `headOffset` over it, which stays O(1).
    this.chunks = [joined];
    this.first = 0;
    this.headOffset = 0;
    this.joined = joined;
    return joined;
  }

  /** `count` characters starting at an absolute cursor, clamped to retention. */
  range(fromCursor: number, count: number): string {
    if (count <= 0) return '';
    const offset = Math.max(0, fromCursor - this.start);
    if (offset >= this.retained) return '';
    const take = Math.min(count, this.retained - offset);
    if (offset === 0 && take === this.retained) return this.text();
    return this.collect(offset, take);
  }

  /**
   * The last `count` retained characters, detached from the window so a caller
   * can hold on to it without pinning the transcript.
   */
  tail(count: number): string {
    const take = Math.min(count, this.retained);
    if (take <= 0) return '';
    return detach(this.collect(this.retained - take, take));
  }

  /** Output produced after a last-visited checkpoint. */
  since(cursor: number): { text: string; truncated: boolean } {
    if (this.end === 0 || cursor >= this.end) {
      return { text: '', truncated: false };
    }
    return {
      text: this.range(cursor, this.end - Math.max(cursor, this.start)),
      truncated: cursor < this.start,
    };
  }

  private collect(offset: number, count: number): string {
    const parts: string[] = [];
    let skip = offset;
    let remaining = count;
    for (let index = this.first; index < this.chunks.length; index += 1) {
      const chunk = this.chunks[index];
      const from = index === this.first ? this.headOffset : 0;
      const available = chunk.length - from;
      if (skip >= available) {
        skip -= available;
        continue;
      }
      const start = from + skip;
      const take = Math.min(available - skip, remaining);
      parts.push(chunk.slice(start, start + take));
      skip = 0;
      remaining -= take;
      if (remaining <= 0) break;
    }
    return parts.length === 1 ? parts[0] : parts.join('');
  }

  /**
   * Trim to the retention limit, then resync the head to a line boundary: a
   * raw cut can land mid escape sequence or mid surrogate pair, which garbles
   * the top of every replay. The search stays bounded to 4096 characters, so
   * this costs 4 KB instead of the 4 MB the string implementation paid.
   */
  private trim(): void {
    this.drop(this.retained - this.limit);
    // A terminal line is tens of characters, so probe a short region first and
    // widen only if it holds no newline. Combined with `scannedTo`, a trim
    // reads a few hundred characters instead of the 4 MB the string
    // representation rescanned every time.
    for (const budget of [256, 4096]) {
      const width = Math.min(budget, this.retained);
      const from = Math.max(this.start, this.scannedTo);
      const unscanned = this.start + width - from;
      if (unscanned <= 0) continue;
      const offset = from - this.start;
      const newline = this.collect(offset, unscanned).indexOf('\n');
      if (newline !== -1) {
        this.drop(offset + newline + 1);
        this.scannedTo = this.start;
        return;
      }
      this.scannedTo = this.start + width;
    }
  }

  private drop(count: number): void {
    if (count <= 0) return;
    let remaining = count;
    while (remaining > 0 && this.first < this.chunks.length) {
      const available = this.chunks[this.first].length - this.headOffset;
      if (available > remaining) {
        this.headOffset += remaining;
        this.retained -= remaining;
        remaining = 0;
        break;
      }
      this.first += 1;
      this.headOffset = 0;
      this.retained -= available;
      remaining -= available;
    }
    if (this.first >= COMPACT_AFTER) {
      this.chunks = this.chunks.slice(this.first);
      this.first = 0;
    }
    this.joined = null;
  }
}

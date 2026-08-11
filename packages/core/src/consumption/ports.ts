/**
 * The IO seam.
 *
 * Everything above this file is pure: parsers take strings, rollups take
 * samples. This port is the only place a scan touches a filesystem, which keeps
 * the parsers unit-testable against fixtures and lets Demo Mode serve the same
 * adapters from a synthetic corpus.
 *
 * It mirrors the `ConversationCatalogAdapter` seam in
 * `electron/main/pty/conversation-catalog.ts` — same registration shape, same
 * env-var overridable roots, same "harness files rotate, truncate, or disappear
 * while being read" tolerance — rather than inventing a parallel abstraction.
 */
import type {
  ConsumptionSample,
  ConsumptionScanResult,
  ConsumptionSourceId,
  PlanWindow,
} from './types';

export interface ConsumptionFileRef {
  path: string;
  size: number;
  mtimeMs: number;
}

/** Bytes read from a file, plus where the read stopped. */
export interface ConsumptionChunk {
  text: string;
  /** Byte offset the read started at. */
  fromByte: number;
  /** Byte offset just past the last byte read. */
  toByte: number;
}

export interface ConsumptionFileSystem {
  /** Every candidate file under `root`, recursively. Missing root -> []. */
  listFiles(root: string): Promise<ConsumptionFileRef[]>;
  /**
   * Read `path` from `fromByte`, to EOF or for at most `maxBytes` when given.
   * A bounded read may end mid-line or even mid-UTF-8-sequence; callers only
   * ever parse up to the last complete newline, so the boundary damage is
   * confined to the unparsed tail (newline is a single byte in UTF-8 and can
   * never sit inside a multibyte sequence). Implementations may ignore
   * `maxBytes` — the scan loop treats it as a heap bound, not a guarantee.
   * Implementations must not throw for a file that disappeared mid-scan;
   * return null instead.
   */
  readFrom(
    path: string,
    fromByte: number,
    maxBytes?: number
  ): Promise<ConsumptionChunk | null>;
}

/**
 * Structural abort flag — `AbortSignal` satisfies it, and so does a plain
 * `{ aborted: boolean }`, which keeps this module environment-free.
 */
export interface ConsumptionScanAbort {
  readonly aborted: boolean;
}

/** Progress after each file a scan pass finishes with. */
export interface ConsumptionFileProgress {
  source: ConsumptionSourceId;
  path: string;
  /** Files handled so far in this adapter's pass, skipped ones included. */
  filesSeen: number;
  /** Files this adapter's pass will handle in total. */
  filesTotal: number;
  /** Bytes actually read so far in this adapter's pass. */
  bytesRead: number;
}

/**
 * Per-file incremental state. A scanner that persists these can tail-read a
 * growing transcript instead of re-parsing 2 GB of history every launch.
 *
 * `consumedBytes` always lands on a newline boundary, so a resumed read never
 * begins mid-record. `sessionContext` carries the facts a Codex rollout
 * establishes on its first line (cwd, session id, model) which a tail-only read
 * would otherwise never see.
 */
export interface ConsumptionWatermark {
  path: string;
  size: number;
  mtimeMs: number;
  consumedBytes: number;
  sessionContext?: unknown;
}

export type ConsumptionWatermarks = Record<string, ConsumptionWatermark>;

export interface ConsumptionScanOptions {
  /** Previous scan's watermarks. Omit for a cold scan. */
  watermarks?: ConsumptionWatermarks;
  /** Skip files whose mtime is older than this (ms epoch). */
  sinceMs?: number;
  /** Hard cap on files inspected, newest first. 0 or undefined = no cap. */
  maxFiles?: number;
  /**
   * Heap bound for a single read. A file larger than this is parsed in
   * bounded chunks with the partial trailing line carried between reads, so
   * peak heap tracks the chunk size, never the corpus (spine §5). Defaults to
   * `DEFAULT_SCAN_CHUNK_BYTES` when omitted.
   */
  maxChunkBytes?: number;
  /**
   * Cooperative cancellation, checked between chunks and between files. An
   * aborted pass keeps everything it finished: samples already parsed and
   * watermarks for completed files (and completed chunk boundaries) remain
   * valid, so the next pass resumes instead of restarting.
   */
  signal?: ConsumptionScanAbort;
  /**
   * Awaited after each file. This is the backgrounding seam: a caller can
   * push progress and yield the event loop here without the scan owning
   * either policy.
   */
  onFileScanned?: (progress: ConsumptionFileProgress) => void | Promise<void>;
  /**
   * Streaming consumer. When present the adapter hands each file's samples
   * and plan-window observations to the sink AS IT GOES and returns empty
   * `samples` / `planWindows` / `windowObservations` arrays, so a cold scan's
   * peak heap holds one file's parse plus the caller's own merged state —
   * never the whole corpus pre-merge (spine §5). The caller owns the
   * corpus-global idempotency-key merge in this mode.
   */
  sink?: ConsumptionScanSink;
}

export interface ConsumptionScanSink {
  samples(samples: ConsumptionSample[], file: ConsumptionFileRef): void;
  planWindows(windows: PlanWindow[], file: ConsumptionFileRef): void;
  /**
   * Called once per READ file (skipped-unchanged files never fire) with the
   * watermark that covers exactly the bytes whose samples were already handed
   * to `samples`. A persisting caller that appends samples before this mark —
   * in call order — can therefore never record a watermark whose samples were
   * lost, even across a crash mid-append.
   */
  fileScanned?(
    file: ConsumptionFileRef,
    watermark: ConsumptionWatermark
  ): void;
}

export const DEFAULT_SCAN_CHUNK_BYTES = 8 * 1024 * 1024;

export interface ConsumptionSourceScan extends ConsumptionScanResult {
  /** Watermarks to persist for the next incremental scan. */
  watermarks: ConsumptionWatermarks;
  /**
   * Every plan-window observation this pass parsed, in file order and NOT
   * collapsed — `planWindows` keeps only the latest per bucket, which is the
   * capacity truth, but pace needs history (%/h requires two observations
   * spaced in time). Empty for sources that report no windows.
   */
  windowObservations: PlanWindow[];
  /** The pass was aborted via `signal`. Partial results are still valid. */
  aborted: boolean;
}

export interface ConsumptionSourceAdapter {
  readonly source: ConsumptionSourceId;
  /** Root directory this adapter reads. Env-overridable by the constructor. */
  readonly root: string;
  scan(
    fs: ConsumptionFileSystem,
    options?: ConsumptionScanOptions
  ): Promise<ConsumptionSourceScan>;
}

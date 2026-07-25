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
import type { ConsumptionScanResult, ConsumptionSourceId } from './types';

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
   * Read `path` from `fromByte` to EOF. Implementations must not throw for a
   * file that disappeared mid-scan; return null instead.
   */
  readFrom(path: string, fromByte: number): Promise<ConsumptionChunk | null>;
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
}

export interface ConsumptionSourceScan extends ConsumptionScanResult {
  /** Watermarks to persist for the next incremental scan. */
  watermarks: ConsumptionWatermarks;
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

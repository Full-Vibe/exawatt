/**
 * ENG-008 E5 — persisted scan state.
 *
 * The corpus costs 19.3 s / 2.66 GB to read cold (spine §5), so what a scan
 * learns must outlive the process. This store owns the ONLY files the
 * consumption scanner ever writes, both inside its own directory under
 * Electron `userData` — the corpora under `~/.claude` and `~/.codex` are
 * strictly read-only to this feature (spine §7), and the privacy test pins
 * that every write lands under this store's root.
 *
 * Layout (versioned by filename; an unknown version is ignored, never
 * migrated in place):
 *
 * - `log-v1.jsonl` — append-only envelopes: `{k:'sample'}` merged samples,
 *   `{k:'obs'}` plan-window observations, `{k:'mark'}` per-file watermarks.
 *   Appends are ordered samples-before-their-watermark (see
 *   `ConsumptionScanSink.fileScanned`), so a torn tail can lose a watermark —
 *   which only costs a re-read — but can never keep a watermark whose
 *   samples were lost. Duplicate keys across appends are collapsed on load by
 *   the same corpus-global idempotency merge the scan itself uses, which is
 *   what makes append-then-reload idempotent.
 * - `meta-v1.json` — atomic replace (tmp + rename, like every store in this
 *   app): schema version, lastScanAt, firstScanComplete, corpusBytes,
 *   lifetime diagnostics, discarded-degenerate-window count, and compaction
 *   bookkeeping.
 *
 * Compaction rewrites the log from live state when appended bytes exceed
 * about twice the last compacted size — the log's bloat is bounded, and a
 * crash mid-compaction leaves the old log intact (rename is last).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import {
  emptyDiagnostics,
  localLogAssurance,
  mergeSamples,
  type ConsumptionDiagnostics,
  type ConsumptionSample,
  type ConsumptionSourceId,
  type ConsumptionWatermark,
  type ConsumptionWatermarks,
  type PlanWindow,
  type PlanWindowObservation,
} from '@exawatt/core';

const LOG_FILE = 'log-v1.jsonl';
const META_FILE = 'meta-v1.json';
/** Compact when the log exceeds `2 x lastCompactedBytes + slack`. */
const COMPACTION_SLACK_BYTES = 8 * 1024 * 1024;

export interface ConsumptionScanMetaV1 {
  v: 1;
  lastScanAt: string | null;
  firstScanComplete: boolean;
  corpusBytes: number | null;
  discardedDegenerateWindows: number;
  /** Lifetime totals across every pass since this state was created. */
  diagnostics: ConsumptionDiagnostics;
  /**
   * Latest non-degenerate window per bucket (capacity truth). Small (a
   * handful of records), so it rides the atomically-replaced meta rather
   * than the append log.
   */
  planWindows: PlanWindow[];
  /** Sources whose corpus directory held zero files at the last pass. */
  emptySources: ConsumptionSourceId[];
  /** Log size at the last compaction (or first write), for the bloat bound. */
  compactedBytes: number;
}

export interface LoadedConsumptionState {
  meta: ConsumptionScanMetaV1;
  samples: Map<string, ConsumptionSample>;
  watermarks: ConsumptionWatermarks;
  observations: PlanWindowObservation[];
  /** Log lines that failed to parse or validate. Skipped, never fatal. */
  corruptLines: number;
  logBytes: number;
}

export interface ConsumptionAppendBatch {
  /** Post-merge sample values touched by this batch. */
  samples: ConsumptionSample[];
  observations: PlanWindowObservation[];
  /** Watermarks for files whose samples above are complete. */
  marks: ConsumptionWatermark[];
}

type LogEnvelope =
  | { k: 'sample'; v: Omit<ConsumptionSample, 'assurance'> }
  | { k: 'obs'; v: PlanWindowObservation }
  | { k: 'mark'; v: ConsumptionWatermark };

/**
 * A local-log sample's assurance is CONSTANT per source (`localLogAssurance`),
 * so persisting it per sample would spend ~25% of the state file and the load
 * heap restating one fact 100k+ times. It is stripped on write and re-attached
 * as one shared instance per source on load — derivation, not data loss.
 */
const REHYDRATED_ASSURANCE: Record<
  ConsumptionSourceId,
  ConsumptionSample['assurance']
> = {
  'claude-code': localLogAssurance('claude-code'),
  codex: localLogAssurance('codex'),
};

function stripAssurance(
  sample: ConsumptionSample
): Omit<ConsumptionSample, 'assurance'> {
  const { assurance: _assurance, ...rest } = sample;
  return rest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validSample(
  value: unknown
): value is Omit<ConsumptionSample, 'assurance'> {
  if (!isRecord(value)) return false;
  return (
    typeof value.at === 'string' &&
    typeof value.idempotencyKey === 'string' &&
    (value.source === 'claude-code' || value.source === 'codex') &&
    typeof value.providerSessionId === 'string' &&
    isRecord(value.usage)
  );
}

function validMark(value: unknown): value is ConsumptionWatermark {
  if (!isRecord(value)) return false;
  return (
    typeof value.path === 'string' &&
    typeof value.size === 'number' &&
    typeof value.mtimeMs === 'number' &&
    typeof value.consumedBytes === 'number'
  );
}

function validObservation(value: unknown): value is PlanWindowObservation {
  if (!isRecord(value)) return false;
  return (
    (value.source === 'claude-code' || value.source === 'codex') &&
    (value.scope === 'primary' || value.scope === 'secondary') &&
    typeof value.windowMinutes === 'number' &&
    typeof value.usedPercent === 'number' &&
    typeof value.observedAtMs === 'number'
  );
}

export function emptyConsumptionMeta(): ConsumptionScanMetaV1 {
  return {
    v: 1,
    lastScanAt: null,
    firstScanComplete: false,
    corpusBytes: null,
    discardedDegenerateWindows: 0,
    diagnostics: emptyDiagnostics(),
    planWindows: [],
    emptySources: [],
    compactedBytes: 0,
  };
}

function validPlanWindow(value: unknown): value is PlanWindow {
  if (!isRecord(value)) return false;
  return (
    (value.source === 'claude-code' || value.source === 'codex') &&
    (value.scope === 'primary' || value.scope === 'secondary') &&
    typeof value.windowMinutes === 'number' &&
    typeof value.usedPercent === 'number' &&
    typeof value.observedAt === 'string'
  );
}

export class ConsumptionStateStore {
  private operationTail: Promise<void> = Promise.resolve();
  private temporarySequence = 0;
  private appendedBytes = 0;
  private compactedBytes = 0;

  constructor(private readonly dir: string) {}

  get root(): string {
    return this.dir;
  }

  private get logPath(): string {
    return path.join(this.dir, LOG_FILE);
  }

  private get metaPath(): string {
    return path.join(this.dir, META_FILE);
  }

  /**
   * Load persisted state. Returns empty state (meta defaults) when nothing
   * usable exists — a missing directory, an unknown version, or a corrupt
   * meta all mean "scan from scratch", never a crash.
   */
  async load(): Promise<LoadedConsumptionState> {
    const out: LoadedConsumptionState = {
      meta: emptyConsumptionMeta(),
      samples: new Map(),
      watermarks: {},
      observations: [],
      corruptLines: 0,
      logBytes: 0,
    };
    let meta: ConsumptionScanMetaV1 | null = null;
    try {
      const parsed = JSON.parse(
        await fs.promises.readFile(this.metaPath, 'utf8')
      ) as Partial<ConsumptionScanMetaV1>;
      if (parsed.v === 1) {
        meta = {
          ...emptyConsumptionMeta(),
          ...parsed,
          v: 1,
          diagnostics: {
            ...emptyDiagnostics(),
            ...(isRecord(parsed.diagnostics) ? parsed.diagnostics : {}),
          },
          planWindows: Array.isArray(parsed.planWindows)
            ? parsed.planWindows.filter(validPlanWindow)
            : [],
          emptySources: Array.isArray(parsed.emptySources)
            ? parsed.emptySources.filter(
                (value): value is ConsumptionSourceId =>
                  value === 'claude-code' || value === 'codex'
              )
            : [],
        };
      }
    } catch {
      // No meta -> no trusted state. The log alone is not resumed without its
      // meta because firstScanComplete would be unknown.
    }
    if (!meta) return out;
    out.meta = meta;
    this.compactedBytes = meta.compactedBytes;

    let stream: fs.ReadStream;
    try {
      await fs.promises.access(this.logPath);
      stream = fs.createReadStream(this.logPath, { encoding: 'utf8' });
    } catch {
      return out;
    }
    const lines = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });
    const observations: PlanWindowObservation[] = [];
    for await (const line of lines) {
      out.logBytes += Buffer.byteLength(line, 'utf8') + 1;
      if (line.trim().length === 0) continue;
      let envelope: unknown;
      try {
        envelope = JSON.parse(line);
      } catch {
        out.corruptLines += 1;
        continue;
      }
      if (!isRecord(envelope)) {
        out.corruptLines += 1;
        continue;
      }
      const kind = envelope.k;
      const value = envelope.v;
      if (kind === 'sample' && validSample(value)) {
        const sample: ConsumptionSample = {
          ...value,
          assurance: REHYDRATED_ASSURANCE[value.source],
        };
        const existing = out.samples.get(sample.idempotencyKey);
        out.samples.set(
          sample.idempotencyKey,
          existing ? mergeSamples([existing, sample]).samples[0] : sample
        );
      } else if (kind === 'mark' && validMark(value)) {
        // Last write wins per path — later passes append newer marks.
        out.watermarks[value.path] = value;
      } else if (kind === 'obs' && validObservation(value)) {
        observations.push(value);
      } else {
        out.corruptLines += 1;
      }
    }
    out.observations = observations;
    this.appendedBytes = out.logBytes;
    return out;
  }

  /**
   * Append one batch. Envelope order inside the buffer is samples, then
   * observations, then marks — a torn tail therefore always cuts marks
   * before it cuts the samples they certify.
   */
  append(batch: ConsumptionAppendBatch): Promise<void> {
    if (
      batch.samples.length === 0 &&
      batch.observations.length === 0 &&
      batch.marks.length === 0
    ) {
      return this.flush();
    }
    const lines: string[] = [];
    for (const sample of batch.samples) {
      lines.push(
        JSON.stringify({
          k: 'sample',
          v: stripAssurance(sample),
        } as LogEnvelope)
      );
    }
    for (const observation of batch.observations) {
      lines.push(JSON.stringify({ k: 'obs', v: observation } as LogEnvelope));
    }
    for (const mark of batch.marks) {
      lines.push(JSON.stringify({ k: 'mark', v: mark } as LogEnvelope));
    }
    const buffer = lines.join('\n') + '\n';
    this.appendedBytes += Buffer.byteLength(buffer, 'utf8');
    return this.enqueue(async () => {
      await this.ensureDir();
      await fs.promises.appendFile(this.logPath, buffer, {
        encoding: 'utf8',
        mode: 0o600,
      });
    });
  }

  /** Atomic meta replace. */
  writeMeta(meta: ConsumptionScanMetaV1): Promise<void> {
    return this.enqueue(async () => {
      await this.ensureDir();
      await this.atomicReplace(
        this.metaPath,
        JSON.stringify({ ...meta, compactedBytes: this.compactedBytes })
      );
    });
  }

  get shouldCompact(): boolean {
    return (
      this.appendedBytes > this.compactedBytes * 2 + COMPACTION_SLACK_BYTES
    );
  }

  /**
   * Rewrite the log from live state, atomically. The old log stays intact
   * until the rename lands.
   */
  compact(
    samples: Iterable<ConsumptionSample>,
    watermarks: ConsumptionWatermarks,
    observations: readonly PlanWindowObservation[],
    meta: ConsumptionScanMetaV1
  ): Promise<void> {
    return this.enqueue(async () => {
      await this.ensureDir();
      const temporary = `${this.logPath}.tmp-${process.pid}-${++this.temporarySequence}`;
      const stream = fs.createWriteStream(temporary, {
        encoding: 'utf8',
        mode: 0o600,
      });
      let bytes = 0;
      const write = (envelope: LogEnvelope) =>
        new Promise<void>((resolve, reject) => {
          const line = JSON.stringify(envelope) + '\n';
          bytes += Buffer.byteLength(line, 'utf8');
          stream.write(line, error => (error ? reject(error) : resolve()));
        });
      try {
        for (const sample of samples) {
          await write({ k: 'sample', v: stripAssurance(sample) });
        }
        for (const observation of observations) {
          await write({ k: 'obs', v: observation });
        }
        for (const mark of Object.values(watermarks)) {
          await write({ k: 'mark', v: mark });
        }
        await new Promise<void>((resolve, reject) =>
          stream.end((error?: Error | null) =>
            error ? reject(error) : resolve()
          )
        );
        await fs.promises.rename(temporary, this.logPath);
        await fs.promises.chmod(this.logPath, 0o600);
        this.compactedBytes = bytes;
        this.appendedBytes = bytes;
        await this.atomicReplace(
          this.metaPath,
          JSON.stringify({ ...meta, compactedBytes: bytes })
        );
      } finally {
        await fs.promises.rm(temporary, { force: true });
      }
    });
  }

  /** Wait for every queued write to settle. */
  async flush(): Promise<void> {
    await this.operationTail;
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const chained = this.operationTail.then(operation);
    this.operationTail = chained.catch(error => {
      console.error('Consumption state write failed', error);
    });
    return chained;
  }

  private async ensureDir(): Promise<void> {
    await fs.promises.mkdir(this.dir, { recursive: true, mode: 0o700 });
  }

  private async atomicReplace(target: string, content: string): Promise<void> {
    const temporary = `${target}.tmp-${process.pid}-${++this.temporarySequence}`;
    try {
      await fs.promises.writeFile(temporary, content, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await fs.promises.rename(temporary, target);
      await fs.promises.chmod(target, 0o600);
    } finally {
      await fs.promises.rm(temporary, { force: true });
    }
  }
}

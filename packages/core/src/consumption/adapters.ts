/**
 * Source adapters. Discovery + framing + incremental watermarks; all parsing
 * delegates to the pure parsers.
 *
 * Since the E5 scanner: files are read in BOUNDED CHUNKS (`maxChunkBytes`)
 * with the partial trailing line carried between reads, passes are
 * cooperatively cancellable (`signal`), progress is observable
 * (`onFileScanned`), and a caller can stream results out per file (`sink`)
 * instead of accumulating a corpus-sized array. All of that exists because a
 * cold scan of the real corpus reads 2.66 GB (spine §5) and must never hold
 * it — or anything proportional to it — in heap.
 */
import { splitCompleteLines } from './lines';
import { mergeSamples } from './merge';
import { parseClaudeTranscript } from './parse-claude';
import {
  emptyCodexContext,
  latestPlanWindows,
  parseCodexRollout,
  type CodexSessionContext,
} from './parse-codex';
import {
  DEFAULT_SCAN_CHUNK_BYTES,
  type ConsumptionFileRef,
  type ConsumptionFileSystem,
  type ConsumptionScanOptions,
  type ConsumptionSourceAdapter,
  type ConsumptionSourceScan,
  type ConsumptionWatermark,
  type ConsumptionWatermarks,
} from './ports';
import {
  addDiagnostics,
  emptyDiagnostics,
  type ConsumptionDiagnostics,
  type ConsumptionSample,
  type ConsumptionSourceId,
  type PlanWindow,
} from './types';

function selectFiles(
  files: ConsumptionFileRef[],
  options: ConsumptionScanOptions
): ConsumptionFileRef[] {
  // Both harnesses write sidecar files (`sessions-index.json`,
  // `agent-*.meta.json`) into the same trees. Only transcripts are parsed here.
  let selected = files.filter(file => file.path.endsWith('.jsonl'));
  if (options.sinceMs) {
    selected = selected.filter(file => file.mtimeMs >= options.sinceMs!);
  }
  selected = [...selected].sort((left, right) => right.mtimeMs - left.mtimeMs);
  if (options.maxFiles && options.maxFiles > 0) {
    selected = selected.slice(0, options.maxFiles);
  }
  return selected;
}

/**
 * Decide where to resume reading a file.
 *
 * A file that shrank, or whose mtime moved backwards, was rotated or replaced —
 * the old watermark is meaningless and the file is re-read from zero. A file
 * whose size and mtime are unchanged has nothing new and is skipped entirely,
 * which is what makes a warm scan cheap.
 */
function resumePoint(
  file: ConsumptionFileRef,
  watermark: ConsumptionWatermark | undefined
): { fromByte: number; skip: boolean; carry: unknown } {
  if (!watermark) return { fromByte: 0, skip: false, carry: undefined };
  if (file.size < watermark.consumedBytes || file.mtimeMs < watermark.mtimeMs) {
    return { fromByte: 0, skip: false, carry: undefined };
  }
  if (file.size === watermark.size && file.mtimeMs === watermark.mtimeMs) {
    return { fromByte: watermark.consumedBytes, skip: true, carry: watermark.sessionContext };
  }
  return {
    fromByte: watermark.consumedBytes,
    skip: false,
    carry: watermark.sessionContext,
  };
}

interface ChunkedFileRead {
  /** Absolute offset just past the last complete line handled. */
  consumedBytes: number;
  /** Bytes actually read from disk for this file in this pass. */
  bytesRead: number;
  /** The file ends with an unterminated line (crash mid-write). */
  truncatedFinal: boolean;
  /** The pass's abort signal fired while reading this file. */
  aborted: boolean;
  /** The very first read failed — nothing was read at all. */
  unreadable: boolean;
}

/**
 * Read one file from `fromByte` in bounded chunks, handing every batch of
 * COMPLETE lines to `onLines`. The partial line at each chunk boundary is
 * simply re-read from its own start on the next iteration (`consumedBytes`
 * always lands on a newline), so no carry buffer is needed and a resumed or
 * aborted read can only ever land on a record boundary.
 */
async function readCompleteLines(
  fs: ConsumptionFileSystem,
  file: ConsumptionFileRef,
  fromByte: number,
  options: ConsumptionScanOptions,
  onLines: (lines: string[]) => void
): Promise<ChunkedFileRead> {
  let offset = fromByte;
  let bytesRead = 0;
  let chunkBytes = options.maxChunkBytes ?? DEFAULT_SCAN_CHUNK_BYTES;
  for (;;) {
    if (options.signal?.aborted) {
      return {
        consumedBytes: offset,
        bytesRead,
        truncatedFinal: false,
        aborted: true,
        unreadable: false,
      };
    }
    const chunk = await fs.readFrom(file.path, offset, chunkBytes);
    if (!chunk) {
      // Vanished mid-read (rotation): keep what this pass already parsed. It
      // is only "unreadable" if not even the first read succeeded.
      return {
        consumedBytes: offset,
        bytesRead,
        truncatedFinal: false,
        aborted: false,
        unreadable: bytesRead === 0,
      };
    }
    const read = Math.max(0, chunk.toByte - chunk.fromByte);
    bytesRead += read;
    // The listing's recorded size is this pass's snapshot boundary. Appends
    // that landed after the stat belong to the next pass.
    const atEnd = read === 0 || chunk.toByte >= file.size;
    const split = splitCompleteLines(chunk.text);
    if (split.consumedBytes === 0) {
      if (atEnd) {
        return {
          consumedBytes: offset,
          bytesRead,
          truncatedFinal: split.truncatedTail !== null,
          aborted: false,
          unreadable: false,
        };
      }
      // A single line longer than the chunk. Grow and retry so a pathological
      // record degrades throughput, never terminates the loop.
      chunkBytes *= 2;
      continue;
    }
    onLines(split.lines);
    offset += split.consumedBytes;
    if (atEnd) {
      return {
        consumedBytes: offset,
        bytesRead,
        truncatedFinal: split.truncatedTail !== null,
        aborted: false,
        unreadable: false,
      };
    }
  }
}

/**
 * Watermark for a file this pass finished with — or was aborted inside.
 *
 * An aborted file records `size: consumedBytes` (the extent actually covered)
 * rather than the file's real size, so the next pass cannot mistake it for
 * fully-scanned-and-unchanged and skip the unread remainder; it resumes at
 * `consumedBytes` like any other append.
 */
function watermarkFor(
  file: ConsumptionFileRef,
  consumedBytes: number,
  aborted: boolean,
  sessionContext?: unknown
): ConsumptionWatermark {
  return {
    path: file.path,
    size: aborted ? consumedBytes : file.size,
    mtimeMs: file.mtimeMs,
    consumedBytes,
    ...(sessionContext === undefined ? {} : { sessionContext }),
  };
}

interface AdapterPassState {
  diagnostics: ConsumptionDiagnostics;
  rawSamples: ConsumptionSample[];
  rawWindows: PlanWindow[];
  watermarks: ConsumptionWatermarks;
  aborted: boolean;
}

function emptyPass(): AdapterPassState {
  return {
    diagnostics: emptyDiagnostics(),
    rawSamples: [],
    rawWindows: [],
    watermarks: {},
    aborted: false,
  };
}

function emitSamples(
  pass: AdapterPassState,
  options: ConsumptionScanOptions,
  file: ConsumptionFileRef,
  samples: ConsumptionSample[]
): void {
  if (samples.length === 0) return;
  if (options.sink) options.sink.samples(samples, file);
  else pass.rawSamples.push(...samples);
}

function emitWindows(
  pass: AdapterPassState,
  options: ConsumptionScanOptions,
  file: ConsumptionFileRef,
  windows: PlanWindow[]
): void {
  if (windows.length === 0) return;
  if (options.sink) options.sink.planWindows(windows, file);
  else pass.rawWindows.push(...windows);
}

/** Keep the previous pass's watermarks for files this pass never reached. */
function carryUnreached(
  pass: AdapterPassState,
  files: ConsumptionFileRef[],
  from: number,
  options: ConsumptionScanOptions
): void {
  for (let i = from; i < files.length; i += 1) {
    const previous = options.watermarks?.[files[i].path];
    if (previous) pass.watermarks[files[i].path] = previous;
  }
}

async function notifyFile(
  source: ConsumptionSourceId,
  options: ConsumptionScanOptions,
  file: ConsumptionFileRef,
  filesSeen: number,
  filesTotal: number,
  bytesRead: number
): Promise<void> {
  if (!options.onFileScanned) return;
  await options.onFileScanned({
    source,
    path: file.path,
    filesSeen,
    filesTotal,
    bytesRead,
  });
}

function finishPass(
  pass: AdapterPassState,
  collapseWindows: boolean,
  sinkMode: boolean
): ConsumptionSourceScan {
  if (sinkMode) {
    // Everything already streamed out. The parse-level counters in
    // `diagnostics` (samplesEmitted, planWindowsEmitted) stand as-is; the
    // corpus-global merge — and its dedupe accounting — belongs to the sink's
    // owner in this mode.
    return {
      samples: [],
      planWindows: [],
      windowObservations: [],
      diagnostics: pass.diagnostics,
      watermarks: pass.watermarks,
      aborted: pass.aborted,
    };
  }
  const merged = mergeSamples(pass.rawSamples);
  pass.diagnostics.duplicatesMerged += merged.duplicatesMerged;
  pass.diagnostics.samplesEmitted = merged.samples.length;
  const latest = collapseWindows ? latestPlanWindows(pass.rawWindows) : [];
  if (collapseWindows) pass.diagnostics.planWindowsEmitted = latest.length;
  return {
    samples: merged.samples,
    planWindows: latest,
    windowObservations: pass.rawWindows,
    diagnostics: pass.diagnostics,
    watermarks: pass.watermarks,
    aborted: pass.aborted,
  };
}

const DEFAULT_CLAUDE_ROOT = '~/.claude/projects';
const DEFAULT_CODEX_ROOT = '~/.codex/sessions';

/**
 * Claude Code.
 *
 * Reads BOTH the top-level `<slug>/<sessionId>.jsonl` transcripts and the
 * nested `<slug>/<sessionId>/subagents/**\/agent-*.jsonl` transcripts. The
 * nested files hold 39% of all usage records in the operator's real corpus;
 * omitting them under-reports consumption by that much.
 */
export class ClaudeConsumptionAdapter implements ConsumptionSourceAdapter {
  readonly source = 'claude-code' as const;

  constructor(
    readonly root: string = DEFAULT_CLAUDE_ROOT,
    /**
     * Read the `agent-<agentId>.meta.json` beside each delegated transcript.
     * It only adds `spawnDepth` and `parentAgentId` (agentType already arrives
     * on the transcript line), so a caller that wants a cheaper scan can turn it
     * off and accept `spawnDepth: null`.
     */
    private readonly readDelegationMeta = true
  ) {}

  private metaCache = new Map<string, Record<string, unknown> | null>();

  private async delegationMeta(
    fs: ConsumptionFileSystem,
    transcriptPath: string
  ): Promise<Record<string, unknown> | null> {
    if (!this.readDelegationMeta) return null;
    if (!/[/\\]subagents[/\\]/.test(transcriptPath)) return null;
    const metaPath = transcriptPath.replace(/\.jsonl$/, '.meta.json');
    const cached = this.metaCache.get(metaPath);
    if (cached !== undefined) return cached;
    const chunk = await fs.readFrom(metaPath, 0);
    let parsed: Record<string, unknown> | null = null;
    if (chunk && chunk.text.trim().length > 0) {
      try {
        const value: unknown = JSON.parse(chunk.text);
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          parsed = value as Record<string, unknown>;
        }
      } catch {
        // Spawn metadata is enrichment. A damaged one costs `spawnDepth`, not
        // the sample, and is counted as `delegationMetaMissing`.
      }
    }
    this.metaCache.set(metaPath, parsed);
    return parsed;
  }

  async scan(
    fs: ConsumptionFileSystem,
    options: ConsumptionScanOptions = {}
  ): Promise<ConsumptionSourceScan> {
    const pass = emptyPass();
    const files = selectFiles(await fs.listFiles(this.root), options);
    let bytesReadTotal = 0;

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      if (options.signal?.aborted) {
        pass.aborted = true;
        carryUnreached(pass, files, index, options);
        break;
      }
      pass.diagnostics.filesSeen += 1;
      const previous = options.watermarks?.[file.path];
      const { fromByte, skip } = resumePoint(file, previous);
      if (skip) {
        pass.watermarks[file.path] = previous!;
        continue;
      }
      const isDelegated = /[/\\]subagents[/\\]/.test(file.path);
      const meta = await this.delegationMeta(fs, file.path);
      if (isDelegated && !meta) pass.diagnostics.delegationMetaMissing += 1;
      const fallbackSessionId = sessionIdFromClaudePath(file.path);

      const read = await readCompleteLines(fs, file, fromByte, options, lines => {
        const parsed = parseClaudeTranscript(lines, {
          sourceFile: file.path,
          fallbackSessionId,
          delegationMeta: meta,
        });
        emitSamples(pass, options, file, parsed.samples);
        mergeInto(pass.diagnostics, parsed.diagnostics);
      });
      if (read.unreadable) {
        pass.diagnostics.filesUnreadable += 1;
        if (previous) pass.watermarks[file.path] = previous;
        continue;
      }
      pass.diagnostics.bytesRead += read.bytesRead;
      bytesReadTotal += read.bytesRead;
      if (read.truncatedFinal) pass.diagnostics.truncatedFinalLines += 1;
      const mark = watermarkFor(file, read.consumedBytes, read.aborted);
      pass.watermarks[file.path] = mark;
      options.sink?.fileScanned?.(file, mark);
      if (read.aborted) {
        pass.aborted = true;
        carryUnreached(pass, files, index + 1, options);
        break;
      }
      await notifyFile(
        this.source,
        options,
        file,
        index + 1,
        files.length,
        bytesReadTotal
      );
    }

    return finishPass(pass, false, options.sink !== undefined);
  }
}

/**
 * Codex.
 *
 * Session context (cwd, session id, model) is established by the rollout's
 * first lines and carried in the watermark, so a tail-only incremental read
 * still attributes correctly. The same context is threaded between chunks of
 * one file for the same reason.
 */
export class CodexConsumptionAdapter implements ConsumptionSourceAdapter {
  readonly source = 'codex' as const;

  constructor(readonly root: string = DEFAULT_CODEX_ROOT) {}

  async scan(
    fs: ConsumptionFileSystem,
    options: ConsumptionScanOptions = {}
  ): Promise<ConsumptionSourceScan> {
    const pass = emptyPass();
    const files = selectFiles(await fs.listFiles(this.root), options);
    let bytesReadTotal = 0;

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      if (options.signal?.aborted) {
        pass.aborted = true;
        carryUnreached(pass, files, index, options);
        break;
      }
      pass.diagnostics.filesSeen += 1;
      const previous = options.watermarks?.[file.path];
      const { fromByte, skip, carry } = resumePoint(file, previous);
      if (skip) {
        pass.watermarks[file.path] = previous!;
        continue;
      }
      const fallbackSessionId = sessionIdFromCodexPath(file.path);
      let context =
        (carry as CodexSessionContext | undefined) ?? emptyCodexContext();

      const read = await readCompleteLines(fs, file, fromByte, options, lines => {
        const parsed = parseCodexRollout(lines, {
          sourceFile: file.path,
          fallbackSessionId,
          session: context,
        });
        context = parsed.session;
        emitSamples(pass, options, file, parsed.samples);
        emitWindows(pass, options, file, parsed.planWindows);
        mergeInto(pass.diagnostics, parsed.diagnostics);
      });
      if (read.unreadable) {
        pass.diagnostics.filesUnreadable += 1;
        if (previous) pass.watermarks[file.path] = previous;
        continue;
      }
      pass.diagnostics.bytesRead += read.bytesRead;
      bytesReadTotal += read.bytesRead;
      if (read.truncatedFinal) pass.diagnostics.truncatedFinalLines += 1;
      const mark = watermarkFor(file, read.consumedBytes, read.aborted, context);
      pass.watermarks[file.path] = mark;
      options.sink?.fileScanned?.(file, mark);
      if (read.aborted) {
        pass.aborted = true;
        carryUnreached(pass, files, index + 1, options);
        break;
      }
      await notifyFile(
        this.source,
        options,
        file,
        index + 1,
        files.length,
        bytesReadTotal
      );
    }

    return finishPass(pass, true, options.sink !== undefined);
  }
}

function mergeInto(
  target: ConsumptionDiagnostics,
  source: ConsumptionDiagnostics
): void {
  const merged = addDiagnostics(target, source);
  for (const key of Object.keys(merged) as Array<
    keyof ConsumptionDiagnostics
  >) {
    target[key] = merged[key];
  }
}

/** `<slug>/<sessionId>.jsonl` or `<slug>/<sessionId>/subagents/...`. */
export function sessionIdFromClaudePath(path: string): string | null {
  const segments = path.split(/[/\\]/).filter(Boolean);
  const subagentsAt = segments.lastIndexOf('subagents');
  if (subagentsAt > 0) return segments[subagentsAt - 1] ?? null;
  const file = segments[segments.length - 1] ?? '';
  return file.endsWith('.jsonl') ? file.slice(0, -'.jsonl'.length) : null;
}

/** `rollout-2026-07-24T12-04-51-<uuid>.jsonl`. */
export function sessionIdFromCodexPath(path: string): string | null {
  const file = (path.split(/[/\\]/).pop() ?? '').replace(/\.jsonl$/, '');
  const match = /rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)$/.exec(file);
  return match?.[1] ?? null;
}

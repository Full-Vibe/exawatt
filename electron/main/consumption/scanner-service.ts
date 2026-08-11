/**
 * ENG-008 E5 — the incremental watermarked consumption scanner.
 *
 * Main-process owner of the live local-consumption truth. The spine's §5
 * measurement (cold scan: 19.3 s wall, ~617 MB heap, 2.66 GB read) retired
 * inline scanning permanently, so this service is built around three rules:
 *
 * 1. **Nothing here ever blocks the workspace.** The first full scan is
 *    explicitly backgrounded and cancellable, reads in bounded chunks (every
 *    chunk boundary is an event-loop turn, so PTY and IPC traffic keeps
 *    flowing), yields between files, and reports progress. `snapshot()` never
 *    waits on scanning — it returns what is known now.
 * 2. **A byte is read at most once per life of its file.** Per-file
 *    watermarks (offset + size + mtime + Codex session context) persist
 *    across launches in the userData state store; a warm launch loads parsed
 *    samples from the store and the next pass reads only appended tails.
 * 3. **Change detection is push-first, pull-insured.** `fs.watch` on the two
 *    corpus roots schedules a debounced incremental pass — live truth while
 *    agents burn, zero polling when idle. FSEvents can drop or be
 *    unavailable, so a snapshot pull that finds the last pass stale kicks a
 *    pass as insurance, and an explicit `rescan` verb exists for tests and
 *    the operator. A poll timer was rejected: it would burn stat calls all
 *    day to defend against a rare failure the pull path already covers.
 *
 * Capacity truth (E1) is enforced at this boundary: plan windows are keyed
 * by `planWindowKey` (limitId is not global, and one limitId carries two
 * scopes), `windowMinutes <= 0` records are discarded and counted, the
 * latest observation per bucket is what the snapshot carries (with
 * `observedAt`, so the renderer's `windowFreshness` rule works unchanged),
 * and Claude Code simply has no window records — absent, never zero.
 */
import * as fsNode from 'fs';
import {
  ClaudeConsumptionAdapter,
  CodexConsumptionAdapter,
  LIVE_CONSUMPTION_SNAPSHOT_VERSION,
  WindowObservationAccumulator,
  addDiagnostics,
  derivePlanWindowRates,
  emptyDiagnostics,
  mergeSamples,
  planWindowKey,
  type ConsumptionDiagnostics,
  type ConsumptionFileProgress,
  type ConsumptionFileRef,
  type ConsumptionFileSystem,
  type ConsumptionSample,
  type ConsumptionScanOptions,
  type ConsumptionScanState,
  type ConsumptionSourceAdapter,
  type ConsumptionSourceId,
  type ConsumptionUpdatedEvent,
  type ConsumptionWatermark,
  type ConsumptionWatermarks,
  type LiveConsumptionSnapshot,
  type LiveConsumptionSnapshotRequest,
  type LiveSessionIdentityLink,
  type PlanWindow,
  type PlanWindowObservation,
} from '@exawatt/core';
import {
  NodeConsumptionFileSystem,
  defaultClaudeConsumptionRoot,
  defaultCodexConsumptionRoot,
} from '@exawatt/core/server';
import type { ConsumptionScannerLike } from '../consumption-ipc';
import {
  ConsumptionStateStore,
  emptyConsumptionMeta,
  type ConsumptionScanMetaV1,
} from './state-store';

/** Structural view of `SessionIdentityStore` records — main's identity index. */
export interface ProviderIdentityRecord {
  durableSessionId: string;
  harness: string;
  harnessSessionId: string;
  cwd: string;
}

export interface ConsumptionScannerServiceOptions {
  /** The ONLY directory this service ever writes. */
  stateDir: string;
  claudeRoot?: string;
  codexRoot?: string;
  fileSystem?: ConsumptionFileSystem;
  /** Live read of the durable-Session ↔ provider-conversation index. */
  identities?: () => ProviderIdentityRecord[];
  /** Watch the corpus roots for changes. Default true. */
  watch?: boolean;
  /** Trailing debounce after a watch event. */
  debounceMs?: number;
  /** Floor between two passes, however triggered. */
  minPassIntervalMs?: number;
  /** A snapshot pull older than this kicks an insurance pass. */
  staleAfterMs?: number;
  /**
   * Chunk bound. 4 MB parses in tens of milliseconds, and every chunk
   * boundary returns to the event loop, so this is the worst continuous
   * main-process stall the scan can cause.
   */
  maxChunkBytes?: number;
  /** Files between state-store appends during a pass. */
  appendEveryFiles?: number;
  /** Delay before the automatic initial pass. */
  initialDelayMs?: number;
  now?: () => number;
}

const HARNESS_TO_SOURCE: Record<string, ConsumptionSourceId> = {
  claude: 'claude-code',
  codex: 'codex',
};

interface AppendBuffer {
  samples: ConsumptionSample[];
  observations: PlanWindowObservation[];
  marks: ConsumptionWatermark[];
  files: number;
}

function emptyBuffer(): AppendBuffer {
  return { samples: [], observations: [], marks: [], files: 0 };
}

const yieldLoop = () => new Promise<void>(resolve => setImmediate(resolve));

export class ConsumptionScannerService implements ConsumptionScannerLike {
  private readonly store: ConsumptionStateStore;
  private readonly fileSystem: ConsumptionFileSystem;
  private readonly claudeRoot: string;
  private readonly codexRoot: string;
  private readonly now: () => number;
  private readonly watchEnabled: boolean;
  private readonly debounceMs: number;
  private readonly minPassIntervalMs: number;
  private readonly staleAfterMs: number;
  private readonly maxChunkBytes: number;
  private readonly appendEveryFiles: number;
  private readonly initialDelayMs: number;
  private readonly identities: () => ProviderIdentityRecord[];

  private samples = new Map<string, ConsumptionSample>();
  private watermarks: ConsumptionWatermarks = {};
  private latestWindows = new Map<string, PlanWindow>();
  private observations = new WindowObservationAccumulator();
  private diagnostics = emptyDiagnostics();
  private discardedDegenerateWindows = 0;
  private emptySources: ConsumptionSourceId[] = [];

  private phase: ConsumptionScanState['phase'] = 'idle';
  private lastScanAt: string | null = null;
  private corpusBytes: number | null = null;
  private firstScanComplete = false;
  private revision = 0;
  private cancelled = false;
  private progressBySource = new Map<
    ConsumptionSourceId,
    Pick<ConsumptionFileProgress, 'filesSeen' | 'filesTotal' | 'bytesRead'>
  >();

  private started = false;
  private ready: Promise<void> | null = null;
  private passAbort: { aborted: boolean } | null = null;
  private passPromise: Promise<void> | null = null;
  private lastPassEndedMs = 0;
  private scheduled: NodeJS.Timeout | null = null;
  private dirtyWhilePassRunning = false;
  private watchers: fsNode.FSWatcher[] = [];
  private disposed = false;
  private listeners = new Set<(event: ConsumptionUpdatedEvent) => void>();

  constructor(private readonly options: ConsumptionScannerServiceOptions) {
    this.store = new ConsumptionStateStore(options.stateDir);
    this.fileSystem =
      options.fileSystem ?? new NodeConsumptionFileSystem({ maxFiles: 50_000 });
    this.claudeRoot = options.claudeRoot ?? defaultClaudeConsumptionRoot();
    this.codexRoot = options.codexRoot ?? defaultCodexConsumptionRoot();
    this.now = options.now ?? Date.now;
    this.watchEnabled = options.watch ?? true;
    this.debounceMs = options.debounceMs ?? 10_000;
    this.minPassIntervalMs = options.minPassIntervalMs ?? 30_000;
    this.staleAfterMs = options.staleAfterMs ?? 300_000;
    this.maxChunkBytes = options.maxChunkBytes ?? 4 * 1024 * 1024;
    this.appendEveryFiles = options.appendEveryFiles ?? 25;
    this.initialDelayMs = options.initialDelayMs ?? 1_000;
    this.identities = options.identities ?? (() => []);
  }

  /* ---------------------------------------------------------------- */
  /* ConsumptionScannerLike                                            */
  /* ---------------------------------------------------------------- */

  async snapshot(
    request?: LiveConsumptionSnapshotRequest
  ): Promise<LiveConsumptionSnapshot> {
    this.ensureStarted();
    await this.ready;
    this.kickIfStale();
    const sinceMs = request?.sinceMs;
    let samples: ConsumptionSample[] = [];
    for (const sample of this.samples.values()) {
      if (sinceMs !== undefined && Date.parse(sample.at) < sinceMs) continue;
      samples.push(sample);
    }
    samples.sort((left, right) => (left.at < right.at ? -1 : 1));
    const observations = this.observations.list();
    return {
      version: LIVE_CONSUMPTION_SNAPSHOT_VERSION,
      generatedAtMs: this.now(),
      scanState: this.scanState(),
      samples,
      planWindows: [...this.latestWindows.values()].sort((left, right) =>
        left.observedAt < right.observedAt ? 1 : -1
      ),
      discardedDegenerateWindows: this.discardedDegenerateWindows,
      windowObservations: observations,
      windowRates: derivePlanWindowRates(observations),
      sessionIdentities: this.identityLinks(),
      diagnostics: { ...this.diagnostics },
      emptySources: [...this.emptySources],
    };
  }

  rescan(): void {
    this.ensureStarted();
    if (this.passAbort) return; // a pass is running — it already sees the present
    this.schedulePass(0);
  }

  cancelScan(): void {
    if (this.passAbort) this.passAbort.aborted = true;
  }

  onUpdated(listener: (event: ConsumptionUpdatedEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Abort any pass, stop watching, settle writes. For shutdown and tests. */
  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.scheduled) clearTimeout(this.scheduled);
    this.scheduled = null;
    this.cancelScan();
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
    await this.passPromise?.catch(() => undefined);
    await this.store.flush();
  }

  /** Test seam: resolves when the running or scheduled pass has finished. */
  async settle(): Promise<void> {
    await this.ready;
    for (;;) {
      const pending = this.passPromise;
      if (pending) {
        await pending.catch(() => undefined);
        continue;
      }
      if (this.scheduled) {
        await new Promise<void>(resolve => setTimeout(resolve, 10));
        continue;
      }
      return;
    }
  }

  /* ---------------------------------------------------------------- */
  /* startup                                                           */
  /* ---------------------------------------------------------------- */

  private ensureStarted(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.ready = (async () => {
      try {
        const loaded = await this.store.load();
        this.samples = loaded.samples;
        this.watermarks = loaded.watermarks;
        this.observations = new WindowObservationAccumulator(
          {},
          loaded.observations
        );
        this.diagnostics = loaded.meta.diagnostics;
        this.discardedDegenerateWindows =
          loaded.meta.discardedDegenerateWindows;
        this.firstScanComplete = loaded.meta.firstScanComplete;
        this.lastScanAt = loaded.meta.lastScanAt;
        this.corpusBytes = loaded.meta.corpusBytes;
        this.emptySources = loaded.meta.emptySources;
        for (const window of loaded.meta.planWindows) {
          this.latestWindows.set(planWindowKey(window), window);
        }
        if (this.samples.size > 0) this.revision += 1;
      } catch (error) {
        console.error('Consumption state load failed; rescanning', error);
      }
      this.startWatching();
      this.schedulePass(this.initialDelayMs);
    })();
  }

  private startWatching(): void {
    if (!this.watchEnabled || this.disposed) return;
    for (const root of [this.claudeRoot, this.codexRoot]) {
      try {
        const watcher = fsNode.watch(root, { recursive: true }, () => {
          this.onCorpusChanged();
        });
        watcher.on('error', () => {
          // Watch loss is survivable: the stale-pull insurance path remains.
          watcher.close();
        });
        this.watchers.push(watcher);
      } catch {
        // Root absent (harness not installed) or watch unsupported. The
        // pull-side staleness check covers late installs.
      }
    }
  }

  private onCorpusChanged(): void {
    if (this.passAbort) {
      this.dirtyWhilePassRunning = true;
      return;
    }
    this.schedulePass(this.debounceMs);
  }

  private kickIfStale(): void {
    if (this.passAbort || this.scheduled || this.disposed) return;
    const last = this.lastScanAt ? Date.parse(this.lastScanAt) : 0;
    if (this.now() - last >= this.staleAfterMs) this.schedulePass(0);
  }

  private schedulePass(delayMs: number): void {
    if (this.disposed) return;
    const sinceLast = this.now() - this.lastPassEndedMs;
    const floor =
      this.lastPassEndedMs === 0
        ? 0
        : Math.max(0, this.minPassIntervalMs - sinceLast);
    const delay = Math.max(delayMs, floor);
    if (this.scheduled) {
      // Trailing debounce: the newest request wins.
      clearTimeout(this.scheduled);
    }
    this.scheduled = setTimeout(() => {
      this.scheduled = null;
      if (this.passAbort || this.disposed) return;
      this.passPromise = this.runPass()
        .catch(error => {
          console.error('Consumption scan pass failed', error);
        })
        .finally(() => {
          this.passPromise = null;
        });
    }, delay);
    this.scheduled.unref?.();
  }

  /* ---------------------------------------------------------------- */
  /* the pass                                                          */
  /* ---------------------------------------------------------------- */

  private async runPass(): Promise<void> {
    const abort = { aborted: false };
    this.passAbort = abort;
    this.phase = this.firstScanComplete ? 'incremental' : 'first-scan';
    this.cancelled = false;
    this.progressBySource = new Map();
    this.dirtyWhilePassRunning = false;
    this.publish();

    const passDiagnostics = { value: emptyDiagnostics() };
    let corpusDuplicates = 0;
    let buffer = emptyBuffer();
    let contentDirty = false;
    let lastProgressPublish = 0;
    let lastContentBump = this.now();

    const flushBuffer = () => {
      if (
        buffer.samples.length === 0 &&
        buffer.observations.length === 0 &&
        buffer.marks.length === 0
      ) {
        return;
      }
      const batch = buffer;
      buffer = emptyBuffer();
      void this.store.append({
        samples: batch.samples,
        observations: batch.observations,
        marks: batch.marks,
      });
    };

    const sink = {
      samples: (incoming: ConsumptionSample[]) => {
        for (const sample of incoming) {
          const existing = this.samples.get(sample.idempotencyKey);
          const merged = existing
            ? mergeSamples([existing, sample]).samples[0]
            : sample;
          if (existing) corpusDuplicates += 1;
          this.samples.set(sample.idempotencyKey, merged);
          buffer.samples.push(merged);
        }
        if (incoming.length > 0) contentDirty = true;
      },
      planWindows: (incoming: PlanWindow[]) => {
        for (const window of incoming) {
          if (window.windowMinutes <= 0) {
            this.discardedDegenerateWindows += 1;
            continue;
          }
          const key = planWindowKey(window);
          const existing = this.latestWindows.get(key);
          if (!existing || window.observedAt > existing.observedAt) {
            this.latestWindows.set(key, window);
            contentDirty = true;
          }
          const retained = this.observations.addWindow(window);
          if (retained) buffer.observations.push(retained);
        }
      },
      fileScanned: (_file: ConsumptionFileRef, mark: ConsumptionWatermark) => {
        buffer.marks.push(mark);
        buffer.files += 1;
        if (buffer.files >= this.appendEveryFiles) flushBuffer();
      },
    };

    const onFileScanned = async (progress: ConsumptionFileProgress) => {
      this.progressBySource.set(progress.source, {
        filesSeen: progress.filesSeen,
        filesTotal: progress.filesTotal,
        bytesRead: progress.bytesRead,
      });
      const at = this.now();
      if (contentDirty && at - lastContentBump >= 5_000) {
        // Progressive first scan: newest files are scanned first, so the
        // meter's live windows appear long before the pass ends.
        this.revision += 1;
        lastContentBump = at;
        contentDirty = false;
        this.publish();
        lastProgressPublish = at;
      } else if (at - lastProgressPublish >= 500) {
        lastProgressPublish = at;
        this.publish();
      }
      await yieldLoop();
    };

    const scanOptions: ConsumptionScanOptions = {
      watermarks: this.watermarks,
      signal: abort,
      maxChunkBytes: this.maxChunkBytes,
      onFileScanned,
      sink,
    };
    const adapters: ConsumptionSourceAdapter[] = [
      new ClaudeConsumptionAdapter(this.claudeRoot),
      new CodexConsumptionAdapter(this.codexRoot),
    ];

    let aborted = false;
    const emptySources: ConsumptionSourceId[] = [];
    const returnedMarks: ConsumptionWatermarks = {};
    try {
      const results = await Promise.all(
        adapters.map(adapter => adapter.scan(this.fileSystem, scanOptions))
      );
      for (let i = 0; i < results.length; i += 1) {
        const result = results[i];
        passDiagnostics.value = addDiagnostics(
          passDiagnostics.value,
          result.diagnostics
        );
        Object.assign(returnedMarks, result.watermarks);
        if (result.aborted) aborted = true;
        if (result.diagnostics.filesSeen === 0) {
          emptySources.push(adapters[i].source);
        }
      }
    } finally {
      flushBuffer();
      const passDiag = passDiagnostics.value;
      passDiag.duplicatesMerged += corpusDuplicates;
      this.diagnostics = addDiagnostics(this.diagnostics, passDiag);
      if (aborted || abort.aborted) {
        // Keep marks for everything that finished; files never reached keep
        // their previous marks, which are already in `this.watermarks`.
        Object.assign(this.watermarks, returnedMarks);
        this.cancelled = true;
      } else {
        // A completed pass is the authoritative file inventory: replacing the
        // map lets deleted transcripts' marks fall away.
        this.watermarks = returnedMarks;
        this.emptySources = emptySources;
        this.lastScanAt = new Date(this.now()).toISOString();
        this.corpusBytes = Object.values(this.watermarks).reduce(
          (total, mark) => total + mark.size,
          0
        );
        this.firstScanComplete = true;
        this.cancelled = false;
      }
      this.phase = 'idle';
      this.progressBySource = new Map();
      this.passAbort = null;
      this.lastPassEndedMs = this.now();
      this.revision += 1;
      void this.store.writeMeta(this.meta());
      if (!aborted && this.store.shouldCompact) {
        void this.store.compact(
          this.samples.values(),
          this.watermarks,
          this.observations.list(),
          this.meta()
        );
      }
      this.publish();
      if (this.dirtyWhilePassRunning && !this.disposed) {
        this.schedulePass(this.debounceMs);
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* assembly                                                          */
  /* ---------------------------------------------------------------- */

  private scanState(): ConsumptionScanState {
    let progress: ConsumptionScanState['progress'] = null;
    if (this.phase !== 'idle') {
      let filesSeen = 0;
      let filesTotal = 0;
      let bytesRead = 0;
      for (const entry of this.progressBySource.values()) {
        filesSeen += entry.filesSeen;
        filesTotal += entry.filesTotal;
        bytesRead += entry.bytesRead;
      }
      progress = { filesSeen, filesTotal, bytesRead };
    }
    return {
      phase: this.phase,
      progress,
      lastScanAt: this.lastScanAt,
      corpusBytes: this.corpusBytes,
      firstScanComplete: this.firstScanComplete,
      revision: this.revision,
      cancelled: this.cancelled,
    };
  }

  private identityLinks(): LiveSessionIdentityLink[] {
    const out: LiveSessionIdentityLink[] = [];
    for (const record of this.identities()) {
      const source = HARNESS_TO_SOURCE[record.harness];
      if (!source) continue;
      out.push({
        source,
        providerSessionId: record.harnessSessionId,
        durableSessionId: record.durableSessionId,
        cwd: record.cwd,
      });
    }
    return out;
  }

  private meta(): ConsumptionScanMetaV1 {
    return {
      ...emptyConsumptionMeta(),
      lastScanAt: this.lastScanAt,
      firstScanComplete: this.firstScanComplete,
      corpusBytes: this.corpusBytes,
      discardedDegenerateWindows: this.discardedDegenerateWindows,
      diagnostics: { ...this.diagnostics },
      planWindows: [...this.latestWindows.values()],
      emptySources: [...this.emptySources],
    };
  }

  private publish(): void {
    const event: ConsumptionUpdatedEvent = {
      revision: this.revision,
      scanState: this.scanState(),
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Consumption update listener failed', error);
      }
    }
  }
}

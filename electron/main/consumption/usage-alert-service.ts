/**
 * Usage alerts, the main-process half (ENG-008 E17).
 *
 * Decides from the same composed snapshot the renderer pulls, through core's
 * `dueUsageAlerts` (the forecast every usage surface uses), and hands each
 * due alert to an injected `post`. It runs in main so it keeps watching while
 * Exawatt is in the background, which is exactly when a notification matters,
 * and each check also nudges the account reads the composite throttles.
 *
 * Each stage of each window cycle is spoken once, across restarts: the sent
 * keys persist beside the plan state, pruned as their cycles reset. A file
 * that exists but cannot be read is never written over (BUG-247): alerts
 * run from memory until it reads again, so the worst case is one repeated
 * alert, never a lost file.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  dueUsageAlerts,
  liveUsageAlertKeys,
  type UsageAlert,
  type UsageAlertSettings,
} from '@exawatt/core';
import type { ConsumptionScannerLike } from '../consumption-ipc';
import { jsonStateGrammar, readPersistedStateSync } from '../persisted-state-file';

const STATE_FILE = 'usage-alerts.json';

/** A state file of another shape is set aside with its bytes (BUG-247). */
const ALERT_STATE_FILE = jsonStateGrammar<{ version: 1; sent: string[] }>(value => {
  const record = value as { version?: unknown; sent?: unknown } | null;
  if (!record || record.version !== 1 || !Array.isArray(record.sent)) return null;
  if (!record.sent.every(key => typeof key === 'string')) return null;
  return { version: 1, sent: record.sent as string[] };
});
const DEFAULT_INTERVAL_MS = 5 * 60_000;

interface UsageAlertServiceOptions {
  /** The composed snapshot source (scanner plus account reads). */
  source: ConsumptionScannerLike;
  /** Directory this service may write. Its ONLY write path. */
  stateDir: string;
  /** The operator's current choices; read on every check. */
  preferences: () => UsageAlertSettings & { enabled: boolean };
  post: (alert: UsageAlert) => void;
  now?: () => number;
  intervalMs?: number;
}

export class UsageAlertService {
  private readonly source: ConsumptionScannerLike;
  private readonly stateFile: string;
  private readonly preferences: UsageAlertServiceOptions['preferences'];
  private readonly post: (alert: UsageAlert) => void;
  private readonly now: () => number;
  private readonly intervalMs: number;
  private sent: Set<string>;
  private inFlight: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  /** The file exists and could not be read: never write over it. */
  private unreadable = false;

  constructor(options: UsageAlertServiceOptions) {
    this.source = options.source;
    this.stateFile = path.join(options.stateDir, STATE_FILE);
    this.preferences = options.preferences;
    this.post = options.post;
    this.now = options.now ?? Date.now;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.sent = new Set(this.load());
  }

  /** Watch on a quiet cadence and on every snapshot change. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.check(), this.intervalMs);
    this.timer.unref?.();
    this.unsubscribe = this.source.onUpdated(() => void this.check());
    void this.check();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** One decision pass. Never concurrent; the returned promise is for tests. */
  check(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.run().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async run(): Promise<void> {
    const preferences = this.preferences();
    if (!preferences.enabled) return;
    const nowMs = this.now();
    // Samples are not needed to decide; ask for none.
    const snapshot = await this.source.snapshot({ sinceMs: nowMs });
    // Until a full scan has run, the plan windows are a partial picture.
    if (!snapshot.scanState.firstScanComplete) return;
    const alerts = dueUsageAlerts(snapshot, nowMs, preferences, this.sent);
    const before = this.sent.size;
    for (const alert of alerts) {
      for (const key of alert.keys) this.sent.add(key);
      this.post(alert);
    }
    const live = liveUsageAlertKeys(this.sent, nowMs);
    if (alerts.length > 0 || live.length !== before) {
      this.sent = new Set(live);
      this.save();
    }
  }

  private load(): string[] {
    const read = readPersistedStateSync(this.stateFile, ALERT_STATE_FILE);
    this.unreadable = read.status === 'unreadable';
    return read.status === 'ok' ? read.value.sent : [];
  }

  private save(): void {
    if (this.unreadable) {
      // Merge what the file holds once it reads again; until then keep it.
      const saved = this.load();
      if (this.unreadable) return;
      for (const key of saved) this.sent.add(key);
    }
    try {
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      const tmp = `${this.stateFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, sent: [...this.sent] }));
      fs.renameSync(tmp, this.stateFile);
    } catch {
      // Remembering is an optimization; the alert itself was already posted.
    }
  }
}

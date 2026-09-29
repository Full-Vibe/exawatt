import fs from 'fs';
import path from 'path';
import {
  redactDiagnosticText,
  redactDiagnosticValue,
} from './diagnostics-redaction';

/**
 * Persistent JSONL diagnostics (D28): one append-only line per event with
 * single-generation rotation. A subsystem that fails silently in the
 * packaged app (whose stdout goes nowhere) must leave evidence that a
 * dogfood report can read back as a file, not reconstruct by archaeology.
 *
 * Sibling of auth-diagnostics.ts. Both now share one redaction pass
 * (`diagnostics-redaction.ts`, ENG-025 F5.1); this module used to only clip
 * long strings, which was safe while nothing read these files off the
 * machine and stopped being safe when F5 started attaching their tails to
 * bug reports.
 */
export type DiagnosticFields = Record<string, unknown>;
export type DiagnosticRecorder = (
  event: string,
  fields?: DiagnosticFields
) => void;

const DEFAULT_MAX_BYTES = 1_000_000;
const MAX_TEXT_LENGTH = 400;

function clip(value: unknown): unknown {
  return redactDiagnosticValue(value, 0, MAX_TEXT_LENGTH);
}

interface DiagnosticRecorderBounds {
  perMinute: number;
  perRun: number;
  now?: () => number;
  /** Names the suppression lines; the first suppressed event otherwise. */
  label?: string;
  /** Runs `flush` once `ms` have passed (default: an unref'd timer). */
  schedule?: (flush: () => void, ms: number) => () => void;
}

const MINUTE_MS = 60_000;

function scheduleUnref(flush: () => void, ms: number): () => void {
  const timer = setTimeout(flush, ms);
  timer.unref?.();
  return () => clearTimeout(timer);
}

/**
 * Cap a recorder the way the main-thread stall trace caps itself: at most
 * `perMinute` records a minute and `perRun` for the life of the process.
 * What the minute cap drops is not lost without trace: one
 * `<label>.suppressed` line with the count follows when that minute ends. The
 * run cap writes one `<label>.exhausted` line, then nothing. Standing
 * instrumentation must never be able to turn a misbehaving fleet into a log
 * that grows without bound.
 */
export function boundDiagnosticRecorder(
  record: DiagnosticRecorder,
  {
    perMinute,
    perRun,
    now = Date.now,
    label,
    schedule = scheduleUnref,
  }: DiagnosticRecorderBounds
): DiagnosticRecorder {
  let windowStartedAt = 0;
  let windowCount = 0;
  let runCount = 0;
  let exhausted = false;
  let suppressed = 0;
  let suppressedLabel = '';
  let cancelFlush: (() => void) | null = null;

  function flushSuppressed(): void {
    cancelFlush?.();
    cancelFlush = null;
    if (suppressed === 0) return;
    record(`${suppressedLabel}.suppressed`, { suppressed, perMinute });
    suppressed = 0;
  }

  return (event, fields = {}) => {
    if (exhausted) return;
    const at = now();
    if (at - windowStartedAt >= MINUTE_MS) {
      flushSuppressed();
      windowStartedAt = at;
      windowCount = 0;
    }
    if (runCount >= perRun) {
      flushSuppressed();
      exhausted = true;
      record(`${label ?? event}.exhausted`, { perRun });
      return;
    }
    if (windowCount >= perMinute) {
      if (suppressed === 0) {
        suppressedLabel = label ?? event;
        cancelFlush = schedule(
          flushSuppressed,
          windowStartedAt + MINUTE_MS - at
        );
      }
      suppressed += 1;
      return;
    }
    windowCount += 1;
    runCount += 1;
    record(event, fields);
  };
}

/**
 * One `boundDiagnosticRecorder` per event family (`renderer.gone` and
 * `renderer.recovery-choice` are the family `renderer`), so a family in a
 * crash loop spends its own budget and never silences the others.
 */
export function boundDiagnosticRecorderPerFamily(
  record: DiagnosticRecorder,
  bounds: Omit<DiagnosticRecorderBounds, 'label'>
): DiagnosticRecorder {
  const families = new Map<string, DiagnosticRecorder>();
  return (event, fields) => {
    const family = event.split('.', 1)[0];
    let bound = families.get(family);
    if (!bound) {
      bound = boundDiagnosticRecorder(record, { ...bounds, label: family });
      families.set(family, bound);
    }
    bound(event, fields);
  };
}

export function createDiagnosticsLog(
  logPath: string,
  maxBytes = DEFAULT_MAX_BYTES
): DiagnosticRecorder {
  fs.mkdirSync(path.dirname(logPath), { recursive: true, mode: 0o700 });
  return (event, fields = {}) => {
    const safeEvent = redactDiagnosticText(event, MAX_TEXT_LENGTH);
    const entry: DiagnosticFields = {
      timestamp: new Date().toISOString(),
      event: safeEvent,
    };
    for (const [key, value] of Object.entries(fields)) {
      entry[key] = clip(value);
    }
    let line: string;
    try {
      line = `${JSON.stringify(entry)}\n`;
    } catch {
      line = `${JSON.stringify({
        timestamp: entry.timestamp,
        event: safeEvent,
        unserializable: true,
      })}\n`;
    }
    try {
      const size = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
      if (size > 0 && size + Buffer.byteLength(line) > maxBytes) {
        fs.renameSync(logPath, `${logPath}.1`);
      }
      fs.appendFileSync(logPath, line, { encoding: 'utf8', mode: 0o600 });
    } catch (error) {
      console.warn('[diagnostics] could not persist event', event, error);
    }
  };
}

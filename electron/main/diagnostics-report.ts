import fs from 'fs';
import path from 'path';
import {
  anonymizeHomePath,
  redactDiagnosticValue,
} from './diagnostics-redaction';

/**
 * The anonymized diagnostics bundle (ENG-025 F5).
 *
 * What a bug report is missing is machine state, and asking a user to read a
 * terminal is not support. This assembles the same facts a maintainer would
 * otherwise ask for one at a time: which build, signed in or not, what the
 * updater did, what recently failed.
 *
 * The exclusions are the product decision, not an implementation detail.
 * Nothing here reads agent transcripts, prompts, Project names, file paths
 * inside a Project, or Session output. The logs it tails are redacted at
 * write time (`diagnostics-redaction.ts`), and every value is passed through
 * home-path anonymization again on the way out, because a bundle is the one
 * artifact that definitely leaves the machine.
 *
 * The renderer shows the exact object this returns before anything is sent.
 * If a field would embarrass a user to hand over, it does not belong here.
 */

export const DIAGNOSTICS_REPORT_VERSION = 1;

/** Per-log tail, small enough that the whole bundle fits the intake's 32KB
 *  `context` budget with room for the rest of the report. */
const TAIL_LINES = 40;
const MAX_LOG_BYTES = 24_000;
/** Hard ceiling on the serialized bundle. The intake cap is 32KB; stopping
 *  short leaves room for the surrounding feedback context. */
export const MAX_REPORT_BYTES = 28_000;

export interface DiagnosticsLogTail {
  name: string;
  present: boolean;
  lines: unknown[];
  /** Set when the tail was shortened, so a reader never mistakes a truncated
   *  log for a complete one. */
  truncated?: boolean;
}

export interface DiagnosticsReport {
  reportVersion: number;
  generatedAt: string;
  app: {
    version: string;
    sha: string;
    branch: string;
    delivery: string;
    packaged: boolean;
    installPath: string;
  };
  system: {
    platform: string;
    arch: string;
    osRelease: string;
    electron: string;
    node: string;
    locale: string;
  };
  update: Record<string, unknown> | null;
  session: {
    signedIn: boolean;
    liveSessions: number;
  };
  logs: DiagnosticsLogTail[];
  /** Populated when the bundle had to be shortened to fit the byte ceiling. */
  notes?: string[];
}

export interface DiagnosticsReportInput {
  build: {
    sha: string;
    branch: string;
    delivery: string;
  };
  appVersion: string;
  packaged: boolean;
  installPath: string;
  logDirectory: string;
  updateStatus: Record<string, unknown> | null;
  signedIn: boolean;
  liveSessions: number;
  locale: string;
  now?: () => Date;
  /** Injected for tests; defaults to the real filesystem. */
  readLog?: (filePath: string) => string | null;
}

const LOG_NAMES = [
  'updater.jsonl',
  'auth.jsonl',
  'summarizer.jsonl',
  // Main-thread stall records and shell-startup findings (incident `0006`).
  // Riding along here is the whole operator workflow for a beachball: file a
  // report, the trace is already attached.
  'main.jsonl',
];

function defaultReadLog(filePath: string): string | null {
  try {
    const { size } = fs.statSync(filePath);
    const start = Math.max(0, size - MAX_LOG_BYTES);
    const handle = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(size - start);
      fs.readSync(handle, buffer, 0, buffer.length, start);
      return buffer.toString('utf8');
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    return null;
  }
}

/**
 * A tail read from a byte offset can begin mid-line, so the first partial
 * record is dropped rather than reported as malformed. A line that will not
 * parse is kept as redacted text: unparseable evidence still beats none.
 */
function tailLog(name: string, raw: string | null): DiagnosticsLogTail {
  if (raw === null) return { name, present: false, lines: [] };
  const rows = raw.split('\n').filter(line => line.trim().length > 0);
  // Compare BYTES, not characters: the reader slices a byte range, so a log
  // with any multibyte content would otherwise look short and keep its
  // mangled first line.
  const startedMidFile = Buffer.byteLength(raw, 'utf8') >= MAX_LOG_BYTES;
  const complete = startedMidFile ? rows.slice(1) : rows;
  const selected = complete.slice(-TAIL_LINES);
  // Redacting on read as well as on write is not belt-and-braces: a user
  // upgrading into F5.1 still has pre-existing `auth.jsonl` and
  // `summarizer.jsonl` lines that the old writer never sanitized, and those
  // are exactly the lines a first diagnostics report would pick up.
  const lines = selected.map(line => {
    try {
      return redactDiagnosticValue(JSON.parse(line));
    } catch {
      return { unparsed: anonymizeHomePath(line).slice(0, 400) };
    }
  });
  return {
    name,
    present: true,
    lines,
    ...(selected.length < complete.length || complete.length < rows.length
      ? { truncated: true }
      : {}),
  };
}

export function buildDiagnosticsReport(
  input: DiagnosticsReportInput
): DiagnosticsReport {
  const now = input.now ?? (() => new Date());
  const readLog = input.readLog ?? defaultReadLog;

  const report: DiagnosticsReport = {
    reportVersion: DIAGNOSTICS_REPORT_VERSION,
    generatedAt: now().toISOString(),
    app: {
      version: input.appVersion,
      sha: input.build.sha,
      branch: input.build.branch,
      delivery: input.build.delivery,
      packaged: input.packaged,
      installPath: anonymizeHomePath(input.installPath),
    },
    system: {
      platform: process.platform,
      arch: process.arch,
      osRelease: process.getSystemVersion?.() ?? '',
      electron: process.versions.electron ?? '',
      node: process.versions.node ?? '',
      locale: input.locale,
    },
    // `ProductUpdateStatus.logPath` is an absolute path under the user's home,
    // so the status object needs the same treatment as everything else. It is
    // the one field here that is not a bare enum or number.
    update: input.updateStatus
      ? (redactDiagnosticValue(input.updateStatus) as Record<string, unknown>)
      : null,
    session: {
      signedIn: input.signedIn,
      liveSessions: input.liveSessions,
    },
    logs: LOG_NAMES.map(name =>
      tailLog(name, readLog(path.join(input.logDirectory, name)))
    ),
  };

  return enforceByteCeiling(report);
}

/**
 * Drop log lines oldest-first until the bundle fits, and say so in `notes`.
 * A silently truncated report reads as "nothing else happened", which is the
 * failure mode this whole feature exists to remove.
 */
function enforceByteCeiling(report: DiagnosticsReport): DiagnosticsReport {
  const size = () => Buffer.byteLength(JSON.stringify(report), 'utf8');
  if (size() <= MAX_REPORT_BYTES) return report;

  // Trim the largest log first so one noisy subsystem cannot crowd out the
  // others; stop when every log is down to a single line.
  let dropped = 0;
  let guard = 0;
  while (size() > MAX_REPORT_BYTES && guard < 10_000) {
    guard += 1;
    const widest = report.logs.reduce<DiagnosticsLogTail | null>(
      (worst, log) =>
        log.lines.length > (worst?.lines.length ?? 1) ? log : worst,
      null
    );
    if (!widest || widest.lines.length <= 1) break;
    widest.lines.shift();
    widest.truncated = true;
    dropped += 1;
  }
  const notes: string[] = [];
  if (dropped > 0) {
    notes.push(
      `Dropped ${dropped} older log line(s) to keep the report under ${MAX_REPORT_BYTES} bytes.`
    );
  }
  // Say so rather than shipping a quietly oversized bundle the intake may
  // reject: a report that cannot explain itself is the bug this feature fixes.
  if (size() > MAX_REPORT_BYTES) {
    notes.push(
      `Report is still over ${MAX_REPORT_BYTES} bytes with every log at one line.`
    );
  }
  if (notes.length > 0) report.notes = notes;
  return report;
}

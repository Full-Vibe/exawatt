import { describe, expect, it } from 'vitest';
import os from 'os';
import path from 'path';
import {
  MAX_REPORT_BYTES,
  buildDiagnosticsReport,
  type DiagnosticsReportInput,
} from './diagnostics-report';

const LOG_DIR = '/tmp/logs';

function input(
  overrides: Partial<DiagnosticsReportInput> = {}
): DiagnosticsReportInput {
  return {
    build: { sha: 'abc123', branch: 'master', delivery: 'signed' },
    appVersion: '0.1.9',
    packaged: true,
    installPath: '/Applications/Exawatt.app',
    logDirectory: LOG_DIR,
    updateStatus: { phase: 'error', error: 'ENOSPC' },
    signedIn: false,
    liveSessions: 3,
    locale: 'en-US',
    now: () => new Date('2026-08-14T12:00:00.000Z'),
    readLog: () => null,
    ...overrides,
  };
}

function logReader(files: Record<string, string>) {
  return (filePath: string) => files[path.basename(filePath)] ?? null;
}

describe('buildDiagnosticsReport', () => {
  it('reports the build, update state, and session without inventing values', () => {
    const report = buildDiagnosticsReport(input());
    expect(report.reportVersion).toBe(1);
    expect(report.app.version).toBe('0.1.9');
    expect(report.app.delivery).toBe('signed');
    expect(report.update).toEqual({ phase: 'error', error: 'ENOSPC' });
    expect(report.session).toEqual({ signedIn: false, liveSessions: 3 });
  });

  it('marks a log that does not exist as absent rather than empty', () => {
    const report = buildDiagnosticsReport(input());
    const updater = report.logs.find(log => log.name === 'updater.jsonl');
    expect(updater).toEqual({
      name: 'updater.jsonl',
      present: false,
      lines: [],
    });
  });

  it('parses JSONL tails and keeps unparseable lines as evidence', () => {
    const report = buildDiagnosticsReport(
      input({
        readLog: logReader({
          'updater.jsonl': '{"event":"updater.error"}\nnot json\n',
        }),
      })
    );
    const updater = report.logs.find(log => log.name === 'updater.jsonl');
    expect(updater?.present).toBe(true);
    expect(updater?.lines[0]).toEqual({ event: 'updater.error' });
    expect(updater?.lines[1]).toEqual({ unparsed: 'not json' });
  });

  it('keeps only the newest lines and says the tail was truncated', () => {
    const lines = Array.from(
      { length: 60 },
      (_, index) => `{"event":"e${index}"}`
    ).join('\n');
    const report = buildDiagnosticsReport(
      input({ readLog: logReader({ 'auth.jsonl': lines }) })
    );
    const auth = report.logs.find(log => log.name === 'auth.jsonl');
    expect(auth?.lines).toHaveLength(40);
    expect(auth?.lines[39]).toEqual({ event: 'e59' });
    expect(auth?.truncated).toBe(true);
  });

  it('anonymizes the home directory out of the install path', () => {
    const report = buildDiagnosticsReport(
      input({ installPath: path.join(os.homedir(), 'Apps', 'Exawatt.app') })
    );
    expect(report.app.installPath).toBe('~/Apps/Exawatt.app');
    expect(report.app.installPath).not.toContain(os.homedir());
  });

  it('stays under the byte ceiling and admits that it trimmed', () => {
    // Prose, not one long token: a 400-character unbroken run would be
    // replaced by [REDACTED_LONG_VALUE] and the fixture would never be big
    // enough to exercise the ceiling at all.
    const detail = Array.from({ length: 80 }, (_, w) => `word${w}`).join(' ');
    const fat = Array.from(
      { length: 200 },
      (_, index) => `{"event":"e${index}","detail":"${detail}"}`
    ).join('\n');
    const report = buildDiagnosticsReport(
      input({
        readLog: logReader({
          'updater.jsonl': fat,
          'auth.jsonl': fat,
          'summarizer.jsonl': fat,
        }),
      })
    );
    const size = Buffer.byteLength(JSON.stringify(report), 'utf8');
    expect(size).toBeLessThanOrEqual(MAX_REPORT_BYTES);
    expect(report.notes?.[0]).toMatch(/Dropped \d+ older log line/);
  });

  it('adds no Session or Project content of its own', () => {
    // Asserting on key names alone was false comfort: the summarizer writes
    // `session`, not `durableSessionId`, so the original list could never
    // have caught anything. Assert on the assembled shape instead.
    const report = buildDiagnosticsReport(input());
    expect(Object.keys(report).sort()).toEqual([
      'app',
      'generatedAt',
      'logs',
      'reportVersion',
      'session',
      'system',
      'update',
    ]);
    expect(Object.keys(report.session).sort()).toEqual([
      'liveSessions',
      'signedIn',
    ]);
  });

  it('does not let a secret in a log line reach the bundle', () => {
    // The realistic worry is not a key name, it is a credential that a
    // subsystem logged into a value.
    const line = JSON.stringify({
      event: 'auth.transport.failure',
      error: 'Authorization: Bearer sk-live-must-not-ship',
      jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl',
    });
    const serialized = JSON.stringify(
      buildDiagnosticsReport(
        input({ readLog: logReader({ 'auth.jsonl': line }) })
      )
    );
    expect(serialized).not.toContain('sk-live-must-not-ship');
    expect(serialized).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(serialized).toContain('[REDACTED');
  });

  it('anonymizes the home directory inside the update status', () => {
    const report = buildDiagnosticsReport(
      input({
        updateStatus: {
          phase: 'error',
          logPath: path.join(os.homedir(), 'Library', 'logs', 'updater.jsonl'),
        },
      })
    );
    expect(report.update?.logPath).toBe('~/Library/logs/updater.jsonl');
    expect(JSON.stringify(report)).not.toContain(os.homedir());
  });

  it('redacts log lines written before redaction moved to write time', () => {
    // A user upgrading into F5.1 still has unsanitized legacy lines on disk.
    const legacy = JSON.stringify({
      event: 'auth.transport.request',
      detail: 'Authorization: Bearer sk-legacy-secret',
      home: path.join(os.homedir(), 'projects'),
    });
    const report = buildDiagnosticsReport(
      input({ readLog: logReader({ 'auth.jsonl': legacy }) })
    );
    const serialized = JSON.stringify(report);
    expect(serialized).toContain('[REDACTED]');
    expect(serialized).not.toContain('sk-legacy-secret');
    expect(serialized).not.toContain(os.homedir());
  });

  it('drops a partial first line using byte length, not character count', () => {
    // Multibyte content makes character length shorter than byte length; the
    // mid-file marker has to be measured in bytes or the mangled opening
    // record survives.
    const wide = `${'é'.repeat(13_000)}\n${JSON.stringify({ event: 'kept' })}`;
    const report = buildDiagnosticsReport(
      input({ readLog: logReader({ 'summarizer.jsonl': wide }) })
    );
    const log = report.logs.find(entry => entry.name === 'summarizer.jsonl');
    expect(log?.lines).toEqual([{ event: 'kept' }]);
  });

  it('adds no notes when nothing had to be dropped', () => {
    const report = buildDiagnosticsReport(input());
    expect(report.notes).toBeUndefined();
  });
});

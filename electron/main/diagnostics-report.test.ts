import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { deriveConnectedSourceId } from './connected-source-store';
import { readOrCreatePseudonymKey } from './diagnostics-pseudonyms';
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
    pseudonymKey: Buffer.alloc(32, 7),
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
    // subsystem logged into a value. The fixture is assembled from parts so
    // the repository's secret scanner cannot mistake a redaction test for a
    // committed token, and so a REAL token pasted beside it still fails the
    // gate — which a path allowlist would have hidden.
    const fakeJwt = [
      'eyJhbGciOiJIUzI1NiJ9',
      'eyJzdWIiOiJ1c2VyIn0',
      'c2lnbmF0dXJl',
    ].join('.');
    const line = JSON.stringify({
      event: 'auth.transport.failure',
      error: 'Authorization: Bearer sk-live-must-not-ship',
      jwt: fakeJwt,
    });
    const serialized = JSON.stringify(
      buildDiagnosticsReport(
        input({ readLog: logReader({ 'auth.jsonl': line }) })
      )
    );
    expect(serialized).not.toContain('sk-live-must-not-ship');
    expect(serialized).not.toContain(fakeJwt.split('.')[0]);
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

describe('ids derived from a server, in a report', () => {
  // What `deriveConnectedSourceId` mints for a guessable alias: anyone can
  // recompute it, so the raw id in a report names the server.
  const guessable = deriveConnectedSourceId({
    kind: 'ssh-alias',
    alias: 'prod',
    remotePort: 18789,
  });
  const coworker = `remote-${'a1'.repeat(12)}`;
  const logs = logReader({
    'connected-sources.jsonl': `${JSON.stringify({
      event: 'connected-sources.connect',
      sourceId: guessable,
      outcome: 'failed',
    })}\n`,
    'main.jsonl': `${JSON.stringify({
      event: 'renderer.error-boundary',
      pathname: `/agent/${coworker}`,
      message: `no mapping for ${guessable}`,
    })}\n`,
  });

  it('leaves the machine keyed to this install, in every log', () => {
    const report = buildDiagnosticsReport(input({ readLog: logs }));
    const text = JSON.stringify(report);
    expect(text).not.toContain(guessable);
    expect(text).not.toContain(coworker);

    const [act] = report.logs.find(
      log => log.name === 'connected-sources.jsonl'
    )!.lines as { sourceId: string }[];
    const [error] = report.logs.find(log => log.name === 'main.jsonl')!
      .lines as { pathname: string; message: string }[];
    expect(act.sourceId).toMatch(/^source~[0-9a-f]{12}$/);
    // The same id reads the same everywhere in the report, so lines still
    // correlate with each other.
    expect(error.message).toBe(`no mapping for ${act.sourceId}`);
    expect(error.pathname).toMatch(/^\/agent\/remote~[0-9a-f]{12}$/);
  });

  it('gives another install a pseudonym nobody can match to this one', () => {
    const ours = buildDiagnosticsReport(input({ readLog: logs }));
    const theirs = buildDiagnosticsReport(
      input({ readLog: logs, pseudonymKey: Buffer.alloc(32, 9) })
    );
    const idOf = (report: typeof ours) =>
      (
        report.logs.find(log => log.name === 'connected-sources.jsonl')!
          .lines[0] as { sourceId: string }
      ).sourceId;
    expect(idOf(ours)).not.toBe(idOf(theirs));
  });

  it('withholds the ids when this install has no key, rather than sending them', () => {
    const report = buildDiagnosticsReport(
      input({ readLog: logs, pseudonymKey: null })
    );
    const text = JSON.stringify(report);
    expect(text).not.toContain(guessable);
    expect(text).toContain('source~withheld');
    expect(text).toContain('remote~withheld');
  });
});

describe('the install key', () => {
  function scratch(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'exawatt-pseudonym-'));
  }

  it('is made once and read back the same', () => {
    const dir = scratch();
    const first = readOrCreatePseudonymKey(dir);
    expect(first).toHaveLength(32);
    expect(readOrCreatePseudonymKey(dir)).toEqual(first);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('answers null when the key cannot be read, never a fresh one', () => {
    const dir = scratch();
    // A key file that is a directory cannot be read and must not be replaced
    // by a key the next report would not share.
    fs.mkdirSync(path.join(dir, 'diagnostics-pseudonym.key'));
    expect(readOrCreatePseudonymKey(dir)).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetMainAnalyticsForTests,
  drainMainAnalyticsEvents,
} from './analytics-bridge';
import { installCrashAnalytics, openMainDiagnostics } from './main-diagnostics';

let userData: string;
beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'main-diagnostics-'));
  __resetMainAnalyticsForTests();
});
afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
});

describe('openMainDiagnostics', () => {
  it('records to logs/main.jsonl under userData', () => {
    const record = openMainDiagnostics(userData);
    record('renderer.port.fallback', { keptPort: 23456 });

    const [line] = fs
      .readFileSync(path.join(userData, 'logs', 'main.jsonl'), 'utf8')
      .trim()
      .split('\n');
    expect(JSON.parse(line)).toMatchObject({
      event: 'renderer.port.fallback',
      keptPort: 23456,
    });
  });

  it('degrades to a recorder that drops entries when the log cannot open', () => {
    const blocked = path.join(userData, 'a-file');
    fs.writeFileSync(blocked, '');

    const record = openMainDiagnostics(blocked);

    expect(() => record('anything')).not.toThrow();
  });
});

describe('installCrashAnalytics', () => {
  function fakeApp() {
    const app = Object.assign(new EventEmitter(), {
      getVersion: () => '0.1.13',
    });
    const proc = new EventEmitter();
    installCrashAnalytics(app as never, proc as never);
    return { app, proc };
  }

  it('queues one crash event per real crash, and none for an orderly exit', () => {
    const { app, proc } = fakeApp();

    app.emit('render-process-gone', {}, {}, { reason: 'clean-exit' });
    app.emit('render-process-gone', {}, {}, { reason: 'oom' });
    app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed' });
    proc.emit('uncaughtExceptionMonitor', new Error('boom'));

    expect(
      drainMainAnalyticsEvents().map(event => ({
        scope: (event as { scope?: string }).scope,
        reason: (event as { reason?: string }).reason,
      }))
    ).toEqual([
      { scope: 'renderer', reason: 'out_of_memory' },
      { scope: expect.any(String), reason: 'crashed' },
      { scope: 'main', reason: 'crashed' },
    ]);
  });
});

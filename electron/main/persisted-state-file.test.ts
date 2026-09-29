import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { configureJsonStoreDiagnostics } from './atomic-json-file';
import {
  UnreadableStateWatch,
  configureUnreadableStateNotice,
  jsonStateGrammar,
  readPersistedStateSync,
} from './persisted-state-file';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exawatt-persisted-state-'));
});
afterEach(() => {
  configureJsonStoreDiagnostics(() => {});
  configureUnreadableStateNotice(() => {});
  fs.chmodSync(dir, 0o700);
  fs.rmSync(dir, { recursive: true, force: true });
});

const grammar = jsonStateGrammar(value =>
  value && typeof value === 'object' ? value : null
);

it('damaged bytes that cannot be moved aside are unreadable, never fresh', () => {
  const file = path.join(dir, 'state.json');
  fs.writeFileSync(file, '{broken');
  fs.chmodSync(dir, 0o500);
  expect(readPersistedStateSync(file, grammar)).toEqual({
    status: 'unreadable',
    cause: { kind: 'io', code: 'EACCES' },
  });
  fs.chmodSync(dir, 0o700);
  expect(fs.readFileSync(file, 'utf8')).toBe('{broken');
});

it('logs the first failure, shows a failure that survives a retry once, and logs recovery', () => {
  const record = vi.fn();
  const notice = vi.fn();
  configureJsonStoreDiagnostics(record);
  configureUnreadableStateNotice(notice);
  const file = path.join(dir, 'state.json');
  const watch = new UnreadableStateWatch(file, 'usage history');
  const denied = { kind: 'io', code: 'EACCES' } as const;

  watch.failed(denied);
  expect(notice).not.toHaveBeenCalled();
  watch.failed(denied);
  watch.failed(denied);
  expect(notice).toHaveBeenCalledTimes(1);
  expect(notice).toHaveBeenCalledWith({
    file,
    label: 'usage history',
    detail: 'permission denied',
  });
  watch.recovered();

  expect(record.mock.calls).toEqual([
    [
      'store.read-unavailable',
      { store: 'state.json', cause: 'permission denied', attempt: 1 },
    ],
    ['store.read-recovered', { store: 'state.json', attempts: 3 }],
  ]);
  // Diagnostics name the store, never where it lives.
  expect(JSON.stringify(record.mock.calls)).not.toContain(dir);
});

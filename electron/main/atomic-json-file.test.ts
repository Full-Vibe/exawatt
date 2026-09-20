import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureJsonStoreDiagnostics,
  readJsonFile,
  recoverJsonFile,
  writeJsonFileAtomic,
  writeJsonFileAtomicAsync,
} from './atomic-json-file';

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exawatt-json-integrity-'));
  file = path.join(dir, 'store.json');
});
afterEach(() => {
  configureJsonStoreDiagnostics(() => {});
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('durable JSON integrity boundary', () => {
  it('distinguishes first use from saved state', () => {
    expect(readJsonFile(file)).toEqual({ status: 'absent' });
    writeJsonFileAtomic(file, { retained: true });
    expect(readJsonFile(file)).toEqual({
      status: 'ok',
      value: { retained: true },
    });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it.each(['{bad secret-token', 'null', '[]'])(
    'preserves invalid bytes and blocks subsequent writes: %s',
    async bytes => {
      const record = vi.fn();
      configureJsonStoreDiagnostics(record);
      fs.writeFileSync(file, bytes);
      const result = readJsonFile(file);
      expect(result.status).toBe('corrupt');
      if (result.status !== 'corrupt') throw new Error('expected corruption');
      expect(fs.readFileSync(result.recoveryFile, 'utf8')).toBe(bytes);
      expect(fs.statSync(result.recoveryFile).mode & 0o777).toBe(0o600);
      expect(JSON.stringify(record.mock.calls)).not.toContain(bytes);
      expect(record).toHaveBeenCalledOnce();
      expect(() => writeJsonFileAtomic(file, {})).toThrow(/needs recovery/);
      await expect(writeJsonFileAtomicAsync(file, {})).rejects.toThrow(
        /needs recovery/
      );
      expect(readJsonFile(file).status).toBe('corrupt');
      expect(fs.existsSync(file)).toBe(false);
      // An explicit repair must restore a valid document AND acknowledge the marker.
      fs.writeFileSync(file, '{"recovered":true}');
      expect(() => writeJsonFileAtomic(file, {})).toThrow(/needs recovery/);
      recoverJsonFile(file, 'retry');
      expect(readJsonFile(file)).toEqual({
        status: 'ok',
        value: { recovered: true },
      });
    }
  );

  it('a write without an earlier read cannot erase existing damage', () => {
    fs.writeFileSync(file, '{broken');
    expect(() => writeJsonFileAtomic(file, {})).toThrow(/needs recovery/);
    expect(
      fs.readdirSync(dir).filter(name => name.includes('.corrupt-'))
    ).toHaveLength(1);
  });

  it('does not call unreadable storage missing or corrupt', () => {
    fs.mkdirSync(file);
    expect(() => readJsonFile(file)).toThrow();
    expect(fs.existsSync(`${file}.recovery-required`)).toBe(false);
  });
});

it('explicit recovery cannot acknowledge missing or invalid repairs; reset retains all evidence', () => {
  fs.writeFileSync(file, '{original broken');
  const original = readJsonFile(file);
  if (original.status !== 'corrupt') throw new Error('expected corruption');
  expect(() => recoverJsonFile(file, 'retry')).toThrow(/needs recovery/);
  fs.writeFileSync(file, '{repair still broken');
  expect(() => recoverJsonFile(file, 'retry')).toThrow(/needs recovery/);
  recoverJsonFile(file, 'reset');
  expect(readJsonFile(file)).toEqual({ status: 'absent' });
  expect(fs.readFileSync(original.recoveryFile, 'utf8')).toBe(
    '{original broken'
  );
  const savedRepair = fs
    .readdirSync(dir)
    .find(name => name.includes('.before-reset-'));
  expect(savedRepair).toBeDefined();
  expect(fs.readFileSync(path.join(dir, savedRepair!), 'utf8')).toBe(
    '{repair still broken'
  );
  writeJsonFileAtomic(file, { explicitlyStartedFresh: true });
});

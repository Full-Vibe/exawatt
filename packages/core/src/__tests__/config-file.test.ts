import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  describeUnreadableConfig,
  readConfigFile,
  readConfigFileSync,
  type ConfigFileGrammar,
} from '../config-file';

const JSON_OBJECT: ConfigFileGrammar<Record<string, unknown>> = {
  name: 'JSON',
  parse: text => {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  },
};

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.chmodSync(dir, 0o700);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function scratch(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exawatt-config-file-'));
  dirs.push(dir);
  return dir;
}

const readers = [
  ['sync', readConfigFileSync],
  ['async', readConfigFile],
] as const;

describe.each(readers)('the %s config file read', (_mode, read) => {
  it('reads what the grammar accepts', async () => {
    const file = path.join(scratch(), 'settings.json');
    fs.writeFileSync(file, '{"model": "a"}');
    expect(await read(file, JSON_OBJECT)).toEqual({
      status: 'ok',
      value: { model: 'a' },
    });
  });

  it('says missing for no file, and for a parent that is not a directory', async () => {
    const dir = scratch();
    expect(await read(path.join(dir, 'none.json'), JSON_OBJECT)).toEqual({
      status: 'missing',
    });
    fs.writeFileSync(path.join(dir, '.claude'), '');
    expect(
      await read(path.join(dir, '.claude', 'settings.json'), JSON_OBJECT)
    ).toEqual({ status: 'missing' });
  });

  it('never says missing for a file it could not read', async () => {
    const dir = scratch();
    const rejected = path.join(dir, 'rejected.json');
    fs.writeFileSync(rejected, '{"model": ');
    expect(await read(rejected, JSON_OBJECT)).toEqual({
      status: 'unreadable',
      cause: { kind: 'rejected', grammar: 'JSON' },
    });

    const directory = path.join(dir, 'directory.json');
    fs.mkdirSync(directory);
    expect(await read(directory, JSON_OBJECT)).toEqual({
      status: 'unreadable',
      cause: { kind: 'not-a-file' },
    });

    const large = path.join(dir, 'large.json');
    fs.writeFileSync(large, '{"a": 1}');
    expect(await read(large, { ...JSON_OBJECT, maxBytes: 4 })).toEqual({
      status: 'unreadable',
      cause: { kind: 'too-large', limitBytes: 4 },
    });
  });

  it.skipIf(process.getuid?.() === 0)(
    'says unreadable for a file it has no permission to open',
    async () => {
      const file = path.join(scratch(), 'locked.json');
      fs.writeFileSync(file, '{}');
      fs.chmodSync(file, 0o000);
      const result = await read(file, JSON_OBJECT);
      expect(result).toEqual({
        status: 'unreadable',
        cause: { kind: 'io', code: 'EACCES' },
      });
      if (result.status === 'unreadable') {
        expect(describeUnreadableConfig(result.cause)).toBe(
          'permission denied'
        );
      }
    }
  );
});

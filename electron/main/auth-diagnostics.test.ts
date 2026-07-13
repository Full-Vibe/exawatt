import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPersistentAuthDiagnostics,
  describeAuthError,
  instrumentAuthFetch,
} from './auth-diagnostics';

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Electron auth diagnostics', () => {
  it('records request shape and nested transport failures without secrets', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'exawatt-auth-log-'));
    tempDirs.push(directory);
    const logPath = join(directory, 'auth.jsonl');
    const record = createPersistentAuthDiagnostics({
      logPath,
      context: { buildSha: 'test-sha' },
    });
    const nested = Object.assign(new Error('connect code=super-secret-code'), {
      code: 'EBADF',
    });
    const aggregate = new AggregateError([nested], 'fetch failed', {
      cause: nested,
    });
    const transport = vi.fn().mockRejectedValue(aggregate);
    const fetch = instrumentAuthFetch(
      transport as typeof globalThis.fetch,
      record,
      'electron.net.fetch'
    );

    await expect(
      fetch('https://project.supabase.co/auth/v1/token?grant_type=pkce', {
        method: 'POST',
        headers: {
          authorization: 'Bearer should-never-be-logged',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          auth_code: 'should-never-be-logged',
          code_verifier: 'should-never-be-logged',
        }),
      })
    ).rejects.toThrow('fetch failed');

    const contents = readFileSync(logPath, 'utf8');
    const entries = contents
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    expect(entries.map(entry => entry.event)).toEqual([
      'auth.transport.request',
      'auth.transport.failure',
    ]);
    expect(entries[0]).toMatchObject({
      buildSha: 'test-sha',
      transport: 'electron.net.fetch',
      host: 'project.supabase.co',
      path: '/auth/v1/token',
      queryNames: ['grant_type'],
      method: 'POST',
      headerNames: ['authorization', 'content-type'],
      bodyType: 'string',
      bodyByteLength: expect.any(Number),
    });
    expect(entries[1].error).toMatchObject({
      name: 'AggregateError',
      message: 'fetch failed',
      cause: { code: 'EBADF' },
      errors: [{ code: 'EBADF' }],
    });
    expect(contents).not.toContain('should-never-be-logged');
    expect(contents).not.toContain('super-secret-code');
  });

  it('bounds and rotates the persistent log', () => {
    const directory = mkdtempSync(join(tmpdir(), 'exawatt-auth-log-'));
    tempDirs.push(directory);
    const logPath = join(directory, 'auth.jsonl');
    const record = createPersistentAuthDiagnostics({
      logPath,
      context: {},
      maxBytes: 180,
    });

    record('auth.first', { detail: 'a'.repeat(80) });
    record('auth.second', { detail: 'b'.repeat(80) });

    expect(readFileSync(`${logPath}.1`, 'utf8')).toContain('auth.first');
    expect(readFileSync(logPath, 'utf8')).toContain('auth.second');
  });

  it('preserves useful AggregateError fields recursively', () => {
    const cause = Object.assign(new Error('socket unavailable'), {
      code: 'EBADF',
      errno: -9,
      syscall: 'connect',
    });
    const error = new AggregateError([cause], 'fetch failed', { cause });

    expect(describeAuthError(error)).toMatchObject({
      name: 'AggregateError',
      message: 'fetch failed',
      cause: { code: 'EBADF', errno: -9, syscall: 'connect' },
      errors: [{ code: 'EBADF', errno: -9, syscall: 'connect' }],
    });
  });
});

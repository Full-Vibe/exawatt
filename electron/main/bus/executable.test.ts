import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { BUS_EXECUTABLE_NAME, installBusExecutable } from './executable';

/**
 * The real `exawatt` script, run by the real `sh` and `curl`, against a
 * loopback server standing in for the channel.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

async function installed(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bus-bin-'));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  expect(await installBusExecutable(dir)).toBe(dir);
  return path.join(dir, BUS_EXECUTABLE_NAME);
}

async function server(status = 200, text = 'ok\n') {
  const requests: { url: string; token: string; body: string }[] = [];
  const listener = http.createServer((request, response) => {
    let body = '';
    request.on('data', chunk => (body += chunk));
    request.on('end', () => {
      requests.push({
        url: request.url ?? '',
        token: String(request.headers['x-exawatt-token']),
        body,
      });
      response.writeHead(status, { 'content-type': 'text/plain' });
      response.end(text);
    });
  });
  await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => listener.close());
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return { port: address.port, requests };
}

function run(
  script: string,
  args: string[],
  env: Record<string, string>,
  stdin?: string
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(script, args, {
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => (stdout += chunk));
    child.stderr.on('data', chunk => (stderr += chunk));
    child.on('close', code => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin ?? '');
  });
}

describe('the exawatt command', () => {
  it('is installed owner-only and executable', async () => {
    const script = await installed();
    expect(fs.statSync(script).mode & 0o777).toBe(0o700);
  });

  it('sends the recipient and the message with the Session’s token', async () => {
    const script = await installed();
    const channel = await server(200, 'Sent to @codex-2: delivered.\n');
    const result = await run(
      script,
      ['send', '@codex-2', 'review', 'the "diff" $HOME\\n'],
      {
        EXAWATT_BUS_PORT: String(channel.port),
        EXAWATT_BUS_TOKEN: 'tok-1',
      }
    );
    expect(result).toMatchObject({
      code: 0,
      stdout: 'Sent to @codex-2: delivered.\n',
    });
    expect(channel.requests).toEqual([
      {
        url: '/bus/send',
        token: 'tok-1',
        body: '@codex-2\nreview the "diff" $HOME\\n',
      },
    ]);
  });

  it('takes a multi-line message on stdin', async () => {
    const script = await installed();
    const channel = await server();
    await run(
      script,
      ['send', '@codex-2'],
      { EXAWATT_BUS_PORT: String(channel.port), EXAWATT_BUS_TOKEN: 't' },
      'one\ntwo\n'
    );
    expect(channel.requests[0].body).toBe('@codex-2\none\ntwo\n');
  });

  it('exits non-zero with the bus’s reason when a send is refused', async () => {
    const script = await installed();
    const channel = await server(409, 'Not sent: no such Agent.\n');
    const result = await run(script, ['send', '@nobody', 'hi'], {
      EXAWATT_BUS_PORT: String(channel.port),
      EXAWATT_BUS_TOKEN: 't',
    });
    expect(result.code).not.toBe(0);
    expect(result.stdout).toContain('Not sent: no such Agent.');
  });

  it('says so, and sends nothing, outside an Exawatt Session or with Exawatt closed', async () => {
    const script = await installed();
    const outside = await run(script, ['agents'], {});
    expect(outside.code).toBe(69);
    expect(outside.stderr).toMatch(/not started by Exawatt/);
    const closed = await run(script, ['agents'], {
      EXAWATT_BUS_PORT: '1',
      EXAWATT_BUS_TOKEN: 't',
    });
    expect(closed.code).toBe(69);
    expect(closed.stderr).toMatch(/Exawatt is not running/);
  });
});

import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import { builtinModules } from 'module';
import os from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import { installBusMcpServer } from './executable';
import {
  BUS_MCP_TOOLS,
  busHttpCall,
  createBusMcpHandler,
  serveBusMcp,
  type BusMcpCall,
} from './mcp-server';

/**
 * The bus's MCP door (ENG-029 B2): the contract is that every tool is the
 * `exawatt` command's own request on the same loopback path with the same
 * token, and that the shipped file runs on its own.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

/** A fake bus: records each request and answers it. */
function fakeBus(
  answer: { status: number; text: string } = { status: 200, text: 'ok\n' }
) {
  const calls: { verb: string; body: string }[] = [];
  const call: BusMcpCall = async (verb, body) => {
    calls.push({ verb, body });
    return answer;
  };
  return { calls, call };
}

const request = (id: number, method: string, params?: unknown) => ({
  jsonrpc: '2.0' as const,
  id,
  method,
  ...(params === undefined ? {} : { params }),
});
const callTool = (name: string, args: Record<string, unknown> = {}) =>
  request(9, 'tools/call', { name, arguments: args });

function toolNamed(fragment: string): string {
  const tool = BUS_MCP_TOOLS.find(item => item.name.includes(fragment));
  if (!tool) throw new Error(`no ${fragment} tool`);
  return tool.name;
}
const SEND = toolNamed('send');
const LIST = toolNamed('list');
const INBOX = toolNamed('inbox');

describe('the MCP tools over the bus', () => {
  it('lists three tools, each with a plain description and an object schema', async () => {
    const answer = (await createBusMcpHandler(
      fakeBus().call,
      '1'
    )(request(1, 'tools/list'))) as { result: { tools: typeof BUS_MCP_TOOLS } };
    const tools = answer.result.tools;
    expect(new Set(tools.map(tool => tool.name)).size).toBe(3);
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('sends with the exawatt command’s own request: recipient line, then the message', async () => {
    const bus = fakeBus({ status: 200, text: 'Sent to @codex-2: queued.\n' });
    const answer = await createBusMcpHandler(
      bus.call,
      '1'
    )(callTool(SEND, { to: ' @codex-2 ', message: 'line one\nline two' }));
    expect(bus.calls).toEqual([
      { verb: 'send', body: '@codex-2\nline one\nline two' },
    ]);
    expect(answer).toEqual({
      jsonrpc: '2.0',
      id: 9,
      result: {
        content: [{ type: 'text', text: 'Sent to @codex-2: queued.' }],
      },
    });
  });

  it('reads the directory and the inbox through their own verbs', async () => {
    const bus = fakeBus();
    const handle = createBusMcpHandler(bus.call, '1');
    await handle(callTool(LIST));
    await handle(callTool(INBOX));
    expect(bus.calls.map(item => item.verb)).toEqual(['agents', 'inbox']);
  });

  it('reports a refused send as a tool error carrying the bus’s reason', async () => {
    const bus = fakeBus({
      status: 409,
      text: 'Not sent: No Agent named @nobody.\n',
    });
    const answer = (await createBusMcpHandler(
      bus.call,
      '1'
    )(callTool(SEND, { to: '@nobody', message: 'hi' }))) as {
      result: { isError?: boolean; content: { text: string }[] };
    };
    expect(answer.result.isError).toBe(true);
    expect(answer.result.content[0].text).toContain('No Agent named @nobody');
  });

  it('sends nothing when the recipient or the message is missing or malformed', async () => {
    const bus = fakeBus();
    const handle = createBusMcpHandler(bus.call, '1');
    for (const args of [
      { message: 'hi' },
      { to: '', message: 'hi' },
      { to: '@a\n@b', message: 'hi' },
      { to: '@a', message: '   ' },
      { to: '@a', message: 7 },
    ]) {
      const answer = (await handle(callTool(SEND, args))) as {
        result: { isError?: boolean };
      };
      expect(answer.result.isError).toBe(true);
    }
    expect(bus.calls).toEqual([]);
  });

  it('says so outside an Exawatt launch, with Exawatt closed, and for an unknown tool', async () => {
    const outside = (await createBusMcpHandler(null, '1')(callTool(LIST))) as {
      result: { isError?: boolean; content: { text: string }[] };
    };
    expect(outside.result).toMatchObject({ isError: true });
    expect(busHttpCall({})).toBeNull();
    expect(
      busHttpCall({ EXAWATT_BUS_PORT: 'x', EXAWATT_BUS_TOKEN: 't' })
    ).toBeNull();
    // A port nothing listens on: refused, never a hang or a success.
    const closed = (await createBusMcpHandler(
      busHttpCall({ EXAWATT_BUS_PORT: '1', EXAWATT_BUS_TOKEN: 't' }),
      '1'
    )(callTool(SEND, { to: '@a', message: 'hi' }))) as {
      result: { isError?: boolean };
    };
    expect(closed.result.isError).toBe(true);
    const unknown = (await createBusMcpHandler(
      fakeBus().call,
      '1'
    )(callTool('rm_rf'))) as { result: { isError?: boolean } };
    expect(unknown.result.isError).toBe(true);
  });

  it('speaks the protocol: version negotiation, ping, notifications, unknown methods', async () => {
    const handle = createBusMcpHandler(fakeBus().call, '1.2.3');
    const known = (await handle(
      request(1, 'initialize', { protocolVersion: '2025-06-18' })
    )) as { result: { protocolVersion: string; capabilities: unknown } };
    expect(known.result.protocolVersion).toBe('2025-06-18');
    expect(known.result.capabilities).toEqual({ tools: {} });
    const future = (await handle(
      request(2, 'initialize', { protocolVersion: '2099-01-01' })
    )) as { result: { protocolVersion: string } };
    expect(future.result.protocolVersion).not.toBe('2099-01-01');
    expect(await handle(request(3, 'ping'))).toMatchObject({ result: {} });
    expect(
      await handle({ jsonrpc: '2.0', method: 'notifications/initialized' })
    ).toBeNull();
    expect(await handle(request(4, 'resources/list'))).toMatchObject({
      error: { code: -32601 },
    });
  });

  it('answers each stdio line once, and a line that is not JSON with a parse error', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let written = '';
    output.on('data', chunk => (written += chunk));
    const served = serveBusMcp(
      input,
      output,
      createBusMcpHandler(fakeBus().call, '1')
    );
    input.write(`${JSON.stringify(request(1, 'ping'))}\nnot json\n`);
    input.end(JSON.stringify(request(2, 'ping')));
    await served;
    const lines = written
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    expect(lines.map(line => line.id).sort()).toEqual([1, 2, null].sort());
    expect(lines.find(line => line.id === null).error.code).toBe(-32700);
  });
});

describe('the shipped MCP server', () => {
  it('imports nothing but Node built-ins, so its compiled file runs on its own', () => {
    const source = fs.readFileSync(
      path.join(__dirname, 'mcp-server.ts'),
      'utf8'
    );
    // The compiler's own reading of the file, never a pattern over text.
    const imports = ts
      .preProcessFile(source, true, true)
      .importedFiles.map(file => file.fileName);
    expect(imports.length).toBeGreaterThan(0);
    for (const name of imports) expect(builtinModules).toContain(name);
  });

  it('runs as a separate process over stdio and reaches the bus with the launch’s token', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bus-mcp-'));
    cleanups.push(() => fs.rmSync(work, { recursive: true, force: true }));
    // The compiled form main copies out of the app: CommonJS from tsc.
    const compiled = path.join(work, 'mcp-server.js');
    fs.writeFileSync(
      compiled,
      ts.transpileModule(
        fs.readFileSync(path.join(__dirname, 'mcp-server.ts'), 'utf8'),
        {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true,
          },
        }
      ).outputText
    );
    const script = await installBusMcpServer(path.join(work, 'bin'), compiled);
    expect(script).not.toBeNull();
    expect(fs.statSync(script!).mode & 0o777).toBe(0o600);

    const requests: { url: string; token: string; body: string }[] = [];
    const bus = http.createServer((incoming, response) => {
      let body = '';
      incoming.on('data', chunk => (body += chunk));
      incoming.on('end', () => {
        requests.push({
          url: incoming.url ?? '',
          token: String(incoming.headers['x-exawatt-token']),
          body,
        });
        response.end('Sent to @codex-2: delivered.\n');
      });
    });
    await new Promise<void>(resolve => bus.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => bus.close());
    const address = bus.address();
    if (!address || typeof address === 'string') throw new Error('no port');

    const child = spawn(process.execPath, [script!, '9.9.9'], {
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        EXAWATT_BUS_PORT: String(address.port),
        EXAWATT_BUS_TOKEN: 'launch-token',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', chunk => (stdout += chunk));
    const exited = new Promise<number | null>(resolve =>
      child.on('close', resolve)
    );
    child.stdin.end(
      [
        request(1, 'initialize', { protocolVersion: '2025-06-18' }),
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        callTool(SEND, { to: '@codex-2', message: 'hello' }),
      ]
        .map(message => JSON.stringify(message))
        .join('\n') + '\n'
    );
    expect(await exited).toBe(0);
    const lines = stdout
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    expect(lines.map(line => line.id)).toEqual([1, 9]);
    expect(lines[0].result.serverInfo.version).toBe('9.9.9');
    expect(lines[1].result.content[0].text).toBe(
      'Sent to @codex-2: delivered.'
    );
    expect(requests).toEqual([
      { url: '/bus/send', token: 'launch-token', body: '@codex-2\nhello' },
    ]);
  });
});

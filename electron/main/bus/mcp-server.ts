/**
 * The Exawatt MCP server (ENG-029 B2): the bus's second outbound door, beside
 * the `exawatt` command. Same three verbs, same loopback paths, same
 * Session token, so there is one implementation of send and this is only
 * another way in: the tools land in the model's own tool list instead of
 * being learned from a prompt, and a harness reaches them over stdio, which a
 * shell sandbox with network turned off (Codex's workspace-write, measured
 * 2026-10-15) does not stand between.
 *
 * Self-contained by contract: Node built-ins only. Exawatt copies this file's
 * compiled form into its own state at startup and each harness runs it with
 * Exawatt's own executable as Node (`ELECTRON_RUN_AS_NODE`), so the packaged
 * app ships no interpreter and no build toolchain for it (BUG-030). The
 * file carries no secret: the port, the token and the Session's address
 * arrive in the server's environment from the per-launch declaration.
 */
import http from 'http';

export const BUS_MCP_SERVER_NAME = 'exawatt';

/** The send tool's name, which a stamped message names as the way to reply. */
export const BUS_MCP_SEND_TOOL = 'exawatt_send_message';

/** The MCP revisions this server speaks; the tool surface is the same in
 *  each. A client asking for another gets the newest, and decides. */
const PROTOCOL_VERSIONS = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
];

/** Matches the `exawatt` command's own limit. */
const REQUEST_TIMEOUT_MS = 30_000;

type BusVerb = 'agents' | 'send' | 'inbox';

/** One request to the bus: what the `exawatt` command posts, answered in
 *  the plain text an Agent reads. */
export type BusMcpCall = (
  verb: BusVerb,
  body: string
) => Promise<{ status: number; text: string }>;

interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: 'string'; description: string }>;
    required?: string[];
    additionalProperties: false;
  };
}

/**
 * Written for a model choosing a tool when asked to message another agent:
 * plain words, no Exawatt vocabulary it has never seen (the B0 probe watched
 * Antigravity miss a tool asked for generically and find it when named).
 */
export const BUS_MCP_TOOLS: readonly ToolDefinition[] = [
  {
    name: 'exawatt_list_agents',
    title: 'List the agents in this project',
    description:
      'List the other agents working in this project that you can message (separate Claude Code, Codex or Antigravity sessions, not your own subagents), with the @name to address each one by.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: BUS_MCP_SEND_TOOL,
    title: 'Send a message to another agent',
    description:
      'Send a message to another agent working in this project: a separate Claude Code, Codex or Antigravity session addressed by its @name, such as @codex-2 (not one of your own subagents). It arrives right away; when that agent replies, the reply arrives in this conversation. Use exawatt_list_agents to see who you can message.',
    inputSchema: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description:
            'The agent to message: its @name (for example @codex-2) or its session id.',
        },
        message: {
          type: 'string',
          description: 'The message, as you would write it to a colleague.',
        },
      },
      required: ['to', 'message'],
      additionalProperties: false,
    },
  },
  {
    name: 'exawatt_read_inbox',
    title: 'Read messages from other agents',
    description:
      'Read the messages other agents in this project have sent you, oldest first.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
];

const INSTRUCTIONS =
  'These tools message the other agents working in this project. ' +
  'When you are asked to talk to, ask, tell or hand work to another agent, ' +
  'call exawatt_list_agents to find it and exawatt_send_message to reach it. Messages from ' +
  'other agents arrive in this conversation beginning with "[Exawatt] Message from".';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method?: unknown;
  params?: unknown;
}

type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | {
      jsonrpc: '2.0';
      id: string | number | null;
      error: { code: number; message: string };
    };

interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

function textResult(text: string, isError = false): ToolResult {
  return {
    content: [{ type: 'text', text: text.replace(/\n+$/, '') }],
    ...(isError ? { isError: true } : {}),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function callTool(
  call: BusMcpCall | null,
  name: unknown,
  args: Record<string, unknown>
): Promise<ToolResult> {
  if (!BUS_MCP_TOOLS.some(tool => tool.name === name)) {
    return textResult(`There is no tool named ${String(name)}.`, true);
  }
  if (!call) {
    return textResult(
      'This agent was not started by Exawatt, so it cannot reach other agents.',
      true
    );
  }
  let verb: BusVerb;
  let body = '';
  if (name === BUS_MCP_SEND_TOOL) {
    const to = typeof args.to === 'string' ? args.to.trim() : '';
    const message = typeof args.message === 'string' ? args.message : '';
    if (!to || /[\r\n]/.test(to)) {
      return textResult(
        'Say who the message is for in "to": an @name from exawatt_list_agents, such as @codex-2.',
        true
      );
    }
    if (!message.trim()) {
      return textResult('The message is empty, so nothing was sent.', true);
    }
    verb = 'send';
    // The bus's own request shape, the one `exawatt send` posts: the
    // recipient on the first line, the message after it.
    body = `${to}\n${message}`;
  } else {
    verb = name === 'exawatt_list_agents' ? 'agents' : 'inbox';
  }
  try {
    const answer = await call(verb, body);
    return textResult(answer.text, answer.status !== 200);
  } catch (error) {
    return textResult(
      (error as NodeJS.ErrnoException)?.code === 'ECONNREFUSED'
        ? 'Exawatt is not running, so nothing was sent.'
        : `Exawatt could not be reached: ${error instanceof Error ? error.message : String(error)}`,
      true
    );
  }
}

/**
 * Answer one JSON-RPC message. A notification (no id) gets no answer; every
 * request gets exactly one.
 */
export function createBusMcpHandler(
  call: BusMcpCall | null,
  version: string
): (message: unknown) => Promise<JsonRpcResponse | null> {
  return async message => {
    const request = record(message) as JsonRpcRequest | null;
    if (!request || request.jsonrpc !== '2.0') {
      return {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid request' },
      };
    }
    const id = request.id;
    if (id === undefined) return null;
    const params = record(request.params) ?? {};
    const ok = (result: unknown): JsonRpcResponse => ({
      jsonrpc: '2.0',
      id,
      result,
    });
    switch (request.method) {
      case 'initialize': {
        const asked = params.protocolVersion;
        return ok({
          protocolVersion:
            typeof asked === 'string' && PROTOCOL_VERSIONS.includes(asked)
              ? asked
              : PROTOCOL_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: BUS_MCP_SERVER_NAME, title: 'Exawatt', version },
          instructions: INSTRUCTIONS,
        });
      }
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({ tools: BUS_MCP_TOOLS });
      case 'tools/call':
        return ok(
          await callTool(call, params.name, record(params.arguments) ?? {})
        );
      default:
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${String(request.method)}`,
          },
        };
    }
  };
}

/** The bus over the loopback channel, from the launch environment; null
 *  when this process was not started by Exawatt. */
export function busHttpCall(env: NodeJS.ProcessEnv): BusMcpCall | null {
  const port = Number(env.EXAWATT_BUS_PORT);
  const token = env.EXAWATT_BUS_TOKEN;
  if (!Number.isInteger(port) || port <= 0 || port > 65535 || !token) {
    return null;
  }
  return (verb, body) =>
    new Promise((resolve, reject) => {
      const request = http.request(
        {
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: `/bus/${verb}`,
          headers: {
            'x-exawatt-token': token,
            'content-type': 'text/plain; charset=utf-8',
            'content-length': Buffer.byteLength(body),
          },
          timeout: REQUEST_TIMEOUT_MS,
        },
        response => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () =>
            resolve({
              status: response.statusCode ?? 0,
              text: Buffer.concat(chunks).toString('utf8'),
            })
          );
          response.on('error', reject);
        }
      );
      request.on('timeout', () =>
        request.destroy(new Error('Exawatt did not answer in time.'))
      );
      request.on('error', reject);
      request.end(body);
    });
}

/**
 * Serve MCP over stdio: one JSON-RPC message per line in, one per line out.
 * Resolves when the input ends and every answer has been written.
 */
export function serveBusMcp(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
  handle: (message: unknown) => Promise<JsonRpcResponse | null>
): Promise<void> {
  return new Promise(resolve => {
    const pending = new Set<Promise<void>>();
    let buffered = '';
    const write = (response: JsonRpcResponse | null) => {
      if (response) output.write(`${JSON.stringify(response)}\n`);
    };
    const line = (text: string) => {
      if (!text.trim()) return;
      let message: unknown;
      try {
        message = JSON.parse(text);
      } catch {
        write({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        });
        return;
      }
      const answered = handle(message).then(write, error =>
        write({
          jsonrpc: '2.0',
          id: record(message)?.id as string | number | null,
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : String(error),
          },
        })
      );
      pending.add(answered);
      void answered.finally(() => pending.delete(answered));
    };
    input.setEncoding('utf8');
    input.on('data', (chunk: string) => {
      buffered += chunk;
      let newline = buffered.indexOf('\n');
      while (newline >= 0) {
        line(buffered.slice(0, newline));
        buffered = buffered.slice(newline + 1);
        newline = buffered.indexOf('\n');
      }
    });
    input.on('end', () => {
      line(buffered);
      void Promise.all(pending).then(() => resolve());
    });
  });
}

/** Run as the harness's MCP server: `<Exawatt> exawatt-mcp.cjs [version]`. */
if (
  typeof require !== 'undefined' &&
  typeof module !== 'undefined' &&
  require.main === module
) {
  void serveBusMcp(
    process.stdin,
    process.stdout,
    createBusMcpHandler(busHttpCall(process.env), process.argv[2] || '0')
  ).then(() => process.exit(0));
}

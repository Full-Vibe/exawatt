import { createHash } from 'node:crypto';
import { WebSocketServer } from 'ws';

const FIXTURE_NOW = 1_787_000_000_000;

function deviceToken(deviceId, scopes) {
  return `fixture-${createHash('sha256')
    .update(`${deviceId}\0${[...scopes].sort().join(',')}`)
    .digest('hex')
    .slice(0, 32)}`;
}

function response(socket, request, payload) {
  socket.send(
    JSON.stringify({
      type: 'res',
      id: request.id,
      ok: true,
      payload,
    })
  );
}

function refusal(socket, request, message) {
  socket.send(
    JSON.stringify({
      type: 'res',
      id: request.id,
      ok: false,
      error: { code: 'FORBIDDEN', message },
    })
  );
}

function event(socket, name, payload) {
  socket.send(JSON.stringify({ type: 'event', event: name, payload }));
}

/**
 * A protocol-level OpenClaw Gateway fixture for the packaged fleet gate.
 *
 * This is intentionally outside Electron. The app still creates its real
 * OCClient, real connected-source runtime, real encrypted device credential,
 * and real preload/IPC bridge. The fixture owns only the peer at the far side
 * of the WebSocket, which is the one dependency a hermetic run cannot borrow
 * from the operator's servers.
 */
export class ConnectedGatewayFixture {
  constructor({ label, agents, sharedToken = 'fixture-shared-token' }) {
    this.label = label;
    this.agents = agents.map(agent => ({
      ...agent,
      contexts: agent.hasPrimaryConversation
        ? [
            {
              key: `agent:${agent.id}:main`,
              kind: 'direct',
              sessionId: `${agent.id}-main`,
              hasActiveRun: false,
              createdAt: FIXTURE_NOW - 86_400_000,
              updatedAt: FIXTURE_NOW - 60_000,
            },
          ]
        : [
            {
              key: `agent:${agent.id}:cron:fixture-sweep`,
              kind: 'direct',
              sessionId: `${agent.id}-cron-fixture-sweep`,
              hasActiveRun: false,
              createdAt: FIXTURE_NOW - 86_400_000,
              updatedAt: FIXTURE_NOW - 60_000,
            },
          ],
    }));
    this.sharedToken = sharedToken;
    this.devices = new Map();
    this.connections = new Map();
    this.history = new Map();
    this.receivedMessages = [];
    this.authenticationModes = [];
    this.writeApproved = false;
    this.server = null;
    this.port = null;
    this.runCounter = 0;

    for (const agent of this.agents) {
      if (!agent.hasPrimaryConversation) continue;
      const key = `agent:${agent.id}:main`;
      this.history.set(key, [
        {
          role: 'user',
          content: `Initial question for ${agent.name}`,
          timestamp: FIXTURE_NOW - 120_000,
        },
        {
          role: 'assistant',
          content: `${agent.name} is ready on ${this.label}.`,
          timestamp: FIXTURE_NOW - 60_000,
          runId: `${agent.id}-fixture-initial`,
        },
      ]);
    }
  }

  async start(port = 0) {
    if (this.server) return this.port;
    const server = new WebSocketServer({ host: '127.0.0.1', port });
    this.server = server;
    server.on('connection', socket => this.accept(socket));
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error(`${this.label} fixture has no loopback address`);
    }
    this.port = address.port;
    return this.port;
  }

  approveWrite() {
    this.writeApproved = true;
  }

  async goAway() {
    const server = this.server;
    if (!server) return;
    this.server = null;
    for (const socket of this.connections.keys()) socket.terminate();
    this.connections.clear();
    await new Promise(resolve => server.close(resolve));
  }

  async comeBack() {
    if (this.server) return;
    if (this.port === null) throw new Error(`${this.label} never started`);
    await this.start(this.port);
  }

  async close() {
    await this.goAway();
  }

  accept(socket) {
    this.connections.set(socket, { scopes: [] });
    socket.on('close', () => this.connections.delete(socket));
    socket.on('error', () => undefined);
    socket.on('message', bytes => {
      let request;
      try {
        request = JSON.parse(String(bytes));
      } catch {
        return;
      }
      if (request?.type !== 'req' || typeof request.id !== 'string') return;
      void this.handle(socket, request);
    });
    event(socket, 'connect.challenge', {
      nonce: `${this.label}-fixture-nonce`,
      ts: FIXTURE_NOW,
    });
  }

  async handle(socket, request) {
    if (request.method === 'connect') {
      this.connect(socket, request);
      return;
    }
    const connection = this.connections.get(socket);
    if (!connection || connection.scopes.length === 0) {
      refusal(socket, request, 'unauthorized: connect first');
      return;
    }
    if (request.method === 'chat.send') {
      this.send(socket, request, connection);
      return;
    }
    try {
      response(socket, request, this.read(request.method, request.params));
    } catch (error) {
      refusal(
        socket,
        request,
        error instanceof Error ? error.message : 'fixture read failed'
      );
    }
  }

  connect(socket, request) {
    const params = request.params ?? {};
    const scopes = Array.isArray(params.scopes)
      ? params.scopes.filter(scope => typeof scope === 'string')
      : [];
    const deviceId = params.device?.id;
    if (typeof deviceId !== 'string' || !scopes.includes('operator.read')) {
      refusal(socket, request, 'unauthorized: invalid device or scope');
      return;
    }

    const auth = params.auth ?? {};
    const known = this.devices.get(deviceId);
    const shared = auth.token === this.sharedToken;
    const saved =
      known &&
      typeof auth.deviceToken === 'string' &&
      auth.deviceToken === known.token;
    this.authenticationModes.push(
      shared ? 'shared' : saved ? 'device' : 'none'
    );
    if (!shared && !saved) {
      refusal(socket, request, 'unauthorized: device token mismatch');
      return;
    }

    const asksWrite = scopes.includes('operator.write');
    if (asksWrite && !this.writeApproved) {
      refusal(
        socket,
        request,
        'pairing required: device is asking for more scopes than currently approved'
      );
      return;
    }
    if (
      known &&
      asksWrite &&
      !known.scopes.includes('operator.write') &&
      !shared
    ) {
      refusal(
        socket,
        request,
        'pairing required: approve scope upgrade and present the source credential'
      );
      return;
    }

    const granted = asksWrite
      ? ['operator.read', 'operator.write']
      : ['operator.read'];
    const token = deviceToken(deviceId, granted);
    this.devices.set(deviceId, { token, scopes: granted });
    this.connections.set(socket, { scopes: granted, deviceId });
    response(socket, request, {
      type: 'hello-ok',
      protocol: 4,
      policy: { tickIntervalMs: 1_000 },
      auth: { deviceToken: token },
    });
  }

  read(method, params = {}) {
    if (method === 'agents.list') {
      return {
        agents: this.agents.map(agent => ({ id: agent.id, name: agent.name })),
      };
    }
    if (method === 'sessions.list') {
      const agent = this.agents.find(
        candidate => candidate.id === params.agentId
      );
      return { sessions: agent?.contexts ?? [] };
    }
    if (method === 'cron.list') {
      return {
        jobs: this.agents
          .filter(agent => !agent.hasPrimaryConversation)
          .map(agent => ({
            name: 'fixture-sweep',
            agentId: agent.id,
            enabled: true,
            state: {
              lastStatus: 'ok',
              lastRunAtMs: FIXTURE_NOW - 60_000,
              sessionTarget: `agent:${agent.id}:cron:fixture-sweep`,
            },
          })),
      };
    }
    if (method === 'status') {
      return {
        version: 'fixture-openclaw-2026.8',
        tasks: {
          total: this.agents.length,
          active: 0,
          terminal: this.agents.length,
          failures: 0,
          byStatus: { succeeded: this.agents.length },
          byRuntime: { cron: this.agents.length },
        },
        taskAudit: { warnings: 0, errors: 0 },
      };
    }
    if (method === 'chat.history') {
      return {
        sessionKey: params.sessionKey,
        messages: this.history.get(params.sessionKey) ?? [],
      };
    }
    if (
      method === 'sessions.subscribe' ||
      method === 'sessions.unsubscribe' ||
      method === 'sessions.messages.subscribe' ||
      method === 'sessions.messages.unsubscribe' ||
      method === 'cron.runs' ||
      method === 'tasks.list' ||
      method === 'health'
    ) {
      return method === 'cron.runs'
        ? { runs: [] }
        : method === 'tasks.list'
          ? { tasks: [] }
          : { ok: true };
    }
    throw new Error(`fixture does not implement ${method}`);
  }

  send(socket, request, connection) {
    if (!connection.scopes.includes('operator.write')) {
      refusal(socket, request, 'FORBIDDEN: operator.write scope required');
      return;
    }
    const params = request.params ?? {};
    if (
      typeof params.message !== 'string' ||
      params.message.trim().length === 0 ||
      Object.hasOwn(params, 'text')
    ) {
      refusal(
        socket,
        request,
        'chat.send requires message and rejects the legacy text field'
      );
      return;
    }
    if (!this.history.has(params.sessionKey)) {
      refusal(socket, request, 'unknown primary conversation');
      return;
    }

    const runId = `${this.label}-run-${++this.runCounter}`;
    const reply = `${this.label} received: ${params.message}`;
    const history = this.history.get(params.sessionKey);
    history.push(
      {
        role: 'user',
        content: params.message,
        timestamp: FIXTURE_NOW + this.runCounter * 2,
      },
      {
        role: 'assistant',
        content: reply,
        timestamp: FIXTURE_NOW + this.runCounter * 2 + 1,
        runId,
      }
    );
    this.receivedMessages.push({
      sessionKey: params.sessionKey,
      message: params.message,
      idempotencyKey: params.idempotencyKey ?? null,
    });
    response(socket, request, { runId, status: 'ok' });
    queueMicrotask(() => {
      if (socket.readyState !== 1) return;
      event(socket, 'chat.segment', {
        sessionKey: params.sessionKey,
        runId,
        delta: reply,
        done: true,
      });
    });
  }
}

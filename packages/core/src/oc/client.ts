import { TypedEmitter, type CoreEventMap } from '../events/emitter';
import {
  generateDeviceKeypair,
  deriveDeviceId,
  buildDeviceAuthPayload,
  parseDeviceKeypair,
  signDevicePayload,
  type OCDeviceKeypair,
} from './auth';
import { MAX_PROTOCOL, MIN_PROTOCOL } from './protocol-types';
import type {
  OCRequest,
  OCResponse,
  OCEvent,
  OCConnectParams,
  OCHelloOk,
  OCConnectChallenge,
} from './protocol-types';

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface OCClientConfig {
  url: string;
  token?: string;
  password?: string;
  requestTimeoutMs?: number;
  reconnectDelayMs?: number;
  maxReconnectDelay?: number;
  clientId?: OCGatewayClientId;
  clientVersion?: string;
  clientPlatform?: string;
  clientMode?: OCGatewayClientMode;
  /**
   * Exact Gateway scopes requested by this client. Keep this narrow: a
   * shared Gateway secret may be able to grant much more than the surface
   * embedding this client should receive.
   */
  scopes?: readonly OCGatewayOperatorScope[];
  /**
   * The device identity to present, when the caller keeps one.
   *
   * Omitted means mint a fresh identity, which is right for a caller with
   * nowhere to keep one and wrong for every caller that persists a device
   * token. The Gateway derives the device id from the public key and binds
   * the token it issues to that id, so a caller that stores the token and
   * lets this client mint a new keypair presents a token belonging to a
   * device it no longer is, and every relaunch is refused with
   * "device token mismatch". Supply the keypair the token was issued to.
   */
  deviceKeypair?: OCDeviceKeypair;
}

/** Values accepted by OpenClaw protocol v3 (2026.6.11). */
export type OCGatewayClientId =
  | 'webchat-ui'
  | 'openclaw-control-ui'
  | 'openclaw-tui'
  | 'webchat'
  | 'cli'
  | 'gateway-client'
  | 'openclaw-macos'
  | 'openclaw-ios'
  | 'openclaw-android'
  | 'node-host'
  | 'test'
  | 'fingerprint'
  | 'openclaw-probe';

export type OCGatewayClientMode =
  | 'webchat'
  | 'cli'
  | 'test'
  | 'ui'
  | 'backend'
  | 'node'
  | 'probe';

export type OCGatewayOperatorScope =
  | 'operator.read'
  | 'operator.write'
  | 'operator.admin'
  | 'operator.approvals'
  | 'operator.pairing'
  | 'operator.talk.secrets';

export type OCConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

/**
 * The capability consumed by FleetManager and its adapters. Keeping this
 * structural lets Electron main own the real authenticated client while the
 * renderer holds only a bounded IPC capability with the same event/call
 * shape.
 */
export interface OCGatewayClient {
  call<R = unknown>(method: string, params?: unknown): Promise<R>;
  onOCEvent(eventName: string, handler: (payload: unknown) => void): void;
  offOCEvent(eventName: string, handler: (payload: unknown) => void): void;
  on<E extends keyof CoreEventMap>(
    event: E,
    handler: (data: CoreEventMap[E]) => void
  ): void;
  off<E extends keyof CoreEventMap>(
    event: E,
    handler: (data: CoreEventMap[E]) => void
  ): void;
}

export class OCClient extends TypedEmitter<CoreEventMap> {
  private ws: WebSocket | null = null;
  private status: OCConnectionStatus = 'disconnected';
  private pendingRequests = new Map<string, PendingRequest>();
  private requestCounter = 0;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = false;
  private keypair: OCDeviceKeypair | null = null;
  /**
   * Why the Gateway refused the last handshake, in its own words.
   *
   * Held for exactly as long as it takes `_setStatus` to reject the pending
   * `connect()`. A refusal arrives as a precise protocol sentence, and
   * replacing it with "connection failed" sends the operator to check a
   * Gateway that is perfectly healthy.
   */
  private handshakeFailure: Error | null = null;
  /**
   * The scoped credential the Gateway issues on a successful pairing.
   *
   * Public because custody lives outside this client: the caller persists it
   * to the OS keychain and presents it on the next launch so the
   * admin-capable shared secret is never read again. Keeping it private only
   * forced that caller to cast, which hid the seam rather than protecting it.
   *
   * It travels with `deviceKeypair` or it does not travel at all. The Gateway
   * binds the token to the device that asked for it, so a token persisted
   * without its keypair is refused on the next launch.
   */
  deviceToken: string | null = null;
  private _ocEventHandlers = new Map<string, Set<(payload: unknown) => void>>();
  private connectResolve: (() => void) | null = null;
  private connectReject: ((err: Error) => void) | null = null;

  constructor(private config: OCClientConfig) {
    super();
    if (config.deviceKeypair !== undefined) {
      const supplied = parseDeviceKeypair(config.deviceKeypair);
      if (supplied === null) {
        /*
         * Loud rather than quiet, and deliberately not "mint one instead":
         * falling back to a fresh keypair would present a new device wearing
         * the caller's persisted token, which is precisely the failure this
         * seam exists to remove. Callers read their keypair through a parse
         * that already refuses a broken one, so this is unreachable from a
         * correct call site and worth failing on when it is reached.
         */
        throw new Error('OCClient was given an unusable device keypair.');
      }
      this.keypair = supplied;
    }
  }

  /**
   * The device identity this client presents.
   *
   * Whatever the caller supplied, or the one `connect()` minted when they
   * supplied nothing; null before a first connect on a client that was left
   * to mint. Read it after a first pairing and persist it beside the token
   * the Gateway issued: the token is bound to this identity, so keeping one
   * without the other keeps a credential nothing can present.
   */
  get deviceKeypair(): OCDeviceKeypair | null {
    return this.keypair;
  }

  async connect(): Promise<void> {
    this.shouldReconnect = true;
    await this._initKeypair();

    return new Promise<void>((resolve, reject) => {
      const timeoutMs = this.config.requestTimeoutMs ?? 10000;
      const timer = setTimeout(() => {
        this.connectResolve = null;
        this.connectReject = null;
        reject(new Error(`OC gateway connection timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      this.connectResolve = () => {
        clearTimeout(timer);
        resolve();
      };

      this.connectReject = (err: Error) => {
        clearTimeout(timer);
        reject(err);
      };

      this._openConnection();
    });
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.ws;
    this.ws = null;
    socket?.close();
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();
    this._setStatus('disconnected');
  }

  getStatus(): OCConnectionStatus {
    return this.status;
  }

  call<R = unknown>(method: string, params: unknown = {}): Promise<R> {
    return new Promise((resolve, reject) => {
      const canCall =
        this.status === 'connected' ||
        (this.status === 'connecting' && method === 'connect');
      if (!canCall) {
        reject(
          new Error(
            `Cannot call ${method}: not connected (status: ${this.status})`
          )
        );
        return;
      }

      if (!this.ws) {
        reject(new Error(`Cannot call ${method}: no WebSocket instance`));
        return;
      }

      const id = `req-${++this.requestCounter}`;
      const request: OCRequest = { type: 'req', id, method, params };

      const timeoutMs = this.config.requestTimeoutMs ?? 10000;
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: r => resolve(r as R),
        reject,
        timer,
      });

      this.ws.send(JSON.stringify(request));
    });
  }

  onOCEvent(eventName: string, handler: (payload: unknown) => void): void {
    if (!this._ocEventHandlers.has(eventName)) {
      this._ocEventHandlers.set(eventName, new Set());
    }
    this._ocEventHandlers.get(eventName)!.add(handler);
  }

  offOCEvent(eventName: string, handler: (payload: unknown) => void): void {
    this._ocEventHandlers.get(eventName)?.delete(handler);
  }

  /**
   * Mint an identity only when the caller kept none. Once per client either
   * way: a second keypair would be a second device on the operator's server.
   */
  private async _initKeypair(): Promise<void> {
    this.keypair ??= await generateDeviceKeypair();
  }

  private _openConnection(): void {
    this.handshakeFailure = null;
    console.log(
      `[OCClient] Opening WebSocket: ${this.config.url.replace(/token=[^&]*/u, 'token=***')}`
    );
    this._setStatus('connecting');
    const socket = new WebSocket(this.config.url);
    this.ws = socket;

    socket.onopen = () => {
      if (this.ws !== socket) return;
      console.log(
        '[OCClient] WebSocket opened, waiting for connect.challenge...'
      );
    };

    socket.onmessage = event => {
      if (this.ws !== socket) return;
      if (typeof event.data !== 'string') {
        return;
      }
      void this._handleMessage(event.data);
    };

    socket.onerror = () => {
      if (this.ws !== socket) return;
      console.warn('[OCClient] WebSocket error event fired');
      this.emit('connection:error', new Error('WebSocket error'));
    };

    socket.onclose = (event?: CloseEvent) => {
      // A disconnect followed immediately by connect may leave the old
      // socket's close event queued behind the new socket. It cannot change
      // the new connection's state or schedule a second reconnect.
      if (this.ws !== socket) return;
      this.ws = null;
      console.log(
        `[OCClient] WebSocket closed: code=${event?.code ?? 'N/A'} reason="${event?.reason ?? ''}" wasClean=${event?.wasClean ?? false}`
      );
      this._setStatus('disconnected');

      for (const [, pending] of this.pendingRequests) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Connection closed'));
      }
      this.pendingRequests.clear();

      if (this.shouldReconnect) {
        const delay = Math.min(
          (this.config.reconnectDelayMs ?? 3000) *
            Math.pow(2, this.reconnectAttempts),
          this.config.maxReconnectDelay ?? 30000
        );
        this.reconnectAttempts++;
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          if (this.shouldReconnect) this._openConnection();
        }, delay);
      }
    };
  }

  private async _handleMessage(raw: string): Promise<void> {
    let frame: unknown;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }

    const msg = frame as {
      type?: string;
      event?: string;
      method?: string;
    };

    if (msg.type !== 'event' || msg.event !== 'tick') {
      // Frame bodies can contain auth device tokens and source data. Log only
      // protocol shape; authenticated payloads belong to the client, not the
      // process log.
      console.log(
        `[OCClient] RX: type=${msg.type ?? 'unknown'} name=${msg.event ?? msg.method ?? 'response'}`
      );
    }

    if (msg.type === 'event') {
      await this._handleEvent(frame as OCEvent);
    } else if (msg.type === 'res') {
      this._handleResponse(frame as OCResponse);
    }
  }

  private async _handleEvent(event: OCEvent): Promise<void> {
    const eventName = event.event;
    const payload = event.payload;

    if (eventName === 'connect.challenge') {
      await this._handleChallenge(payload as OCConnectChallenge);
      return;
    }

    if (eventName === 'tick') {
      return;
    }

    if (eventName === 'presence') {
      this._emitOCEvent(eventName, payload);
      return;
    }

    if (eventName === 'health') {
      this._emitOCEvent(eventName, payload);
      return;
    }

    this._emitOCEvent(eventName, payload);
  }

  private async _handleChallenge(challenge: OCConnectChallenge): Promise<void> {
    console.log('[OCClient] Received connect.challenge, signing...');
    const keypair = this.keypair;
    if (!keypair) {
      this.emit('connection:error', new Error('No device keypair available'));
      return;
    }

    const deviceId = await deriveDeviceId(keypair.publicKey);
    const signedAtMs = Date.now();
    const clientId = this.config.clientId ?? 'webchat';
    const clientMode = this.config.clientMode ?? 'webchat';
    const role = 'operator';
    // OpenClaw documents read + write as the ordinary operator client
    // profile. Admin, approvals, pairing, and secret-reading are opt-in;
    // inheriting all of them from a shared token is not least privilege.
    const scopes = [
      ...(this.config.scopes ?? ['operator.read', 'operator.write']),
    ];

    const payload = buildDeviceAuthPayload({
      deviceId,
      clientId,
      clientMode,
      role,
      scopes,
      signedAtMs,
      token: this.deviceToken ?? this.config.token ?? null,
      nonce: challenge.nonce,
    });
    const signature = await signDevicePayload(keypair.privateKey, payload);

    const auth: OCConnectParams['auth'] = {};
    if (this.config.password) {
      auth.password = this.config.password;
    }
    if (this.deviceToken) {
      auth.deviceToken = this.deviceToken;
    }
    if (this.config.token) {
      auth.token = this.config.token;
    }

    const connectParams: OCConnectParams = {
      minProtocol: MIN_PROTOCOL,
      maxProtocol: MAX_PROTOCOL,
      role,
      scopes,
      auth: Object.keys(auth).length > 0 ? auth : undefined,
      device: {
        id: deviceId,
        publicKey: keypair.publicKey,
        signature,
        signedAt: signedAtMs,
        nonce: challenge.nonce,
      },
      client: {
        id: clientId,
        version: this.config.clientVersion ?? '0.0.1',
        platform: this.config.clientPlatform ?? 'web',
        mode: clientMode,
      },
      caps: ['tool-events'],
      userAgent:
        typeof navigator !== 'undefined'
          ? navigator.userAgent
          : 'exawatt-server/0.1',
      locale: typeof navigator !== 'undefined' ? navigator.language : 'en-US',
    };

    try {
      console.log('[OCClient] Sending connect request...');
      const helloOk = await this.call<OCHelloOk>('connect', connectParams);
      console.log('[OCClient] Received hello-ok');
      if (helloOk.auth?.deviceToken) {
        this.deviceToken = helloOk.auth.deviceToken;
      }
      this.reconnectAttempts = 0;
      this._setStatus('connected');
    } catch (err) {
      const failure = err instanceof Error ? err : new Error(String(err));
      console.warn('[OCClient] connect request rejected:', failure.message);
      /*
       * A refused handshake arrives as one precise protocol sentence, such as
       * "unauthorized: device token mismatch (rotate/reissue device token)".
       * `_setStatus` is what rejects the pending `connect()`, so the sentence
       * is handed to it here instead of being replaced by a generic one:
       * every caller above this line was reading "connection failed" and
       * telling the operator to go check a Gateway that was answering fine.
       * Protocol text, never transport text.
       */
      this.handshakeFailure = failure;
      this._setStatus('error');
      this.emit('connection:error', failure);
    }
  }

  private _handleResponse(response: OCResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pendingRequests.delete(response.id);

    if (response.ok) {
      pending.resolve(response.payload);
    } else {
      const errData = response.error as { message?: string } | undefined;
      pending.reject(
        new Error(errData?.message ?? `RPC error for request ${response.id}`)
      );
    }
  }

  private _setStatus(status: OCConnectionStatus): void {
    this.status = status;
    this.emit('connection:status', status);

    if (status === 'connected' && this.connectResolve) {
      const resolve = this.connectResolve;
      this.connectResolve = null;
      this.connectReject = null;
      resolve();
    } else if (
      (status === 'error' || status === 'disconnected') &&
      this.connectReject
    ) {
      const reject = this.connectReject;
      this.connectResolve = null;
      this.connectReject = null;
      // The source's own account of the refusal when there is one; the
      // generic sentence only when the connection died without saying why.
      const refusal = this.handshakeFailure;
      this.handshakeFailure = null;
      reject(
        refusal ??
          new Error(`OC gateway connection failed with status: ${status}`)
      );
    }
  }

  private _emitOCEvent(eventName: string, payload: unknown): void {
    const handlers = this._ocEventHandlers.get(eventName);
    if (handlers) {
      for (const handler of handlers) {
        handler(payload);
      }
    }
  }
}

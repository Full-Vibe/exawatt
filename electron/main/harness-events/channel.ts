/**
 * Harness event channel (ENG-023 D1).
 *
 * A source-agnostic seam for harnesses that PUSH their own lifecycle instead of
 * leaving Exawatt to infer it from terminal bytes. Delegation is its first
 * consumer, not its purpose: turn boundaries arrive here too, and notification,
 * permission, and compaction events are available to later work through the
 * same door.
 *
 * Shape: one loopback listener for the whole app, one opaque token per launched
 * Session. The token — not a session id, a file path, or a provider identity —
 * is what maps an inbound event back to an Exawatt Session, which is why this
 * works without Exawatt knowing anything about where a harness keeps its state.
 *
 * Every failure mode degrades to "no delegation reported", never to a broken
 * Session. The channel refusing to bind, the app quitting, a token going stale,
 * or a malformed payload all leave the harness running normally — verified: a
 * dead listener costs the harness one 2s hook timeout and nothing else.
 */
import { EventEmitter } from 'events';
import http from 'http';
import { randomBytes } from 'crypto';
import type { HarnessEvent } from './delegation-state';

/** Far above any realistic hook payload (a long child report measured ~10 KB).
 *  Exceeding it means something is wrong, so drop rather than buffer. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** Normalizes one provider payload into the shared vocabulary. Supplying this
 *  per registration is what keeps the channel free of provider knowledge. */
export type HarnessEventNormalizer = (
  payload: unknown,
  at: number
) => HarnessEvent | null;

export interface ChannelRegistration {
  port: number;
  token: string;
}

function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  const host = address.startsWith('::ffff:') ? address.slice(7) : address;
  return host === '127.0.0.1' || host === '::1';
}

export class HarnessEventChannel extends EventEmitter {
  private server: http.Server | null = null;
  private port = 0;
  /** token -> Exawatt session id */
  private sessions = new Map<string, string>();
  /** Exawatt session id -> token (so a relaunch can release the old one) */
  private tokens = new Map<string, string>();
  private normalizers = new Map<string, HarnessEventNormalizer>();
  private starting: Promise<boolean> | null = null;
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    super();
    this.now = options.now ?? (() => Date.now());
  }

  /** Idempotent, and safe to call concurrently from parallel launches. */
  async start(): Promise<boolean> {
    if (this.server) return true;
    if (this.starting) return this.starting;
    this.starting = new Promise<boolean>(resolve => {
      const server = http.createServer((request, response) =>
        this.handle(request, response)
      );
      // Only a failure to BIND is fatal. A socket error on an already-listening
      // server must not null out a server that is still open, or new launches
      // would go unsubscribed while the listener leaked.
      const failedToBind = () => {
        this.server = null;
        this.starting = null;
        resolve(false);
      };
      server.once('error', failedToBind);
      // Loopback only, ephemeral port. Never keep the app alive for this.
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          server.close();
          this.starting = null;
          resolve(false);
          return;
        }
        this.server = server;
        this.port = address.port;
        server.off('error', failedToBind);
        // Post-bind errors are per-socket noise; log-free tolerance keeps one
        // bad client from disabling delegation for every Session.
        server.on('error', () => {});
        server.unref?.();
        this.starting = null;
        resolve(true);
      });
    });
    return this.starting;
  }

  stop(): void {
    this.server?.close();
    this.server = null;
    this.port = 0;
    this.sessions.clear();
    this.tokens.clear();
    this.normalizers.clear();
  }

  get listening(): boolean {
    return !!this.server;
  }

  /**
   * Claim a token for one Session launch. Returns null when the channel is not
   * listening, which the caller must read as "this launch reports no
   * delegation" rather than as a launch failure.
   */
  register(
    sessionId: string,
    normalize: HarnessEventNormalizer
  ): ChannelRegistration | null {
    if (!this.server) return null;
    this.release(sessionId);
    const token = randomBytes(24).toString('base64url');
    this.sessions.set(token, sessionId);
    this.tokens.set(sessionId, token);
    this.normalizers.set(token, normalize);
    return { port: this.port, token };
  }

  release(sessionId: string): void {
    const token = this.tokens.get(sessionId);
    if (!token) return;
    this.tokens.delete(sessionId);
    this.sessions.delete(token);
    this.normalizers.delete(token);
  }

  private handle(
    request: http.IncomingMessage,
    response: http.ServerResponse
  ): void {
    // Always answer, always fast: this runs inside the harness's turn.
    // Guarded because `error` and `end` can both fire for one request — a
    // second writeHead throws ERR_HTTP_HEADERS_SENT, and an uncaught throw
    // here would take down the main process over a hook delivery.
    let answered = false;
    const done = (status: number) => {
      if (answered || response.writableEnded) return;
      answered = true;
      try {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end('{}');
      } catch {
        // The client hung up mid-answer. Nothing to do and nothing broken.
      }
    };
    if (
      request.method !== 'POST' ||
      !isLoopback(request.socket.remoteAddress)
    ) {
      request.resume();
      done(404);
      return;
    }
    const header = request.headers['x-exawatt-token'];
    const token = Array.isArray(header) ? header[0] : header;
    const sessionId = token ? this.sessions.get(token) : undefined;
    const normalize = token ? this.normalizers.get(token) : undefined;
    if (!sessionId || !normalize) {
      // A token from a previous run or a released Session. The harness must
      // not care, so this is a quiet 404 rather than an error.
      request.resume();
      done(404);
      return;
    }

    let size = 0;
    const chunks: Buffer[] = [];
    let aborted = false;
    request.on('data', (chunk: Buffer) => {
      if (aborted) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        chunks.length = 0;
        this.emit('oversized', sessionId, size);
        return;
      }
      chunks.push(chunk);
    });
    request.on('error', () => done(400));
    request.on('end', () => {
      done(200);
      if (aborted) return;
      let payload: unknown;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        // A payload we cannot parse is one event lost, not a broken Session.
        return;
      }
      const event = normalize(payload, this.now());
      if (event) this.emit('event', sessionId, event);
    });
  }
}

export const harnessEventChannel = new HarnessEventChannel();

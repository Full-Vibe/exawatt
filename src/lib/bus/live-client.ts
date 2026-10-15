/**
 * The Live `BusClient`: this machine's bus, through the `bus` namespace the
 * preload exposes (ENG-029 B1, packet P3). When the namespace is absent (a
 * web browser, or a desktop build from before the bus) every read reports
 * `unavailable`, never an empty list.
 */
import type { BusClient, BusReadResult, BusSendResult } from './client';
import type { BusMessage, BusSendRequest } from './types';

/**
 * The preload surface this client expects: IPC `bus:list`, `bus:thread`,
 * `bus:send` and the push `bus:message`. Declared here until P3 adds `bus` to
 * the desktop bridge contract; then this becomes that type.
 */
export interface BusBridge {
  list(projectId: string): Promise<BusMessage[]>;
  thread(projectId: string, a: string, b: string): Promise<BusMessage[]>;
  send(request: BusSendRequest): Promise<BusSendResult>;
  onMessage(handler: (message: BusMessage) => void): () => void;
}

/** Why there is no bus here, in one line the operator can act on. */
function unavailableReason(): string {
  return typeof window !== 'undefined' && window.electron
    ? 'This version of Exawatt does not carry agent messages yet.'
    : 'Agent messages are in the Exawatt desktop app.';
}

function bridgeOf(): BusBridge | null {
  if (typeof window === 'undefined') return null;
  const electron = window.electron as { bus?: BusBridge } | undefined;
  return electron?.bus ?? null;
}

function readFailure(reason: unknown): BusReadResult {
  return {
    status: 'error',
    message:
      reason instanceof Error && reason.message
        ? reason.message
        : 'Could not read agent messages',
  };
}

/**
 * `resolve` is read on every call rather than once, so a client created before
 * preload finished (or a test that installs a bridge later) sees the bridge
 * that exists at the moment of the call.
 */
export function createLiveBusClient(
  resolve: () => BusBridge | null = bridgeOf
): BusClient {
  return {
    kind: 'live',
    async list(projectId) {
      const bridge = resolve();
      if (!bridge)
        return { status: 'unavailable', reason: unavailableReason() };
      try {
        return { status: 'ok', messages: await bridge.list(projectId) };
      } catch (reason) {
        return readFailure(reason);
      }
    },
    async thread(projectId, a, b) {
      const bridge = resolve();
      if (!bridge)
        return { status: 'unavailable', reason: unavailableReason() };
      try {
        return {
          status: 'ok',
          messages: await bridge.thread(projectId, a, b),
        };
      } catch (reason) {
        return readFailure(reason);
      }
    },
    async send(request) {
      const bridge = resolve();
      if (!bridge) return { status: 'refused', reason: unavailableReason() };
      try {
        return await bridge.send(request);
      } catch (reason) {
        return {
          status: 'refused',
          reason:
            reason instanceof Error && reason.message
              ? reason.message
              : 'The message was not sent',
        };
      }
    },
    subscribe(listener) {
      const bridge = resolve();
      if (!bridge) return () => {};
      return bridge.onMessage(listener);
    },
  };
}

/**
 * The Live `BusClient`: this machine's bus, through the `bus` namespace the
 * preload exposes (ENG-029 B1, packet P3). When the namespace is absent (a
 * web browser, or a desktop build from before the bus) every read reports
 * `unavailable`, never an empty list.
 */
import { refusedSend, type BusClient, type BusReadResult } from './client';
import type { DesktopBridge } from '@exawatt/core/desktop-bridge';
import type { BusLedgerRead } from '@exawatt/core';

/** The preload's `bus` namespace (`DesktopBusApi`). */
export type BusBridge = NonNullable<DesktopBridge['bus']>;

/** Why there is no bus here, in one line the operator can act on. */
function unavailableReason(): string {
  return typeof window !== 'undefined' && window.electron
    ? 'This version of Exawatt does not carry agent messages yet.'
    : 'Agent messages are in the Exawatt desktop app.';
}

function bridgeOf(): BusBridge | null {
  if (typeof window === 'undefined') return null;
  return window.electron?.bus ?? null;
}

function failureMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

async function read(
  load: () => Promise<BusLedgerRead>
): Promise<BusReadResult> {
  try {
    const result = await load();
    return result;
  } catch (reason) {
    return {
      ok: false,
      reason: failureMessage(reason, 'Could not read agent messages'),
    };
  }
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
        return { ok: false, unavailable: true, reason: unavailableReason() };
      return read(() => bridge.list(projectId));
    },
    async thread(projectId, a, b) {
      const bridge = resolve();
      if (!bridge)
        return { ok: false, unavailable: true, reason: unavailableReason() };
      return read(() => bridge.thread(projectId, a, b));
    },
    async send(request) {
      const bridge = resolve();
      if (!bridge) return refusedSend(unavailableReason());
      try {
        return await bridge.send(request);
      } catch (reason) {
        return refusedSend(failureMessage(reason, 'The message was not sent'));
      }
    },
    subscribe(listener) {
      const bridge = resolve();
      if (!bridge) return () => {};
      return bridge.onMessage(listener);
    },
  };
}

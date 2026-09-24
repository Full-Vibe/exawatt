import { afterEach, describe, expect, it, vi } from 'vitest';
import { startMainProcessAnalyticsBridge } from './main-process-events';
import {
  installBridgeDouble,
  removeBridgeDouble,
} from '@/test-support/desktop-bridge-double';

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('startMainProcessAnalyticsBridge', () => {
  afterEach(() => {
    removeBridgeDouble();
  });

  it('is inert on web surfaces, where no bridge exists', () => {
    expect(() => startMainProcessAnalyticsBridge()).not.toThrow();
  });

  it('drains once at startup and again on every nudge from main', async () => {
    let nudge: ((payload: null) => void) | undefined;
    const drainMainProcessEvents = vi.fn(async () => []);
    installBridgeDouble({
      platform: 'darwin',
      analytics: {
        drainMainProcessEvents,
        onMainProcessEvents: (handler: (payload: null) => void) => {
          nudge = handler;
          return () => undefined;
        },
      },
    });

    startMainProcessAnalyticsBridge();
    await flush();
    // The startup drain empties whatever main queued before this page existed.
    expect(drainMainProcessEvents).toHaveBeenCalledTimes(1);

    nudge?.(null);
    await flush();
    expect(drainMainProcessEvents).toHaveBeenCalledTimes(2);
  });

  it('serializes overlapping nudges and drains once more afterwards', async () => {
    let nudge: ((payload: null) => void) | undefined;
    let release!: (value: unknown[]) => void;
    const drainMainProcessEvents = vi
      .fn<() => Promise<unknown[]>>()
      .mockImplementationOnce(
        () =>
          new Promise<unknown[]>(resolve => {
            release = resolve;
          })
      )
      .mockResolvedValue([]);
    installBridgeDouble({
      platform: 'darwin',
      analytics: {
        drainMainProcessEvents,
        onMainProcessEvents: (handler: (payload: null) => void) => {
          nudge = handler;
          return () => undefined;
        },
      },
    });

    startMainProcessAnalyticsBridge();
    await flush();
    expect(drainMainProcessEvents).toHaveBeenCalledTimes(1);

    // Nudges while the first drain is still in flight coalesce into ONE
    // follow-up drain, so an event queued mid-drain is not stranded.
    nudge?.(null);
    nudge?.(null);
    await flush();
    expect(drainMainProcessEvents).toHaveBeenCalledTimes(1);

    release([]);
    await flush();
    expect(drainMainProcessEvents).toHaveBeenCalledTimes(2);
  });
});

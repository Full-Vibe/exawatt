import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsIdentityRequest } from '@exawatt/core/desktop-bridge';
import {
  ANALYTICS_INSTALLATION_ID_STORAGE_KEY,
  ANALYTICS_INTERNAL_STORAGE_KEY,
  ANALYTICS_OPT_OUT_STORAGE_KEY,
  loadAnalyticsIdentity,
  markAnalyticsDeviceInternal,
  persistAnalyticsOptOut,
} from './identity';
import {
  installBridgeDouble,
  removeBridgeDouble,
} from '@/test-support/desktop-bridge-double';

const LEGACY = '5f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const MAIN = '0b8e4f5e-3c1d-4a2b-9f6e-7d8c9b0a1e2f';

afterEach(() => {
  removeBridgeDouble();
  window.localStorage.clear();
});

describe('website analytics identity', () => {
  it('mints once, reuses it, and creates nothing when only reading', async () => {
    expect(await loadAnalyticsIdentity({ ensureId: false })).toEqual({
      optedOut: false,
      installationId: null,
      internal: false,
    });
    expect(
      window.localStorage.getItem(ANALYTICS_INSTALLATION_ID_STORAGE_KEY)
    ).toBeNull();
    const first = await loadAnalyticsIdentity({ ensureId: true }, () => LEGACY);
    expect(first).toEqual({
      optedOut: false,
      installationId: LEGACY,
      internal: false,
    });
    expect(
      await loadAnalyticsIdentity({ ensureId: true }, () => 'never-used')
    ).toEqual(first);
  });

  it('opting out persists and forgets the id', async () => {
    await loadAnalyticsIdentity({ ensureId: true }, () => LEGACY);
    expect(await persistAnalyticsOptOut(true)).toEqual({
      optedOut: true,
      installationId: null,
      internal: false,
    });
    expect(window.localStorage.getItem(ANALYTICS_OPT_OUT_STORAGE_KEY)).toBe(
      'true'
    );
    expect(
      window.localStorage.getItem(ANALYTICS_INSTALLATION_ID_STORAGE_KEY)
    ).toBeNull();
    expect(await loadAnalyticsIdentity({ ensureId: true })).toEqual({
      optedOut: true,
      installationId: null,
      internal: false,
    });
  });

  it('a team sign-in marks this browser, and an opt-out keeps the mark (ENG-047 F6)', async () => {
    expect(await markAnalyticsDeviceInternal()).toBe(true);
    expect(window.localStorage.getItem(ANALYTICS_INTERNAL_STORAGE_KEY)).toBe(
      'true'
    );
    await persistAnalyticsOptOut(true);
    await persistAnalyticsOptOut(false);
    expect(
      await loadAnalyticsIdentity({ ensureId: true }, () => LEGACY)
    ).toEqual({ optedOut: false, installationId: LEGACY, internal: true });
  });
});

describe('desktop analytics identity (BUG-171)', () => {
  function installMain(answer: { status: 'ready' | 'unavailable' }) {
    const identity = vi.fn(async (request: AnalyticsIdentityRequest) => {
      void request;
      return answer.status === 'ready'
        ? ({
            status: 'ready',
            optedOut: false,
            installationId: MAIN,
            internal: false,
          } as const)
        : ({ status: 'unavailable' } as const);
    });
    const setOptOut = vi.fn(async (optedOut: boolean) => ({
      status: 'ready' as const,
      optedOut,
      installationId: null,
      internal: false,
    }));
    installBridgeDouble({
      platform: 'darwin',
      analytics: { identity, setOptOut },
    });
    return { identity, setOptOut };
  }

  it('reads main, never the origin, so a fallback port changes nothing', async () => {
    const { identity } = installMain({ status: 'ready' });
    expect(await loadAnalyticsIdentity({ ensureId: true })).toEqual({
      optedOut: false,
      installationId: MAIN,
      internal: false,
    });
    expect(identity).toHaveBeenCalledWith({ legacy: null, ensureId: true });
    expect(
      window.localStorage.getItem(ANALYTICS_INSTALLATION_ID_STORAGE_KEY)
    ).toBeNull();
  });

  it('offers what this origin kept once, then drops its copy', async () => {
    window.localStorage.setItem(ANALYTICS_OPT_OUT_STORAGE_KEY, 'true');
    window.localStorage.setItem(ANALYTICS_INSTALLATION_ID_STORAGE_KEY, LEGACY);
    const { identity } = installMain({ status: 'ready' });
    await loadAnalyticsIdentity({ ensureId: true });
    expect(identity).toHaveBeenCalledWith({
      legacy: { optedOut: true, installationId: LEGACY },
      ensureId: true,
    });
    expect(
      window.localStorage.getItem(ANALYTICS_OPT_OUT_STORAGE_KEY)
    ).toBeNull();
    await loadAnalyticsIdentity({ ensureId: true });
    expect(identity).toHaveBeenLastCalledWith({ legacy: null, ensureId: true });
  });

  it('keeps the legacy copy and answers null when main cannot', async () => {
    window.localStorage.setItem(ANALYTICS_OPT_OUT_STORAGE_KEY, 'true');
    installMain({ status: 'unavailable' });
    expect(await loadAnalyticsIdentity({ ensureId: true })).toBeNull();
    expect(window.localStorage.getItem(ANALYTICS_OPT_OUT_STORAGE_KEY)).toBe(
      'true'
    );
  });

  it('asks main to keep the team mark, and keeps nothing on the origin', async () => {
    const markInternal = vi.fn(async () => ({
      status: 'ready' as const,
      optedOut: false,
      installationId: MAIN,
      internal: true,
    }));
    installBridgeDouble({
      platform: 'darwin',
      analytics: {
        identity: vi.fn(async () => ({ status: 'unavailable' as const })),
        setOptOut: vi.fn(async () => ({ status: 'unavailable' as const })),
        markInternal,
      },
    });
    expect(await markAnalyticsDeviceInternal()).toBe(true);
    expect(markInternal).toHaveBeenCalledTimes(1);
    expect(
      window.localStorage.getItem(ANALYTICS_INTERNAL_STORAGE_KEY)
    ).toBeNull();
  });

  it('writes the opt-out to main, not to the origin', async () => {
    const { setOptOut } = installMain({ status: 'ready' });
    expect(await persistAnalyticsOptOut(true)).toEqual({
      optedOut: true,
      installationId: null,
      internal: false,
    });
    expect(setOptOut).toHaveBeenCalledWith(true);
    expect(
      window.localStorage.getItem(ANALYTICS_OPT_OUT_STORAGE_KEY)
    ).toBeNull();
  });
});

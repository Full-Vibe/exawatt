import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMMUNITY_DISTRIBUTION,
  parseDistributionContract,
} from '@exawatt/core/distribution';
import {
  installBridgeDouble,
  removeBridgeDouble,
} from '@/test-support/desktop-bridge-double';
import { EVERY_ANALYTICS_EVENT } from './examples.test-support';
import { ANALYTICS_INSTALLATION_ID_STORAGE_KEY } from './identity';

/**
 * The client end to end on the website: which stream each event reaches,
 * the one alias, and a community build's silence. The SDK is a recording
 * double; `fetch` is the direct sender's only door.
 */

const state = vi.hoisted(() => ({
  distribution: null as unknown,
  captured: [] as Array<{ name: string; properties: unknown }>,
  initialized: [] as Array<Record<string, unknown>>,
  streams: { started: 0, stopped: 0, captured: 0 },
}));

vi.mock('./account-stream', () => ({
  startAccountStream: () => {
    state.streams.started += 1;
    return {
      capture: () => {
        state.streams.captured += 1;
      },
      stop: () => {
        state.streams.stopped += 1;
      },
    };
  },
}));

vi.mock('@/lib/distribution/resolved', () => ({
  resolvedDistribution: () => state.distribution,
  resolvedDistributionDigest: () => null,
  resetResolvedDistributionForTest: () => undefined,
}));

const recordingPosthog = vi.hoisted(() => () => ({
  default: {
    init: (_key: string, config: Record<string, unknown>) => {
      state.initialized.push(config);
    },
    capture: (name: string, properties: unknown) => {
      state.captured.push({ name, properties });
    },
  },
}));

vi.mock('posthog-js/dist/module.full.no-external', recordingPosthog);

const OFFICIAL = parseDistributionContract({
  ...COMMUNITY_DISTRIBUTION,
  analytics: {
    ingestOrigin: 'https://ingest.example.test/ingest',
    projectKey: 'official-public-key',
  },
});

const WEB_ID = '0b8e4f5e-3c1d-4a2b-9f6e-7d8c9b0a1e2f';
const OTHER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

async function freshClient() {
  vi.resetModules();
  return import('./client');
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  state.captured = [];
  state.initialized = [];
  state.streams = { started: 0, stopped: 0, captured: 0 };
  window.localStorage.clear();
  fetchSpy = vi.fn(async () => new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('a community build sends nothing (decision 0036)', () => {
  it('for every allowlisted event, the alias, and the web id', async () => {
    state.distribution = COMMUNITY_DISTRIBUTION;
    vi.stubEnv('NODE_ENV', 'production');
    const client = await freshClient();
    await expect(client.initAnalytics()).resolves.toMatchObject({
      enabled: false,
    });
    for (const event of EVERY_ANALYTICS_EVENT)
      client.captureAnalyticsEvent(event);
    client.recordWebAlias(OTHER_ID);
    expect(client.currentWebAnalyticsId()).toBeNull();
    expect(state.initialized).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    // Nor does it create an identity it will never use.
    expect(
      window.localStorage.getItem(ANALYTICS_INSTALLATION_ID_STORAGE_KEY)
    ).toBeNull();
  });
});

describe('an official website build', () => {
  beforeEach(() => {
    state.distribution = OFFICIAL;
    vi.stubEnv('NODE_ENV', 'production');
    window.localStorage.setItem(ANALYTICS_INSTALLATION_ID_STORAGE_KEY, WEB_ID);
  });

  it('sends the installation stream through the SDK, never an account-only event', async () => {
    const client = await freshClient();
    await client.initAnalytics();
    for (const event of EVERY_ANALYTICS_EVENT)
      client.captureAnalyticsEvent(event);
    const names = state.captured.map(capture => capture.name);
    expect(names).toContain('page_viewed');
    expect(names).toContain('agent_launched');
    expect(names).not.toContain('agent_finished');
    expect(state.initialized[0]).toMatchObject({
      bootstrap: { distinctID: WEB_ID },
      persistence: 'localStorage',
      person_profiles: 'never',
    });
    // The website has no account stream: nothing went around the SDK.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('hands out the web id only while emitting', async () => {
    const client = await freshClient();
    await client.initAnalytics();
    expect(client.currentWebAnalyticsId()).toBe(WEB_ID);
    await client.setAnalyticsOptOut(true);
    expect(client.currentWebAnalyticsId()).toBeNull();
    await expect(client.webAnalyticsId()).resolves.toBeNull();
  });

  // The download link carries this id, and the server records a download
  // only under it: an id that waited for the SDK left every click made while
  // the SDK loaded unrecorded.
  it('hands out the web id at the decision, before the SDK has loaded', async () => {
    let releaseImport: () => void = () => undefined;
    const importGate = new Promise<void>(resolve => (releaseImport = resolve));
    vi.doMock('posthog-js/dist/module.full.no-external', async () => {
      await importGate;
      return recordingPosthog();
    });
    try {
      const client = await freshClient();
      await expect(client.webAnalyticsId()).resolves.toBe(WEB_ID);
      expect(state.initialized).toEqual([]);
      releaseImport();
      await client.initAnalytics();
      expect(state.initialized).toHaveLength(1);
    } finally {
      releaseImport();
      vi.doMock('posthog-js/dist/module.full.no-external', recordingPosthog);
    }
  });

  it('posts one $create_alias from the installation id, and refuses junk', async () => {
    const client = await freshClient();
    await client.initAnalytics();
    client.recordWebAlias('not-an-id');
    client.recordWebAlias(WEB_ID);
    expect(fetchSpy).not.toHaveBeenCalled();
    client.recordWebAlias(OTHER_ID);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://ingest.example.test/ingest/batch/');
    expect(JSON.parse(String(init.body))).toMatchObject({
      api_key: 'official-public-key',
      batch: [
        {
          event: '$create_alias',
          distinct_id: WEB_ID,
          properties: {
            distinct_id: WEB_ID,
            alias: OTHER_ID,
            $lib: 'exawatt-web-link',
          },
        },
      ],
    });
  });

  it('sends nothing at all once opted out', async () => {
    window.localStorage.setItem('exawatt.analytics.opt-out.v1', 'true');
    const client = await freshClient();
    await expect(client.initAnalytics()).resolves.toEqual({
      enabled: false,
      reason: 'opted_out',
    });
    for (const event of EVERY_ANALYTICS_EVENT)
      client.captureAnalyticsEvent(event);
    client.recordWebAlias(OTHER_ID);
    await expect(client.webAnalyticsId()).resolves.toBeNull();
    expect(state.captured).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('an opt-out during the desktop start is authoritative', () => {
  const DESKTOP_ID = '3f2b8c1d-5e6a-4b7c-8d9e-0a1b2c3d4e5f';
  let answerIdentity: () => void;
  let identityAsked: Promise<void>;

  beforeEach(() => {
    state.distribution = OFFICIAL;
    vi.stubEnv('NODE_ENV', 'production');
    let asked: () => void = () => undefined;
    identityAsked = new Promise(resolve => (asked = resolve));
    const answered = new Promise<void>(resolve => (answerIdentity = resolve));
    installBridgeDouble({
      analytics: {
        identity: async () => {
          asked();
          await answered;
          // Main read the id before the opt-out reached it.
          return {
            status: 'ready' as const,
            optedOut: false,
            installationId: DESKTOP_ID,
          };
        },
        setOptOut: async () => ({
          status: 'ready' as const,
          optedOut: true,
          installationId: null,
        }),
      },
    });
  });

  afterEach(() => removeBridgeDouble());

  function expectNothingStarted() {
    expect(state.initialized).toEqual([]);
    expect(state.captured).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(state.streams.captured).toBe(0);
    expect(state.streams.started).toBe(state.streams.stopped);
  }

  it('while the identity read is pending: PostHog never initializes', async () => {
    const client = await freshClient();
    const decision = client.initAnalytics();
    await identityAsked;
    client.captureAnalyticsEvent(EVERY_ANALYTICS_EVENT[0]);
    await client.setAnalyticsOptOut(true);
    answerIdentity();
    await expect(decision).resolves.toEqual({
      enabled: false,
      reason: 'opted_out',
    });
    for (const event of EVERY_ANALYTICS_EVENT)
      client.captureAnalyticsEvent(event);
    client.recordWebAlias(OTHER_ID);
    expect(client.isAnalyticsEmitting()).toBe(false);
    expect(state.streams.started).toBe(0);
    expectNothingStarted();
  });

  it('while the SDK import is in flight: PostHog never initializes and the account stream stops', async () => {
    let releaseImport: () => void = () => undefined;
    const importGate = new Promise<void>(resolve => (releaseImport = resolve));
    // A factory that resolves only when released: the import is in flight.
    vi.doMock('posthog-js/dist/module.full.no-external', async () => {
      await importGate;
      return recordingPosthog();
    });
    const client = await freshClient();
    const decision = client.initAnalytics();
    answerIdentity();
    await vi.waitFor(() => expect(state.streams.started).toBe(1));
    await client.setAnalyticsOptOut(true);
    releaseImport();
    await expect(decision).resolves.toEqual({
      enabled: false,
      reason: 'opted_out',
    });
    for (const event of EVERY_ANALYTICS_EVENT)
      client.captureAnalyticsEvent(event);
    expect(client.isAnalyticsEmitting()).toBe(false);
    expectNothingStarted();
  });
});

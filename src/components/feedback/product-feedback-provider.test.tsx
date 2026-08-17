import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ProductFeedbackProvider,
  useProductFeedback,
} from './product-feedback-provider';

const { distributionState, clientState, createOptionalClient } = vi.hoisted(
  () => ({
    distributionState: { current: null as unknown },
    clientState: { current: null as ReturnType<typeof client> | null },
    createOptionalClient: vi.fn(() => clientState.current),
  })
);

vi.mock('@/lib/distribution/resolved', () => ({
  resolvedDistribution: () => distributionState.current,
}));

vi.mock('@/lib/supabase/client', () => ({
  createOptionalClient,
}));

const FEEDBACK_URL = 'https://feedback.example.test/v1/intake';
const SESSION = {
  access_token: 'header.payload.signature',
  user: { id: 'user-1' },
};

function distribution(productFeedback: object | null) {
  return {
    schemaVersion: 1,
    brand: null,
    account: productFeedback
      ? {
          supabaseUrl: 'https://account.example.test',
          supabaseAnonKey: 'public-anon-key',
          recoveryOrigin: 'https://app.example.test',
        }
      : null,
    services: {
      productFeedback,
      operatorStats: null,
      projects: null,
      preferences: null,
      accountData: null,
    },
    enrichment: {
      contextLabels: null,
      conversationSummaries: null,
      goalVisuals: null,
    },
    analytics: null,
    updates: null,
  };
}

function client(session = SESSION) {
  return {
    auth: {
      getSession: vi.fn(async () => ({ data: { session } })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  };
}

let feedback: ReturnType<typeof useProductFeedback> | null = null;

function Probe() {
  feedback = useProductFeedback();
  return (
    <p>
      {feedback.isAvailable ? 'Feedback configured' : 'Feedback unavailable'}
      {' / '}
      {feedback.isAuthenticated ? 'signed in' : 'signed out'}
    </p>
  );
}

beforeEach(() => {
  feedback = null;
  createOptionalClient.mockClear();
  clientState.current = client();
  Object.defineProperty(window, 'electron', {
    configurable: true,
    writable: true,
    value: undefined,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ProductFeedbackProvider distribution boundary', () => {
  it('stops before account auth or fetch and exposes honest absence', async () => {
    distributionState.current = distribution(null);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    render(
      <ProductFeedbackProvider>
        <Probe />
      </ProductFeedbackProvider>
    );

    expect(screen.getByText('Feedback unavailable / signed out')).toBeTruthy();
    expect(createOptionalClient).not.toHaveBeenCalled();
    expect(clientState.current!.auth.getSession).not.toHaveBeenCalled();
    expect(clientState.current!.auth.onAuthStateChange).not.toHaveBeenCalled();

    let submitted = true;
    await act(async () => {
      submitted = await feedback!.submitContextRating({
        durableSessionId: 'session-1',
        label: 'Inspect distribution boundary',
        sentiment: 1,
      });
    });

    expect(submitted).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('preserves authenticated POST behavior at a distributor endpoint', async () => {
    distributionState.current = distribution({
      url: FEEDBACK_URL,
      protocolVersion: 1,
    });
    const fetchSpy = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => ({
        ok: true,
        status: 201,
      })
    );
    vi.stubGlobal('fetch', fetchSpy);

    render(
      <ProductFeedbackProvider>
        <Probe />
      </ProductFeedbackProvider>
    );

    await waitFor(() =>
      expect(screen.getByText('Feedback configured / signed in')).toBeTruthy()
    );
    expect(createOptionalClient).toHaveBeenCalledWith(
      distributionState.current
    );

    let submitted = false;
    await act(async () => {
      submitted = await feedback!.submitContextRating({
        durableSessionId: 'session-1',
        label: 'Inspect distribution boundary',
        sentiment: -1,
      });
    });

    expect(submitted).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      FEEDBACK_URL,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: `Bearer ${SESSION.access_token}`,
          'content-type': 'application/json',
        }),
      })
    );
    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
    expect(body).toMatchObject({
      kind: 'context_label',
      sentiment: -1,
      surface: 'workspace-tab-strip',
      context: {
        schemaVersion: 1,
        durableSessionId: 'session-1',
        shownLabel: 'Inspect distribution boundary',
      },
    });
  });
});

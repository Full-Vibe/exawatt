import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
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
      onAuthStateChange: vi.fn(
        (listener: (event: string, value: typeof SESSION | null) => void) => {
          let active = true;
          queueMicrotask(() => {
            if (active) listener('INITIAL_SESSION', session);
          });
          return {
            data: {
              subscription: {
                unsubscribe: () => {
                  active = false;
                },
              },
            },
          };
        }
      ),
    },
  };
}

let feedback: ReturnType<typeof useProductFeedback> | null = null;

function Probe() {
  const value = useProductFeedback();
  // Publishing the hook result to the module binding is a side effect, so it
  // belongs in an effect rather than in render (react-hooks/globals). Render
  // reads only `value`.
  useEffect(() => {
    feedback = value;
  });
  return (
    <p>
      {value.isAvailable ? 'Feedback configured' : 'Feedback unavailable'}
      {' / '}
      {value.isAuthenticated ? 'signed in' : 'signed out'}
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
  it('does not reinstall an obsolete credential after the account signs out', async () => {
    distributionState.current = distribution({
      url: FEEDBACK_URL,
      protocolVersion: 1,
    });
    let settle!: (value: { data: { session: typeof SESSION } }) => void;
    const staleRead = new Promise<{ data: { session: typeof SESSION } }>(
      resolve => {
        settle = resolve;
      }
    );
    clientState.current!.auth.getSession.mockReturnValue(staleRead);
    const setContextAuth = vi.fn();
    window.electron = {
      pty: { setContextAuth },
      feedback: { setAuthenticated: vi.fn() },
    } as unknown as typeof window.electron;
    render(
      <ProductFeedbackProvider>
        <Probe />
      </ProductFeedbackProvider>
    );
    await act(async () => {});
    const listener =
      clientState.current!.auth.onAuthStateChange.mock.calls[0][0];
    act(() => listener('SIGNED_OUT', null));
    expect(feedback!.isAuthenticated).toBe(false);
    await act(async () => {
      settle({ data: { session: SESSION } });
    });
    expect(feedback!.isAuthenticated).toBe(false);
    expect(setContextAuth).toHaveBeenLastCalledWith(null);
  });

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
    const fetchSpy = vi.fn<typeof fetch>(async () =>
      Response.json(
        {
          schemaVersion: 1,
          id: '223e4567-e89b-42d3-a456-426614174000',
          duplicate: false,
          attachmentStored: false,
        },
        { status: 201, headers: { 'Exawatt-Service-Version': '1' } }
      )
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
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(FEEDBACK_URL);
    expect(init).toMatchObject({ method: 'POST' });
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${SESSION.access_token}`);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('Exawatt-Service-Version')).toBe('1');
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({
      schemaVersion: 1,
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

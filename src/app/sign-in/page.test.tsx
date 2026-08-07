import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SignInPage from './page';
import {
  AUTH_CALLBACK_FAILURES,
  CALLBACK_FAILURE_MESSAGES,
  GENERIC_CALLBACK_FAILURE,
} from '@/components/auth/callback-failures';

const { search, captured } = vi.hoisted(() => ({
  search: { current: '' },
  captured: { events: [] as Array<Record<string, unknown>> },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search.current),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { signInWithPassword: vi.fn(async () => ({ error: null })) },
  }),
}));

vi.mock('@/hooks/use-electron-auth', () => ({
  useElectronAuth: () => ({ signInWithGoogle: vi.fn(async () => undefined) }),
}));

vi.mock('@/lib/analytics', () => ({
  analyticsSurface: () => 'web',
  captureAnalyticsEvent: (event: Record<string, unknown>) => {
    captured.events.push(event);
  },
}));

async function mount() {
  render(<SignInPage />);
  await act(async () => {});
}

beforeEach(() => {
  search.current = '';
  captured.events = [];
});

afterEach(cleanup);

describe('sign-in page callback failures', () => {
  it('shows that a callback failed instead of leaving it invisible', async () => {
    search.current = 'error=exchange_rejected';

    await mount();

    expect(screen.getByRole('alert')).toHaveTextContent(
      CALLBACK_FAILURE_MESSAGES.exchange_rejected
    );
  });

  it('owns copy for every code the callback route can emit', async () => {
    for (const code of AUTH_CALLBACK_FAILURES) {
      cleanup();
      search.current = `error=${code}`;

      await mount();

      const copy = CALLBACK_FAILURE_MESSAGES[code];
      expect(copy, `no copy for ${code}`).toBeTruthy();
      expect(copy).not.toBe(GENERIC_CALLBACK_FAILURE);
      expect(screen.getByRole('alert')).toHaveTextContent(copy);
    }
  });

  it('falls back to its own sentence for an unrecognized code', async () => {
    search.current = 'error=exchange_failed_v2';

    await mount();

    expect(screen.getByRole('alert')).toHaveTextContent(
      GENERIC_CALLBACK_FAILURE
    );
  });

  it('never renders attacker-supplied text from the query string', async () => {
    const forged =
      'Your account is suspended. Call 555-0100 to restore access.';
    search.current = `error=${encodeURIComponent(forged)}`;

    await mount();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(GENERIC_CALLBACK_FAILURE);
    expect(alert.textContent).not.toContain('555-0100');
    expect(alert.textContent).not.toContain('suspended');
    expect(document.body.textContent).not.toContain('555-0100');
  });

  it('still reports the failure to analytics, classed by code', async () => {
    search.current = 'error=provider_refused';

    await mount();

    expect(captured.events).toContainEqual(
      expect.objectContaining({
        name: 'sign_in_attempted',
        outcome: 'failed',
        failure: 'provider_error',
      })
    );
  });

  it('reports an unrecognized code as a callback exchange failure', async () => {
    search.current = 'error=whatever';

    await mount();

    expect(captured.events).toContainEqual(
      expect.objectContaining({
        name: 'sign_in_attempted',
        outcome: 'failed',
        failure: 'callback_exchange',
      })
    );
  });
});

describe('sign-in page', () => {
  it('offers a way out of a forgotten password', async () => {
    await mount();

    expect(
      screen.getByRole('link', { name: 'Forgot password?' })
    ).toHaveAttribute('href', '/auth/forgot-password');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(captured.events).toHaveLength(0);
  });
});

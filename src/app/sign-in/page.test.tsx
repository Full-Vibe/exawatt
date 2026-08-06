import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SignInPage from './page';

const { search } = vi.hoisted(() => ({ search: { current: '' } }));

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

async function mount() {
  render(<SignInPage />);
  await act(async () => {});
}

beforeEach(() => {
  search.current = '';
});

afterEach(cleanup);

describe('sign-in page', () => {
  it('shows the reason a callback failed instead of leaving it invisible', async () => {
    search.current =
      'error=invalid+request%3A+both+auth+code+and+code+verifier+should+be+non-empty';

    await mount();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'invalid request: both auth code and code verifier should be non-empty'
    );
  });

  it('offers a way out of a forgotten password', async () => {
    await mount();

    expect(
      screen.getByRole('link', { name: 'Forgot password?' })
    ).toHaveAttribute('href', '/auth/forgot-password');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

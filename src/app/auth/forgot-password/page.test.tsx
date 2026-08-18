import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMMUNITY_DISTRIBUTION,
  type DistributionContractV2,
} from '@exawatt/core/distribution';
import ForgotPasswordPage from './page';

const CONFIGURED_DISTRIBUTION = {
  ...COMMUNITY_DISTRIBUTION,
  account: {
    supabaseUrl: 'https://accounts.example.test',
    supabaseAnonKey: 'public-test-key',
    recoveryOrigin: 'https://app.example.test',
  },
} satisfies DistributionContractV2;

const { createOptionalClient, distributionState, resetPasswordForEmail } =
  vi.hoisted(() => ({
    distributionState: { current: undefined as unknown },
    createOptionalClient: vi.fn(),
    resetPasswordForEmail: vi.fn(async () => ({ error: null })),
  }));

vi.mock('@/lib/distribution/resolved', () => ({
  resolvedDistribution: () => distributionState.current,
}));

vi.mock('@/lib/supabase/client', () => ({ createOptionalClient }));

async function mount() {
  render(<ForgotPasswordPage />);
  await act(async () => {});
}

beforeEach(() => {
  distributionState.current = CONFIGURED_DISTRIBUTION;
  resetPasswordForEmail.mockClear();
  createOptionalClient.mockReset();
  createOptionalClient.mockReturnValue({ auth: { resetPasswordForEmail } });
});

afterEach(() => {
  cleanup();
  delete (window as { electron?: unknown }).electron;
});

describe('password reset request', () => {
  it('sends the link back through the callback route that finishes the reset', async () => {
    await mount();

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'invitee@example.com' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    });

    expect(createOptionalClient).toHaveBeenCalledWith(CONFIGURED_DISTRIBUTION);
    expect(resetPasswordForEmail).toHaveBeenCalledWith('invitee@example.com', {
      redirectTo:
        'https://app.example.test/auth/callback?next=%2Fauth%2Fupdate-password',
    });
    expect(screen.getByRole('status')).toHaveTextContent('Check your email.');
  });

  it('reports a failed request instead of claiming success', async () => {
    resetPasswordForEmail.mockResolvedValueOnce({
      error: { message: 'Email rate limit exceeded' },
    } as never);
    await mount();

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'invitee@example.com' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Email rate limit exceeded'
    );
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('hands the desktop app off to the configured recovery origin', async () => {
    const openExternal = vi.fn(async () => undefined);
    (window as { electron?: unknown }).electron = {
      isElectron: true,
      pty: { openExternal },
    };

    await mount();

    expect(screen.queryByLabelText('Email')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue in browser' })
    );
    expect(openExternal).toHaveBeenCalledWith(
      'https://app.example.test/auth/forgot-password'
    );
    expect(createOptionalClient).not.toHaveBeenCalled();
  });

  it('makes absent account recovery an honest inert state', async () => {
    const openExternal = vi.fn(async () => undefined);
    distributionState.current = COMMUNITY_DISTRIBUTION;
    createOptionalClient.mockReturnValue(null);
    (window as { electron?: unknown }).electron = {
      isElectron: true,
      pty: { openExternal },
    };

    await mount();

    expect(
      screen.getByText('Password recovery is not configured in this build.')
    ).toBeVisible();
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Continue in browser' })
    ).toBeNull();
    expect(openExternal).not.toHaveBeenCalled();
    expect(createOptionalClient).not.toHaveBeenCalled();
  });
});

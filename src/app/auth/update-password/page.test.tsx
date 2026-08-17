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
  type DistributionContractV1,
} from '@exawatt/core/distribution';
import UpdatePasswordPage from './page';

const CONFIGURED_DISTRIBUTION = {
  ...COMMUNITY_DISTRIBUTION,
  account: {
    supabaseUrl: 'https://accounts.example.test',
    supabaseAnonKey: 'public-test-key',
    recoveryOrigin: 'https://app.example.test',
  },
} satisfies DistributionContractV1;

const {
  createOptionalClient,
  distributionState,
  getSession,
  session,
  updateUser,
} = vi.hoisted(() => ({
  distributionState: { current: undefined as unknown },
  session: { current: null as { user: { id: string } } | null },
  createOptionalClient: vi.fn(),
  getSession: vi.fn(),
  updateUser: vi.fn(async () => ({ error: null })),
}));

vi.mock('@/lib/distribution/resolved', () => ({
  resolvedDistribution: () => distributionState.current,
}));

vi.mock('@/lib/supabase/client', () => ({ createOptionalClient }));

async function mount() {
  render(<UpdatePasswordPage />);
  await act(async () => {});
}

beforeEach(() => {
  distributionState.current = CONFIGURED_DISTRIBUTION;
  session.current = { user: { id: 'user-1' } };
  getSession.mockReset();
  getSession.mockImplementation(async () => ({
    data: { session: session.current },
  }));
  updateUser.mockClear();
  createOptionalClient.mockReset();
  createOptionalClient.mockReturnValue({
    auth: { getSession, updateUser },
  });
});

afterEach(cleanup);

describe('password update', () => {
  it('writes the new password once the recovery session is in place', async () => {
    await mount();

    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'correct horse' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'correct horse' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
    });

    expect(createOptionalClient).toHaveBeenCalledWith(CONFIGURED_DISTRIBUTION);
    expect(updateUser).toHaveBeenCalledWith({ password: 'correct horse' });
    expect(screen.getByText('Password updated')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute(
      'href',
      '/workspace'
    );
  });

  it('refuses a mismatch without calling the service', async () => {
    await mount();

    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'correct horse' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'battery staple' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
    });

    expect(updateUser).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Those passwords do not match.'
    );
  });

  it('says the link is spent instead of showing a form that cannot work', async () => {
    session.current = null;

    await mount();

    expect(screen.queryByLabelText('New password')).toBeNull();
    expect(
      screen.getByText('That reset link has expired or was already used.')
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Request a new link' })
    ).toHaveAttribute('href', '/auth/forgot-password');
  });

  it('does not construct a client when account recovery is absent', async () => {
    distributionState.current = COMMUNITY_DISTRIBUTION;
    createOptionalClient.mockReturnValue(null);

    await mount();

    expect(
      screen.getByText('Password recovery is not configured in this build.')
    ).toBeVisible();
    expect(screen.queryByLabelText('New password')).toBeNull();
    expect(
      screen.queryByRole('link', { name: 'Request a new link' })
    ).toBeNull();
    expect(getSession).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });
});

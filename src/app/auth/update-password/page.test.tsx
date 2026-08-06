import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UpdatePasswordPage from './page';

const { getSession, updateUser, session } = vi.hoisted(() => ({
  session: { current: null as { user: { id: string } } | null },
  getSession: vi.fn(),
  updateUser: vi.fn(async () => ({ error: null })),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: session.current } }),
      updateUser,
    },
  }),
}));

async function mount() {
  render(<UpdatePasswordPage />);
  await act(async () => {});
}

beforeEach(() => {
  session.current = { user: { id: 'user-1' } };
  getSession.mockClear();
  updateUser.mockClear();
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
});

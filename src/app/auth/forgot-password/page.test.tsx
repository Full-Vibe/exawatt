import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ForgotPasswordPage from './page';
import { HOSTED_FORGOT_PASSWORD_URL } from '@/components/auth/hosted-auth';

const { resetPasswordForEmail } = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(async () => ({ error: null })),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { resetPasswordForEmail } }),
}));

async function mount() {
  render(<ForgotPasswordPage />);
  await act(async () => {});
}

beforeEach(() => {
  resetPasswordForEmail.mockClear();
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

    expect(resetPasswordForEmail).toHaveBeenCalledWith('invitee@example.com', {
      redirectTo: `${window.location.origin}/auth/callback?next=%2Fauth%2Fupdate-password`,
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

  it('hands the desktop app off to the browser that will open the email', async () => {
    const openExternal = vi.fn(async () => undefined);
    (window as { electron?: unknown }).electron = {
      isElectron: true,
      pty: { openExternal },
    };

    await mount();

    // the packaged renderer's ephemeral 127.0.0.1 origin cannot receive the
    // link later, so the whole flow moves to the stable hosted origin
    expect(screen.queryByLabelText('Email')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continue in browser' }));
    expect(openExternal).toHaveBeenCalledWith(HOSTED_FORGOT_PASSWORD_URL);
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

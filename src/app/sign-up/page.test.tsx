import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({
  createOptionalClient: () => null,
}));

import SignUpPage from './page';

describe('sign-up distribution capability', () => {
  it('shows the shared account absence state without rendering a form', () => {
    render(<SignUpPage />);

    expect(screen.getByText("Accounts aren't configured")).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Open workspace' })
    ).toHaveAttribute('href', '/workspace');
    expect(screen.queryByLabelText('Email')).toBeNull();
  });
});

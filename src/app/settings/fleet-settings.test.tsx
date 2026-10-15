// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FleetSettings } from './fleet-settings';
import { PresentationProvider } from '@/components/presentation/presentation-provider';
import { PRESENTATION_STORAGE_KEY } from '@/lib/presentation/preference-source';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  localStorage.clear();
});
const renderSettings = () =>
  render(
    <PresentationProvider>
      <FleetSettings />
    </PresentationProvider>
  );

describe('Fleet view offer gate', () => {
  it('lets development explicitly choose and persist the preview', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    renderSettings();
    const preview = screen.getByRole('button', { name: /v2/ });
    await waitFor(() => expect(preview).not.toBeDisabled());
    fireEvent.click(preview);
    await waitFor(() =>
      expect(preview).toHaveAttribute('aria-pressed', 'true')
    );
    expect(JSON.parse(localStorage.getItem(PRESENTATION_STORAGE_KEY)!)).toEqual(
      { schemaVersion: 1, fleetView: 'v2' }
    );
  });
  it('does not offer unfinished v2 in production or overwrite a saved development choice', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    localStorage.setItem(
      PRESENTATION_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, fleetView: 'v2' })
    );
    renderSettings();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'v1' })).not.toBeDisabled()
    );
    expect(
      screen.queryByRole('button', { name: /v2/ })
    ).not.toBeInTheDocument();
    expect(
      JSON.parse(localStorage.getItem(PRESENTATION_STORAGE_KEY)!).fleetView
    ).toBe('v2');
  });
});

// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FLEET_MATERIALS } from '@exawatt/core/desktop-bridge';
import { FleetSettings } from './fleet-settings';
import { PresentationProvider } from '@/components/presentation/presentation-provider';
import {
  PRESENTATION_STORAGE_KEY,
  createPresentationPreferenceSource,
} from '@/lib/presentation/preference-source';

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

describe('Fleet presentation choices', () => {
  it.each(['development', 'production'])(
    'persists an explicit v2 choice in %s',
    async environment => {
      vi.stubEnv('NODE_ENV', environment);
      renderSettings();
      const preview = screen.getByRole('button', { name: /v2/ });
      await waitFor(() => expect(preview).not.toBeDisabled());
      expect(screen.getByRole('button', { name: /^v1/ })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      expect(localStorage.getItem(PRESENTATION_STORAGE_KEY)).toBeNull();
      fireEvent.click(preview);
      await waitFor(() =>
        expect(preview).toHaveAttribute('aria-pressed', 'true')
      );
      expect(await createPresentationPreferenceSource().load()).toEqual({
        schemaVersion: 1,
        fleetView: 'v2',
      });
    }
  );
  it('offers every catalog material without changing the selected view', async () => {
    renderSettings();
    for (const material of FLEET_MATERIALS) {
      const button = screen.getByRole('button', {
        name: material.name,
      });
      await waitFor(() => expect(button).not.toBeDisabled());
      fireEvent.click(button);
      await waitFor(() =>
        expect(button).toHaveAttribute('aria-pressed', 'true')
      );
      expect(await createPresentationPreferenceSource().load()).toEqual({
        schemaVersion: 1,
        fleetMaterial: material.id,
      });
    }
  });
  it('restores a saved choice in production without rewriting it', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const saved = JSON.stringify({
      schemaVersion: 1,
      fleetView: 'v2',
      fleetMaterial: 'matte',
    });
    localStorage.setItem(PRESENTATION_STORAGE_KEY, saved);
    renderSettings();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /v2/ })).not.toBeDisabled()
    );
    expect(screen.getByRole('button', { name: /v2/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(localStorage.getItem(PRESENTATION_STORAGE_KEY)).toBe(saved);
  });
});

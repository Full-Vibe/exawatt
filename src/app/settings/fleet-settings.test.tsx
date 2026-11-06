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
      const preview = screen.getByRole('radio', { name: /v2/ });
      await waitFor(() => expect(preview).not.toBeDisabled());
      expect(screen.getByRole('radio', { name: /^v1/ })).toHaveAttribute(
        'aria-checked',
        'true'
      );
      expect(localStorage.getItem(PRESENTATION_STORAGE_KEY)).toBeNull();
      fireEvent.click(preview);
      await waitFor(() =>
        expect(preview).toHaveAttribute('aria-checked', 'true')
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
      const button = screen.getByRole('radio', {
        name: material.name,
      });
      await waitFor(() => expect(button).not.toBeDisabled());
      fireEvent.click(button);
      await waitFor(() =>
        expect(button).toHaveAttribute('aria-checked', 'true')
      );
      expect(await createPresentationPreferenceSource().load()).toEqual({
        schemaVersion: 1,
        fleetMaterial: material.id,
      });
    }
  });
  it('names each view, material and the reset by id', async () => {
    renderSettings();
    await waitFor(() =>
      expect(document.querySelector('[data-fleet-material]')).not.toBeDisabled()
    );
    expect(
      Array.from(
        document.querySelectorAll('#fleet-view [data-settings-option]'),
        element => element.getAttribute('data-settings-option')
      )
    ).toEqual(['v1', 'v2']);
    expect(
      Array.from(document.querySelectorAll('[data-fleet-material]'), element =>
        element.getAttribute('data-fleet-material')
      )
    ).toEqual(FLEET_MATERIALS.map(material => material.id));
    const choice = FLEET_MATERIALS.at(-1)!.id;
    fireEvent.click(
      document.querySelector(`[data-fleet-material="${choice}"]`)!
    );
    await waitFor(() =>
      expect(
        document.querySelector('[data-fleet-material-reset]')
      ).not.toBeDisabled()
    );
    fireEvent.click(document.querySelector('[data-fleet-material-reset]')!);
    await waitFor(() =>
      expect(
        document.querySelector('[data-fleet-material-reset]')
      ).toBeDisabled()
    );
    expect(
      (await createPresentationPreferenceSource().load())?.fleetMaterial
    ).toBeUndefined();
  });
  it('draws the view and the material with the one shared choice control', async () => {
    renderSettings();
    const preview = document.querySelector('[data-settings-option="v2"]')!;
    await waitFor(() => expect(preview).not.toBeDisabled());
    fireEvent.click(preview);
    await waitFor(() =>
      expect(preview).toHaveAttribute('aria-checked', 'true')
    );
    // BUG-326: v2 read as selected only by its label turning white. Both
    // controls are now the same component, so the chosen view carries the
    // same selected state the chosen material does, in every theme.
    for (const selector of [
      '[data-settings-option]',
      '[data-fleet-material]',
    ]) {
      const options = Array.from(document.querySelectorAll(selector));
      expect(options.length).toBeGreaterThan(1);
      for (const option of options) {
        expect(option.closest('[data-choice-group]')).not.toBeNull();
        expect(option.hasAttribute('data-selected')).toBe(
          option.getAttribute('aria-checked') === 'true'
        );
      }
    }
    expect(preview).toHaveAttribute('data-selected');
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
      expect(screen.getByRole('radio', { name: /v2/ })).not.toBeDisabled()
    );
    expect(screen.getByRole('radio', { name: /v2/ })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(localStorage.getItem(PRESENTATION_STORAGE_KEY)).toBe(saved);
  });
});

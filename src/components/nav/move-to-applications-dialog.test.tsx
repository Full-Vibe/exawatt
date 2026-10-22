import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  MoveToApplicationsOffer,
  MoveToApplicationsOutcome,
} from '@exawatt/core/desktop-bridge';
import {
  installBridgeDouble,
  removeBridgeDouble,
} from '@/test-support/desktop-bridge-double';
import { MoveToApplicationsDialog } from './move-to-applications-dialog';

const OFFER: MoveToApplicationsOffer = {
  location: '/Users/someone/Downloads/Exawatt.app',
};

afterEach(removeBridgeDouble);

function installMain(options: {
  offer?: MoveToApplicationsOffer | null;
  dismissals?: Record<string, string>;
  outcome?: MoveToApplicationsOutcome;
}) {
  const main = {
    dismissals: { ...options.dismissals },
    moves: 0,
  };
  installBridgeDouble({
    app: {
      getBuildInfo: async () => {
        throw new Error('unused');
      },
      moveToApplicationsOffer: async () => options.offer ?? null,
      moveToApplications: async () => {
        main.moves += 1;
        return options.outcome ?? 'moving';
      },
      noticeDismissals: async () => ({ ...main.dismissals }),
      dismissNotice: async (id, version) => {
        main.dismissals = { ...main.dismissals, [id]: version };
        return { ...main.dismissals };
      },
      onNoticeDismissalsChanged: () => () => undefined,
    },
  });
  return main;
}

const dialog = () =>
  document.querySelector<HTMLElement>('[data-move-to-applications]');

describe('MoveToApplicationsDialog', () => {
  it('asks once per location, and Not Now is kept in main’s record', async () => {
    const main = installMain({ offer: OFFER });
    render(<MoveToApplicationsDialog />);
    await waitFor(() => expect(dialog()).not.toBeNull());

    fireEvent.click(
      document.querySelector('[data-move-to-applications-decline]')!
    );
    await waitFor(() => expect(dialog()).toBeNull());
    expect(main.dismissals).toEqual({ 'move-to-applications': OFFER.location });
    expect(main.moves).toBe(0);
  });

  it('Escape declines, as Cancel does', async () => {
    const main = installMain({ offer: OFFER });
    render(<MoveToApplicationsDialog />);
    await waitFor(() => expect(dialog()).not.toBeNull());
    fireEvent.keyDown(dialog()!, { key: 'Escape' });
    await waitFor(() =>
      expect(main.dismissals['move-to-applications']).toBe(OFFER.location)
    );
  });

  it('stays quiet with no offer, or one already declined here', async () => {
    installMain({ offer: null });
    const first = render(<MoveToApplicationsDialog />);
    await act(async () => undefined);
    expect(dialog()).toBeNull();
    first.unmount();

    installMain({
      offer: OFFER,
      dismissals: { 'move-to-applications': OFFER.location },
    });
    render(<MoveToApplicationsDialog />);
    await act(async () => undefined);
    expect(dialog()).toBeNull();
  });

  it('moves from its default button, and stays open to say what stopped it', async () => {
    const main = installMain({ offer: OFFER, outcome: 'other-copy-open' });
    render(<MoveToApplicationsDialog />);
    await waitFor(() => expect(dialog()).not.toBeNull());
    const description = dialog()!.querySelector(
      '[data-slot="dialog-description"]'
    )!.textContent;

    fireEvent.click(
      dialog()!.querySelector('[data-slot="dialog-primary-action"]')!
    );
    await waitFor(() => expect(main.moves).toBe(1));
    await waitFor(() =>
      expect(
        dialog()!.querySelector('[data-slot="dialog-description"]')!.textContent
      ).not.toBe(description)
    );
    expect(main.dismissals).toEqual({});
  });

  it('a move that relaunches leaves the dialog to the closing window', async () => {
    const main = installMain({ offer: OFFER, outcome: 'moving' });
    render(<MoveToApplicationsDialog />);
    await waitFor(() => expect(dialog()).not.toBeNull());
    fireEvent.click(
      dialog()!.querySelector('[data-slot="dialog-primary-action"]')!
    );
    await waitFor(() => expect(main.moves).toBe(1));
    expect(
      dialog()!.querySelector<HTMLButtonElement>(
        '[data-move-to-applications-decline]'
      )!.disabled
    ).toBe(true);
  });
});

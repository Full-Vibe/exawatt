import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DirectoryPickOutcome } from '@exawatt/core/desktop-bridge';
import {
  installBridgeDouble,
  removeBridgeDouble,
} from '@/test-support/desktop-bridge-double';
import {
  reportFolderFailure,
  requestDirectory,
  useFolderRequestPending,
} from './native-dialog';
import { NativeDialogNotice } from './native-dialog-notice';

/** A bridge whose folder request the test answers. */
function bridgeAnsweredByTest() {
  let answer!: (outcome: DirectoryPickOutcome) => void;
  let fail!: (cause: unknown) => void;
  const openDirectory = vi.fn(
    () =>
      new Promise<DirectoryPickOutcome>((resolve, reject) => {
        answer = resolve;
        fail = reject;
      })
  );
  installBridgeDouble({ dialog: { openDirectory } });
  return {
    openDirectory,
    answer: (outcome: DirectoryPickOutcome) => answer(outcome),
    fail: (cause: unknown) => fail(cause),
  };
}

afterEach(() => removeBridgeDouble());

const failureNotice = () =>
  document.querySelector('[data-native-dialog-failure]');

describe('requestDirectory', () => {
  it('passes the picked folder through', async () => {
    const bridge = bridgeAnsweredByTest();
    const request = requestDirectory('Open Project');
    await waitFor(() => expect(bridge.openDirectory).toHaveBeenCalledOnce());
    bridge.answer({ status: 'picked', path: '/p' });
    await expect(request).resolves.toEqual({ status: 'picked', path: '/p' });
  });

  it('settles a bridge call that throws as a failure, never a rejection', async () => {
    const bridge = bridgeAnsweredByTest();
    const request = requestDirectory('Open Project');
    await waitFor(() => expect(bridge.openDirectory).toHaveBeenCalledOnce());
    bridge.fail(new Error('Error invoking remote method'));
    await expect(request).resolves.toEqual({
      status: 'failed',
      reason: 'error',
      detail: 'Error invoking remote method',
    });
  });

  it('answers busy without asking main while a request is up, and asks again once it settles', async () => {
    const bridge = bridgeAnsweredByTest();
    const first = requestDirectory('Open Project');
    await expect(requestDirectory('Locate A')).resolves.toEqual({
      status: 'failed',
      reason: 'busy',
    });
    await waitFor(() => expect(bridge.openDirectory).toHaveBeenCalledOnce());
    bridge.answer({ status: 'cancelled' });
    await first;

    const second = requestDirectory('Open Project');
    await waitFor(() => expect(bridge.openDirectory).toHaveBeenCalledTimes(2));
    bridge.answer({ status: 'cancelled' });
    await expect(second).resolves.toEqual({ status: 'cancelled' });
  });

  it('says there is nothing to ask outside the desktop app', async () => {
    removeBridgeDouble();
    render(<NativeDialogNotice />);
    await act(async () => {
      await expect(requestDirectory('Open Project')).resolves.toEqual({
        status: 'failed',
        reason: 'unavailable',
      });
    });
    expect(failureNotice()).not.toBeNull();
  });
});

/** A control that reads as unavailable while any folder request is up. */
function GuardedBrowse() {
  const pending = useFolderRequestPending();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => void requestDirectory('Open Project')}
    >
      Browse
    </button>
  );
}

/** A caller with no state of its own (the Start screen, ⌘K Locate). */
function DirectBrowse() {
  return (
    <button type="button" onClick={() => void requestDirectory('Open Project')}>
      Import
    </button>
  );
}

describe('the door owns what a request owes the screen', () => {
  const outcomes: DirectoryPickOutcome[] = [
    { status: 'picked', path: '/p' },
    { status: 'cancelled' },
    { status: 'failed', reason: 'not-presented' },
    { status: 'failed', reason: 'error', detail: 'x' },
  ];

  for (const outcome of outcomes) {
    it(`releases the control and hands focus back after ${outcome.status}${'reason' in outcome ? ` (${outcome.reason})` : ''}`, async () => {
      const bridge = bridgeAnsweredByTest();
      render(<GuardedBrowse />);
      const browse = screen.getByRole('button', { name: 'Browse' });
      browse.focus();
      fireEvent.click(browse);

      await waitFor(() => expect(browse).toBeDisabled());
      expect(document.activeElement).not.toBe(browse);

      await act(async () => bridge.answer(outcome));
      await waitFor(() => expect(browse).toBeEnabled());
      expect(document.activeElement).toBe(browse);
    });
  }

  it('hands focus back to a caller that keeps no state of its own', async () => {
    const bridge = bridgeAnsweredByTest();
    render(<DirectBrowse />);
    const control = screen.getByRole('button', { name: 'Import' });
    control.focus();
    fireEvent.click(control);
    await waitFor(() => expect(bridge.openDirectory).toHaveBeenCalledOnce());
    expect(document.activeElement).not.toBe(control);

    await act(async () => bridge.answer({ status: 'cancelled' }));
    expect(document.activeElement).toBe(control);
  });

  it('releases the control when the bridge call throws', async () => {
    const bridge = bridgeAnsweredByTest();
    render(<GuardedBrowse />);
    const browse = screen.getByRole('button', { name: 'Browse' });
    fireEvent.click(browse);
    await waitFor(() => expect(browse).toBeDisabled());
    await act(async () => bridge.fail(new Error('gone')));
    await waitFor(() => expect(browse).toBeEnabled());
  });

  it('leaves focus where the screen moved it while the sheet was up', async () => {
    const bridge = bridgeAnsweredByTest();
    render(
      <>
        <GuardedBrowse />
        <input aria-label="Elsewhere" />
      </>
    );
    const browse = screen.getByRole('button', { name: 'Browse' });
    browse.focus();
    fireEvent.click(browse);
    await waitFor(() => expect(browse).toBeDisabled());
    screen.getByLabelText('Elsewhere').focus();
    await act(async () => bridge.answer({ status: 'cancelled' }));
    await waitFor(() => expect(browse).toBeEnabled());
    expect(document.activeElement).toBe(screen.getByLabelText('Elsewhere'));
  });

  it('reports every failure in the one notice, whichever control asked, and nothing for cancel or busy', async () => {
    const bridge = bridgeAnsweredByTest();
    render(
      <>
        <GuardedBrowse />
        <DirectBrowse />
        <NativeDialogNotice />
      </>
    );
    const browse = screen.getByRole('button', { name: 'Browse' });
    const direct = screen.getByRole('button', { name: 'Import' });

    fireEvent.click(direct);
    await waitFor(() => expect(bridge.openDirectory).toHaveBeenCalledTimes(1));
    await act(async () =>
      bridge.answer({ status: 'failed', reason: 'not-presented' })
    );
    expect(failureNotice()).not.toBeNull();

    // The next request clears it; a cancel has nothing to say.
    fireEvent.click(browse);
    await waitFor(() => expect(failureNotice()).toBeNull());
    await act(async () => bridge.answer({ status: 'cancelled' }));
    expect(failureNotice()).toBeNull();

    fireEvent.click(browse);
    await waitFor(() => expect(bridge.openDirectory).toHaveBeenCalledTimes(3));
    await act(async () => bridge.answer({ status: 'failed', reason: 'busy' }));
    expect(failureNotice()).toBeNull();

    fireEvent.click(browse);
    await waitFor(() => expect(bridge.openDirectory).toHaveBeenCalledTimes(4));
    await act(async () =>
      bridge.answer({ status: 'failed', reason: 'error', detail: 'x' })
    );
    expect(failureNotice()).not.toBeNull();
  });

  it('carries a later step of a folder flow in the same notice', async () => {
    render(<NativeDialogNotice />);
    act(() => reportFolderFailure('That folder is not a Project.'));
    expect(failureNotice()).not.toBeNull();
  });
});

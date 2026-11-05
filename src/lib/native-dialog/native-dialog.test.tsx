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
  nativeDialogFailureMessage,
  requestDirectory,
  useNativeDialog,
} from './native-dialog';

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
    await expect(requestDirectory('Open Project')).resolves.toEqual({
      status: 'failed',
      reason: 'unavailable',
    });
  });

  it('has words for every failure the operator should hear about, and none for cancel or busy', () => {
    expect(nativeDialogFailureMessage({ status: 'cancelled' })).toBeNull();
    expect(
      nativeDialogFailureMessage({ status: 'failed', reason: 'busy' })
    ).toBeNull();
    for (const reason of ['not-presented', 'unavailable', 'error'] as const) {
      expect(nativeDialogFailureMessage({ status: 'failed', reason })).toEqual(
        expect.any(String)
      );
    }
  });
});

describe('useNativeDialog', () => {
  function Asker({
    onOutcome,
  }: {
    onOutcome: (o: DirectoryPickOutcome) => void;
  }) {
    const picker = useNativeDialog<'browse'>();
    return (
      <>
        <button
          type="button"
          disabled={picker.pending !== null}
          onClick={() =>
            void picker.pickDirectory('browse', 'Open Project').then(onOutcome)
          }
        >
          Browse
        </button>
        <output>{picker.pending ?? 'idle'}</output>
      </>
    );
  }

  const outcomes: DirectoryPickOutcome[] = [
    { status: 'picked', path: '/p' },
    { status: 'cancelled' },
    { status: 'failed', reason: 'not-presented' },
    { status: 'failed', reason: 'error', detail: 'x' },
  ];

  for (const outcome of outcomes) {
    it(`releases the control and hands focus back after ${outcome.status}${'reason' in outcome ? ` (${outcome.reason})` : ''}`, async () => {
      const bridge = bridgeAnsweredByTest();
      const onOutcome = vi.fn();
      render(<Asker onOutcome={onOutcome} />);
      const browse = screen.getByRole('button', { name: 'Browse' });
      browse.focus();
      fireEvent.click(browse);

      await waitFor(() => expect(browse).toBeDisabled());
      expect(screen.getByRole('status')).toHaveTextContent('browse');
      expect(document.activeElement).not.toBe(browse);

      await act(async () => bridge.answer(outcome));
      await waitFor(() => expect(browse).toBeEnabled());
      expect(screen.getByRole('status')).toHaveTextContent('idle');
      expect(document.activeElement).toBe(browse);
      expect(onOutcome).toHaveBeenCalledWith(outcome);
    });
  }

  it('releases the control when the bridge call throws', async () => {
    const bridge = bridgeAnsweredByTest();
    render(<Asker onOutcome={vi.fn()} />);
    const browse = screen.getByRole('button', { name: 'Browse' });
    fireEvent.click(browse);
    await waitFor(() => expect(browse).toBeDisabled());
    await act(async () => bridge.fail(new Error('gone')));
    await waitFor(() => expect(browse).toBeEnabled());
  });

  it('leaves focus where the surface moved it while the sheet was up', async () => {
    const bridge = bridgeAnsweredByTest();
    render(
      <>
        <Asker onOutcome={vi.fn()} />
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
});

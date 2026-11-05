import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MessageBoxReturnValue, OpenDialogReturnValue } from 'electron';
import {
  createNativeDialogBroker,
  SHEET_PRESENTATION_DEADLINE_MS,
  type DialogParent,
} from './native-dialogs';

/** A window as the broker sees it, with AppKit's sheet announcement. */
function window(id: number) {
  const listeners = new Set<() => void>();
  return {
    id,
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    once: vi.fn((_event: 'sheet-begin', listener: () => void) => {
      listeners.add(listener);
    }),
    removeListener: vi.fn((_event: 'sheet-begin', listener: () => void) => {
      listeners.delete(listener);
    }),
    /** AppKit begins a sheet on this window. */
    beginSheet() {
      for (const listener of [...listeners]) {
        listeners.delete(listener);
        listener();
      }
    },
  } satisfies DialogParent & { beginSheet(): void };
}
type TestWindow = ReturnType<typeof window>;

/** A native panel the test answers, optionally announcing a sheet. */
function panels() {
  const open: Array<{
    parent: TestWindow | null;
    title: string | undefined;
    answer: (value: OpenDialogReturnValue) => void;
    fail: (error: Error) => void;
  }> = [];
  const showOpenDialog = vi.fn(
    (parent: TestWindow | null, options: Electron.OpenDialogOptions) =>
      new Promise<OpenDialogReturnValue>((answer, fail) => {
        open.push({ parent, title: options.title, answer, fail });
      })
  );
  return { open, showOpenDialog };
}

function broker(
  overrides: Partial<
    Parameters<typeof createNativeDialogBroker<TestWindow>>[0]
  > = {}
) {
  const record = vi.fn();
  const native = panels();
  const showMessageBox = vi.fn(
    async (): Promise<MessageBoxReturnValue> => ({
      response: 0,
      checkboxChecked: false,
    })
  );
  const dialogs = createNativeDialogBroker<TestWindow>({
    platform: 'darwin',
    showOpenDialog: native.showOpenDialog,
    showMessageBox,
    record,
    ...overrides,
  });
  return { dialogs, record, native, showMessageBox };
}

const picked = (path: string): OpenDialogReturnValue => ({
  canceled: false,
  filePaths: [path],
});
const cancelled: OpenDialogReturnValue = { canceled: true, filePaths: [] };

afterEach(() => {
  vi.useRealTimers();
});

describe('native dialog broker', () => {
  it('attaches the folder picker to the window that asked', async () => {
    const { dialogs, native } = broker();
    const parent = window(1);
    const request = dialogs.openDirectory(parent, 'Open Project');
    await vi.waitFor(() => expect(native.open).toHaveLength(1));
    parent.beginSheet();
    native.open[0].answer(picked('/project'));

    await expect(request).resolves.toEqual({
      status: 'picked',
      path: '/project',
    });
    expect(parent.focus).toHaveBeenCalledOnce();
    expect(native.showOpenDialog).toHaveBeenCalledWith(parent, {
      title: 'Open Project',
      properties: ['openDirectory', 'createDirectory'],
    });
  });

  it('settles a request AppKit never begins a sheet for, and records it', async () => {
    vi.useFakeTimers();
    const { dialogs, native, record } = broker();
    const parent = window(1);
    const request = dialogs.openDirectory(parent, 'Open Project');
    await vi.waitFor(() => expect(native.open).toHaveLength(1));

    await vi.advanceTimersByTimeAsync(SHEET_PRESENTATION_DEADLINE_MS);

    await expect(request).resolves.toEqual({
      status: 'failed',
      reason: 'not-presented',
    });
    expect(record).toHaveBeenCalledWith(
      'native-dialog.failed',
      expect.objectContaining({
        kind: 'open-directory',
        reason: 'not-presented',
      })
    );
    // The window's turn passed on: the next request reaches AppKit.
    const retry = dialogs.openDirectory(parent, 'Open Project');
    await vi.waitFor(() => expect(native.open).toHaveLength(2));
    parent.beginSheet();
    native.open[1].answer(cancelled);
    await expect(retry).resolves.toEqual({ status: 'cancelled' });
  });

  it('waits as long as the operator needs once the sheet has begun', async () => {
    vi.useFakeTimers();
    const { dialogs, native } = broker();
    const parent = window(1);
    const request = dialogs.openDirectory(parent, 'Open Project');
    await vi.waitFor(() => expect(native.open).toHaveLength(1));
    parent.beginSheet();

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    native.open[0].answer(picked('/slow'));

    await expect(request).resolves.toEqual({ status: 'picked', path: '/slow' });
  });

  it('refuses a second picker on the same window instead of answering it with the first folder', async () => {
    const { dialogs, native } = broker();
    const parent = window(1);
    const first = dialogs.openDirectory(parent, 'Open Project');
    const second = dialogs.openDirectory(parent, 'Locate Moved Project');

    await expect(second).resolves.toEqual({ status: 'failed', reason: 'busy' });
    await vi.waitFor(() => expect(native.open).toHaveLength(1));
    parent.beginSheet();
    native.open[0].answer(picked('/first'));
    await expect(first).resolves.toEqual({ status: 'picked', path: '/first' });
  });

  it('never answers one window with the folder another window picked', async () => {
    const { dialogs, native } = broker();
    const a = window(1);
    const b = window(2);
    const fromA = dialogs.openDirectory(a, 'Open Project');
    const fromB = dialogs.openDirectory(b, 'Locate Moved Project');
    await vi.waitFor(() => expect(native.open).toHaveLength(2));
    a.beginSheet();
    b.beginSheet();
    native.open[0].answer(picked('/a'));
    native.open[1].answer(cancelled);

    await expect(fromA).resolves.toEqual({ status: 'picked', path: '/a' });
    await expect(fromB).resolves.toEqual({ status: 'cancelled' });
  });

  it('turns a thrown native call into a failure with its reason', async () => {
    const { dialogs, native, record } = broker();
    const parent = window(1);
    const request = dialogs.openDirectory(parent, 'Open Project');
    await vi.waitFor(() => expect(native.open).toHaveLength(1));
    native.open[0].fail(new Error('NSOpenPanel unavailable'));

    await expect(request).resolves.toEqual({
      status: 'failed',
      reason: 'error',
      detail: 'NSOpenPanel unavailable',
    });
    expect(record).toHaveBeenCalledWith(
      'native-dialog.failed',
      expect.objectContaining({ reason: 'error' })
    );
  });

  it('opens a standalone panel when the window that asked is gone', async () => {
    const { dialogs, native } = broker();
    const parent = window(1);
    parent.isDestroyed.mockReturnValue(true);
    const request = dialogs.openDirectory(parent, 'x'.repeat(200));
    await vi.waitFor(() => expect(native.open).toHaveLength(1));
    native.open[0].answer(cancelled);

    await expect(request).resolves.toEqual({ status: 'cancelled' });
    expect(parent.focus).not.toHaveBeenCalled();
    expect(native.showOpenDialog).toHaveBeenCalledWith(null, {
      title: 'Open project directory',
      properties: ['openDirectory', 'createDirectory'],
    });
  });

  it('does not wait for a sheet on platforms without one', async () => {
    vi.useFakeTimers();
    const { dialogs, native } = broker({ platform: 'linux' });
    const request = dialogs.openDirectory(window(1), 'Open Project');
    await vi.waitFor(() => expect(native.open).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(SHEET_PRESENTATION_DEADLINE_MS * 5);
    native.open[0].answer(picked('/p'));
    await expect(request).resolves.toEqual({ status: 'picked', path: '/p' });
  });

  it("lets a window's message box take its turn after the picker", async () => {
    const { dialogs, native, showMessageBox } = broker();
    const parent = window(1);
    const picker = dialogs.openDirectory(parent, 'Open Project');
    const confirm = dialogs.messageBox(parent, {
      message: 'Quit?',
      buttons: ['Quit', 'Cancel'],
    });
    await vi.waitFor(() => expect(native.open).toHaveLength(1));
    expect(showMessageBox).not.toHaveBeenCalled();
    parent.beginSheet();
    native.open[0].answer(cancelled);

    await expect(picker).resolves.toEqual({ status: 'cancelled' });
    await expect(confirm).resolves.toEqual({
      response: 0,
      checkboxChecked: false,
    });
    expect(showMessageBox).toHaveBeenCalledWith(parent, {
      message: 'Quit?',
      buttons: ['Quit', 'Cancel'],
    });
  });

  it('answers a message box aborted in line with its cancel button, unshown', async () => {
    const { dialogs, native, showMessageBox } = broker();
    const parent = window(1);
    const picker = dialogs.openDirectory(parent, 'Open Project');
    const abort = new AbortController();
    const prompt = dialogs.messageBox(parent, {
      message: 'Not responding',
      buttons: ['Wait', 'Reload'],
      cancelId: 0,
      signal: abort.signal,
    });
    abort.abort();
    await vi.waitFor(() => expect(native.open).toHaveLength(1));
    parent.beginSheet();
    native.open[0].answer(cancelled);
    await picker;

    await expect(prompt).resolves.toEqual({
      response: 0,
      checkboxChecked: false,
    });
    expect(showMessageBox).not.toHaveBeenCalled();
  });

  it('keeps the line moving after a message box throws', async () => {
    const { dialogs, showMessageBox } = broker();
    showMessageBox.mockRejectedValueOnce(new Error('boom'));
    await expect(dialogs.messageBox(null, { message: 'one' })).rejects.toThrow(
      'boom'
    );
    await expect(dialogs.messageBox(null, { message: 'two' })).resolves.toEqual(
      {
        response: 0,
        checkboxChecked: false,
      }
    );
  });
});

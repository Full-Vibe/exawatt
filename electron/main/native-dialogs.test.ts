import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  MessageBoxOptions,
  MessageBoxReturnValue,
  OpenDialogReturnValue,
} from 'electron';
import {
  createNativeDialogBroker,
  SHEET_PRESENTATION_DEADLINE_MS,
  type DialogParent,
} from './native-dialogs';

type WindowEvent = 'sheet-begin' | 'sheet-end' | 'closed';

/**
 * A window as the broker sees it. Only the test announces sheets, the way
 * only AppKit does: `beginSheet` / `endSheet` stand for `sheet-begin` /
 * `sheet-end`, whoever showed the sheet (the broker's own panel, or one
 * Chromium shows itself).
 */
function window(id: number) {
  const listeners = new Map<WindowEvent, Array<() => void>>();
  let destroyed = false;
  const emit = (event: WindowEvent) => {
    for (const listener of listeners.get(event) ?? []) listener();
  };
  return {
    id,
    focus: vi.fn(),
    isDestroyed: () => destroyed,
    on(event: WindowEvent, listener: () => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return this;
    },
    beginSheet: () => emit('sheet-begin'),
    endSheet: () => emit('sheet-end'),
    close() {
      destroyed = true;
      emit('closed');
    },
  } satisfies DialogParent & Record<string, unknown>;
}
type TestWindow = ReturnType<typeof window>;

/** Native panels and boxes the test answers. */
function natives() {
  const panels: Array<{
    parent: TestWindow | null;
    title: string | undefined;
    answer: (value: OpenDialogReturnValue) => void;
    fail: (error: Error) => void;
  }> = [];
  const boxes: Array<{
    parent: TestWindow | null;
    options: MessageBoxOptions;
    answer: (value: MessageBoxReturnValue) => void;
  }> = [];
  const showOpenDialog = vi.fn(
    (parent: TestWindow | null, options: Electron.OpenDialogOptions) =>
      new Promise<OpenDialogReturnValue>((answer, fail) => {
        panels.push({ parent, title: options.title, answer, fail });
      })
  );
  const showMessageBox = vi.fn(
    (parent: TestWindow | null, options: MessageBoxOptions) =>
      new Promise<MessageBoxReturnValue>(answer => {
        boxes.push({ parent, options, answer });
        // Electron answers an aborted box with its cancel button.
        options.signal?.addEventListener('abort', () =>
          answer({ response: options.cancelId ?? 0, checkboxChecked: false })
        );
      })
  );
  return { panels, boxes, showOpenDialog, showMessageBox };
}

function broker(
  overrides: Partial<
    Parameters<typeof createNativeDialogBroker<TestWindow>>[0]
  > = {}
) {
  const record = vi.fn();
  const native = natives();
  const dialogs = createNativeDialogBroker<TestWindow>({
    platform: 'darwin',
    showOpenDialog: native.showOpenDialog,
    showMessageBox: native.showMessageBox,
    record,
    ...overrides,
  });
  return { dialogs, record, native };
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
    await vi.waitFor(() => expect(native.panels).toHaveLength(1));
    parent.beginSheet();
    native.panels[0].answer(picked('/project'));

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

  it('answers a request AppKit never begins a sheet for, and records it', async () => {
    vi.useFakeTimers();
    const { dialogs, native, record } = broker();
    const parent = window(1);
    const request = dialogs.openDirectory(parent, 'Open Project');
    await vi.waitFor(() => expect(native.panels).toHaveLength(1));

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
        asked: true,
      })
    );
  });

  it('holds the window for a late panel instead of stacking a retry beside it', async () => {
    vi.useFakeTimers();
    const { dialogs, native, record } = broker();
    const parent = window(1);
    const first = dialogs.openDirectory(parent, 'Open Project');
    await vi.waitFor(() => expect(native.panels).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(SHEET_PRESENTATION_DEADLINE_MS);
    await expect(first).resolves.toMatchObject({ reason: 'not-presented' });

    // The operator retries; the first panel is still outstanding natively.
    const retry = dialogs.openDirectory(parent, 'Open Project');
    await vi.advanceTimersByTimeAsync(SHEET_PRESENTATION_DEADLINE_MS / 2);
    expect(native.panels).toHaveLength(1);

    // AppKit shows the first panel after all. The retry waits behind it for
    // as long as the operator takes, and its pick does nothing.
    parent.beginSheet();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(native.panels).toHaveLength(1);
    parent.endSheet();
    native.panels[0].answer(picked('/late'));
    await vi.waitFor(() => expect(native.panels).toHaveLength(2));
    expect(record).toHaveBeenCalledWith('native-dialog.late-answer', {
      kind: 'open-directory',
      status: 'picked',
    });

    parent.beginSheet();
    native.panels[1].answer(picked('/retry'));
    parent.endSheet();
    await expect(retry).resolves.toEqual({ status: 'picked', path: '/retry' });
  });

  it('answers a retry behind a panel that never appears within its own deadline', async () => {
    vi.useFakeTimers();
    const { dialogs, native } = broker();
    const parent = window(1);
    void dialogs.openDirectory(parent, 'Open Project');
    await vi.waitFor(() => expect(native.panels).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(SHEET_PRESENTATION_DEADLINE_MS);

    const retry = dialogs.openDirectory(parent, 'Open Project');
    await vi.advanceTimersByTimeAsync(SHEET_PRESENTATION_DEADLINE_MS);

    await expect(retry).resolves.toEqual({
      status: 'failed',
      reason: 'not-presented',
    });
    expect(native.panels).toHaveLength(1);
  });

  it('waits as long as the operator needs once the sheet has begun', async () => {
    vi.useFakeTimers();
    const { dialogs, native } = broker();
    const parent = window(1);
    const request = dialogs.openDirectory(parent, 'Open Project');
    await vi.waitFor(() => expect(native.panels).toHaveLength(1));
    parent.beginSheet();

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    native.panels[0].answer(picked('/slow'));

    await expect(request).resolves.toEqual({ status: 'picked', path: '/slow' });
  });

  it("counts a waiting request's deadline from the request, behind a box that never appears", async () => {
    vi.useFakeTimers();
    const { dialogs, native, record } = broker();
    // A box AppKit never begins and never settles, even when closed.
    native.showMessageBox.mockImplementationOnce(() => new Promise(() => {}));
    const parent = window(1);
    const prompt = dialogs.messageBox(parent, {
      message: 'Reload?',
      buttons: ['Reload', 'Cancel'],
      cancelId: 1,
    });
    const browse = dialogs.openDirectory(parent, 'Open Project');
    await vi.waitFor(() => expect(native.showMessageBox).toHaveBeenCalled());

    await vi.advanceTimersByTimeAsync(SHEET_PRESENTATION_DEADLINE_MS);

    // Both are answered: nothing holds the control that asked for a folder,
    // and the folder panel was never stacked behind the stuck box.
    await expect(prompt).resolves.toEqual({
      response: 1,
      checkboxChecked: false,
    });
    await expect(browse).resolves.toEqual({
      status: 'failed',
      reason: 'not-presented',
    });
    expect(native.showOpenDialog).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(
      'native-dialog.failed',
      expect.objectContaining({ kind: 'message-box', reason: 'not-presented' })
    );
    expect(record).toHaveBeenCalledWith(
      'native-dialog.failed',
      expect.objectContaining({
        kind: 'open-directory',
        reason: 'not-presented',
        asked: false,
      })
    );
  });

  it('closes a box that never appeared, so the window is free again', async () => {
    vi.useFakeTimers();
    const { dialogs, native } = broker();
    const parent = window(1);
    const prompt = dialogs.messageBox(parent, {
      message: 'Quit?',
      cancelId: 1,
    });
    await vi.waitFor(() => expect(native.boxes).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(SHEET_PRESENTATION_DEADLINE_MS);
    await expect(prompt).resolves.toEqual({
      response: 1,
      checkboxChecked: false,
    });
    expect(native.boxes[0].options.signal?.aborted).toBe(true);

    const next = dialogs.openDirectory(parent, 'Open Project');
    await vi.waitFor(() => expect(native.panels).toHaveLength(1));
    parent.beginSheet();
    native.panels[0].answer(cancelled);
    await expect(next).resolves.toEqual({ status: 'cancelled' });
  });

  it('waits behind a sheet Chromium shows itself, and asks when it closes', async () => {
    vi.useFakeTimers();
    const { dialogs, native } = broker();
    const parent = window(1);
    dialogs.watch(parent);
    // An <input type="file"> chooser, which never goes through the broker.
    parent.beginSheet();

    const request = dialogs.openDirectory(parent, 'Open Project');
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(native.panels).toHaveLength(0);

    parent.endSheet();
    await vi.waitFor(() => expect(native.panels).toHaveLength(1));
    parent.beginSheet();
    native.panels[0].answer(picked('/after'));
    await expect(request).resolves.toEqual({
      status: 'picked',
      path: '/after',
    });
  });

  it('refuses a second picker on the same window instead of answering it with the first folder', async () => {
    const { dialogs, native } = broker();
    const parent = window(1);
    const first = dialogs.openDirectory(parent, 'Open Project');
    const second = dialogs.openDirectory(parent, 'Locate Moved Project');

    await expect(second).resolves.toEqual({ status: 'failed', reason: 'busy' });
    await vi.waitFor(() => expect(native.panels).toHaveLength(1));
    parent.beginSheet();
    native.panels[0].answer(picked('/first'));
    await expect(first).resolves.toEqual({ status: 'picked', path: '/first' });
  });

  it('never answers one window with the folder another window picked', async () => {
    const { dialogs, native } = broker();
    const a = window(1);
    const b = window(2);
    const fromA = dialogs.openDirectory(a, 'Open Project');
    const fromB = dialogs.openDirectory(b, 'Locate Moved Project');
    await vi.waitFor(() => expect(native.panels).toHaveLength(2));
    a.beginSheet();
    b.beginSheet();
    native.panels[0].answer(picked('/a'));
    native.panels[1].answer(cancelled);

    await expect(fromA).resolves.toEqual({ status: 'picked', path: '/a' });
    await expect(fromB).resolves.toEqual({ status: 'cancelled' });
  });

  it('turns a thrown native call into a failure with its reason', async () => {
    const { dialogs, native, record } = broker();
    const parent = window(1);
    const request = dialogs.openDirectory(parent, 'Open Project');
    await vi.waitFor(() => expect(native.panels).toHaveLength(1));
    native.panels[0].fail(new Error('NSOpenPanel unavailable'));

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

  it('cancels a folder request whose window is gone, without a panel', async () => {
    const { dialogs, native, record } = broker();
    const parent = window(1);
    parent.close();

    await expect(
      dialogs.openDirectory(parent, 'Open Project')
    ).resolves.toEqual({ status: 'cancelled' });
    await expect(dialogs.openDirectory(null, 'Open Project')).resolves.toEqual({
      status: 'cancelled',
    });
    expect(native.showOpenDialog).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith('native-dialog.window-gone', {
      kind: 'open-directory',
    });
  });

  it('cancels a waiting folder request when its window closes', async () => {
    const { dialogs, native } = broker();
    const parent = window(1);
    void dialogs.messageBox(parent, { message: 'Quit?' });
    const browse = dialogs.openDirectory(parent, 'Open Project');
    await vi.waitFor(() => expect(native.boxes).toHaveLength(1));
    parent.beginSheet();

    parent.close();

    await expect(browse).resolves.toEqual({ status: 'cancelled' });
    expect(native.showOpenDialog).not.toHaveBeenCalled();
  });

  it('asks a waiting message box app-modal when its window closes', async () => {
    const { dialogs, native } = broker();
    const parent = window(1);
    const browse = dialogs.openDirectory(parent, 'Open Project');
    const confirm = dialogs.messageBox(parent, { message: 'Quit?' });
    await vi.waitFor(() => expect(native.panels).toHaveLength(1));
    parent.beginSheet();

    parent.close();
    await vi.waitFor(() => expect(native.boxes).toHaveLength(1));
    expect(native.boxes[0].parent).toBeNull();
    native.boxes[0].answer({ response: 0, checkboxChecked: false });
    await expect(confirm).resolves.toEqual({
      response: 0,
      checkboxChecked: false,
    });
    native.panels[0].answer(cancelled);
    await expect(browse).resolves.toEqual({ status: 'cancelled' });
  });

  it('does not wait for a sheet on platforms without one', async () => {
    vi.useFakeTimers();
    const { dialogs, native } = broker({ platform: 'linux' });
    const request = dialogs.openDirectory(window(1), 'Open Project');
    await vi.waitFor(() => expect(native.panels).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(SHEET_PRESENTATION_DEADLINE_MS * 5);
    native.panels[0].answer(picked('/p'));
    await expect(request).resolves.toEqual({ status: 'picked', path: '/p' });
  });

  it('falls back to the default title for an unusable one', async () => {
    const { dialogs, native } = broker();
    const parent = window(1);
    void dialogs.openDirectory(parent, 'x'.repeat(200));
    await vi.waitFor(() => expect(native.panels).toHaveLength(1));
    expect(native.panels[0].title).toBe('Open project directory');
  });

  it("lets a window's message box take its turn after the picker", async () => {
    const { dialogs, native } = broker();
    const parent = window(1);
    const picker = dialogs.openDirectory(parent, 'Open Project');
    const confirm = dialogs.messageBox(parent, {
      message: 'Quit?',
      buttons: ['Quit', 'Cancel'],
    });
    await vi.waitFor(() => expect(native.panels).toHaveLength(1));
    expect(native.showMessageBox).not.toHaveBeenCalled();
    parent.beginSheet();
    native.panels[0].answer(cancelled);
    parent.endSheet();
    await expect(picker).resolves.toEqual({ status: 'cancelled' });

    await vi.waitFor(() => expect(native.boxes).toHaveLength(1));
    expect(native.boxes[0].parent).toBe(parent);
    expect(native.boxes[0].options).toMatchObject({
      message: 'Quit?',
      buttons: ['Quit', 'Cancel'],
    });
    parent.beginSheet();
    native.boxes[0].answer({ response: 0, checkboxChecked: false });
    await expect(confirm).resolves.toEqual({
      response: 0,
      checkboxChecked: false,
    });
  });

  it('answers a message box aborted in line with its cancel button, unshown', async () => {
    const { dialogs, native } = broker();
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
    await expect(prompt).resolves.toEqual({
      response: 0,
      checkboxChecked: false,
    });
    await vi.waitFor(() => expect(native.panels).toHaveLength(1));
    parent.beginSheet();
    native.panels[0].answer(cancelled);
    parent.endSheet();
    await picker;
    expect(native.showMessageBox).not.toHaveBeenCalled();
  });

  it('keeps the line moving after a message box throws', async () => {
    const { dialogs, native } = broker();
    native.showMessageBox.mockRejectedValueOnce(new Error('boom'));
    await expect(dialogs.messageBox(null, { message: 'one' })).rejects.toThrow(
      'boom'
    );
    const two = dialogs.messageBox(null, { message: 'two' });
    await vi.waitFor(() => expect(native.boxes).toHaveLength(1));
    expect(native.boxes[0].options).toEqual({ message: 'two' });
    native.boxes[0].answer({ response: 0, checkboxChecked: false });
    await expect(two).resolves.toEqual({ response: 0, checkboxChecked: false });
  });
});

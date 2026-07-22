import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { createDirectoryPicker } from './directory-picker';

function parentWindow() {
  return {
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
  } as unknown as BrowserWindow;
}

describe('native directory picker', () => {
  it('attaches the panel to the requesting window on macOS', async () => {
    const parent = parentWindow();
    const showOpenDialog = vi.fn().mockResolvedValue({
      canceled: false,
      filePaths: ['/project'],
      bookmarks: [],
    });
    const openDirectory = createDirectoryPicker({
      showOpenDialog,
    });

    await expect(openDirectory(parent, 'Open Project')).resolves.toBe(
      '/project'
    );
    expect(parent.focus).toHaveBeenCalledOnce();
    expect(showOpenDialog).toHaveBeenCalledWith(parent, {
      title: 'Open Project',
      properties: ['openDirectory', 'createDirectory'],
    });
  });

  it('falls back to a standalone panel when the requesting window is gone', async () => {
    const parent = parentWindow();
    vi.mocked(parent.isDestroyed).mockReturnValue(true);
    const showOpenDialog = vi.fn().mockResolvedValue({
      canceled: true,
      filePaths: [],
      bookmarks: [],
    });
    const openDirectory = createDirectoryPicker({
      showOpenDialog,
    });

    await expect(openDirectory(parent)).resolves.toBeNull();
    expect(parent.focus).not.toHaveBeenCalled();
    expect(showOpenDialog).toHaveBeenCalledWith(null, {
      title: 'Open project directory',
      properties: ['openDirectory', 'createDirectory'],
    });
  });

  it('coalesces overlapping requests and allows a new request after settlement', async () => {
    let finish!: (value: Electron.OpenDialogReturnValue) => void;
    const showOpenDialog = vi.fn(
      () =>
        new Promise<Electron.OpenDialogReturnValue>(resolve => {
          finish = resolve;
        })
    );
    const openDirectory = createDirectoryPicker({
      showOpenDialog,
    });

    const first = openDirectory(parentWindow(), 'First');
    const second = openDirectory(parentWindow(), 'Second');
    await vi.waitFor(() => expect(showOpenDialog).toHaveBeenCalledOnce());
    finish({ canceled: false, filePaths: ['/first'], bookmarks: [] });

    await expect(Promise.all([first, second])).resolves.toEqual([
      '/first',
      '/first',
    ]);
    showOpenDialog.mockResolvedValueOnce({
      canceled: true,
      filePaths: [],
      bookmarks: [],
    });
    await openDirectory(parentWindow(), 'Third');
    expect(showOpenDialog).toHaveBeenCalledTimes(2);
  });
});

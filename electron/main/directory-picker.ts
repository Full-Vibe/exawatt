import type { BrowserWindow } from 'electron';

interface DirectoryPickerDependencies {
  platform: NodeJS.Platform;
  showOpenDialog: (
    parent: BrowserWindow | null,
    options: Electron.OpenDialogOptions
  ) => Promise<Electron.OpenDialogReturnValue>;
}

/**
 * Owns the native directory-panel lifecycle.
 *
 * macOS sheets disable their parent BrowserWindow until AppKit finishes the
 * panel request. If Finder is slow to resolve a location (or the panel lands
 * on another display), Exawatt therefore looks hung even though its event loop
 * is healthy. A standalone panel keeps the command surface responsive. Other
 * platforms retain normal parent-window modality.
 *
 * The single-flight guard also prevents a double click or two renderer verbs
 * from stacking native panels over the same window.
 */
export function createDirectoryPicker({
  platform,
  showOpenDialog,
}: DirectoryPickerDependencies) {
  let pending: Promise<string | null> | null = null;

  return (
    parent: BrowserWindow | null,
    requestedTitle?: string
  ): Promise<string | null> => {
    if (pending) return pending;

    const title =
      typeof requestedTitle === 'string' && requestedTitle.length <= 80
        ? requestedTitle
        : 'Open project directory';
    const usableParent = parent && !parent.isDestroyed() ? parent : null;
    usableParent?.focus();

    const options: Electron.OpenDialogOptions = {
      title,
      properties: ['openDirectory', 'createDirectory'],
    };

    const request = Promise.resolve()
      .then(() =>
        showOpenDialog(platform === 'darwin' ? null : usableParent, options)
      )
      .then(result =>
        result.canceled || result.filePaths.length === 0
          ? null
          : result.filePaths[0]
      );
    pending = request.finally(() => {
      pending = null;
    });
    return pending;
  };
}

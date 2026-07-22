import type { BrowserWindow } from 'electron';

interface DirectoryPickerDependencies {
  showOpenDialog: (
    parent: BrowserWindow | null,
    options: Electron.OpenDialogOptions
  ) => Promise<Electron.OpenDialogReturnValue>;
}

/**
 * Owns the native directory-panel lifecycle.
 *
 * Keep the panel owned by the requesting BrowserWindow whenever it is alive.
 * On macOS that makes the picker a sheet attached to Exawatt instead of an
 * independent panel that can open behind the app or on another display/Space.
 * The renderer releases its Radix modal before invoking this boundary, so the
 * native sheet is the only active modal layer while the operator is browsing.
 *
 * The single-flight guard also prevents a double click or two renderer verbs
 * from stacking native panels over the same window.
 */
export function createDirectoryPicker({
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
      .then(() => showOpenDialog(usableParent, options))
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

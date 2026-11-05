import type {
  MessageBoxOptions,
  MessageBoxReturnValue,
  OpenDialogOptions,
  OpenDialogReturnValue,
} from 'electron';
import type {
  DirectoryPickOutcome,
  NativeDialogFailure,
} from '@exawatt/core/desktop-bridge';
import type { DiagnosticRecorder } from './diagnostics-log';

/**
 * The window a native dialog attaches to, as narrow as the broker uses it.
 * Electron's `BrowserWindow` satisfies it.
 */
export interface DialogParent {
  readonly id: number;
  isDestroyed(): boolean;
  focus(): void;
  once(event: 'sheet-begin', listener: () => void): unknown;
  removeListener(event: 'sheet-begin', listener: () => void): unknown;
}

export interface NativeDialogBroker<W extends DialogParent> {
  /**
   * The native folder picker, attached to `parent` when it is alive. Always
   * settles, never rejects: picked, cancelled, or failed with a reason.
   */
  openDirectory(
    parent: W | null,
    requestedTitle?: unknown
  ): Promise<DirectoryPickOutcome>;
  /** A native message box, in turn with every other dialog on its window. */
  messageBox(
    parent: W | null,
    options: MessageBoxOptions
  ): Promise<MessageBoxReturnValue>;
}

/**
 * How long AppKit has to begin a sheet once it is asked for one. Electron
 * calls `beginSheetModalForWindow` inside the request, and AppKit announces
 * the sheet (`sheet-begin`) as it starts, so a healthy sheet begins within
 * milliseconds. A request with no sheet after this long has nothing on screen
 * for the operator to answer.
 */
export const SHEET_PRESENTATION_DEADLINE_MS = 2_000;

const DEFAULT_DIRECTORY_TITLE = 'Open project directory';

/**
 * The one owner of native dialogs in main (ENG-016, BUG-327).
 *
 * Every `dialog.*` call goes through here, so three guarantees hold for all
 * of them:
 *
 * 1. Dialogs on one window take turns. A window never has two native dialogs
 *    racing for its sheet slot; the app-modal ones (no window) take turns on
 *    their own line.
 * 2. A folder request always settles. On macOS a picker attached to a window
 *    must begin as a sheet; if AppKit never begins one, the request ends as
 *    `not-presented` and the window's turn passes on, instead of leaving the
 *    control that asked waiting on a promise nothing will ever resolve.
 * 3. A second folder request while one is up on the same window is refused
 *    (`busy`), never coalesced: a "Locate" request must not be answered with
 *    the folder another request picked, and never from another window.
 *
 * Anything other than picked or cancelled is recorded, so the next time a
 * picker misbehaves there is a line that says how.
 */
export function createNativeDialogBroker<W extends DialogParent>(deps: {
  platform: NodeJS.Platform;
  showOpenDialog: (
    parent: W | null,
    options: OpenDialogOptions
  ) => Promise<OpenDialogReturnValue>;
  showMessageBox: (
    parent: W | null,
    options: MessageBoxOptions
  ) => Promise<MessageBoxReturnValue>;
  record: DiagnosticRecorder;
  presentationDeadlineMs?: number;
}): NativeDialogBroker<W> {
  const deadline =
    deps.presentationDeadlineMs ?? SHEET_PRESENTATION_DEADLINE_MS;
  /** The settled end of each window's line of dialogs. */
  const lines = new Map<string, Promise<void>>();
  /** Windows with a folder request in flight. */
  const picking = new Set<string>();

  const usable = (parent: W | null) =>
    parent && !parent.isDestroyed() ? parent : null;
  const lineOf = (parent: W | null) => (parent ? `window:${parent.id}` : 'app');

  function inTurn<T>(line: string, run: () => Promise<T>): Promise<T> {
    const previous = lines.get(line) ?? Promise.resolve();
    const result = previous.then(run);
    const end = result.then(
      () => undefined,
      () => undefined
    );
    lines.set(line, end);
    void end.then(() => {
      if (lines.get(line) === end) lines.delete(line);
    });
    return result;
  }

  function failed(
    reason: NativeDialogFailure,
    fields: Record<string, unknown> = {}
  ): DirectoryPickOutcome {
    deps.record('native-dialog.failed', {
      kind: 'open-directory',
      reason,
      ...fields,
    });
    const detail = typeof fields.detail === 'string' ? fields.detail : null;
    return detail
      ? { status: 'failed', reason, detail }
      : { status: 'failed', reason };
  }

  function presentDirectory(
    requested: W | null,
    options: OpenDialogOptions
  ): Promise<DirectoryPickOutcome> {
    // The window may have closed while the request waited its turn.
    const parent = usable(requested);
    parent?.focus();

    let answer!: Promise<DirectoryPickOutcome>;
    const ask = () => {
      answer = Promise.resolve()
        .then(() => deps.showOpenDialog(parent, options))
        .then(
          (result): DirectoryPickOutcome =>
            result.canceled || result.filePaths.length === 0
              ? { status: 'cancelled' }
              : { status: 'picked', path: result.filePaths[0] },
          (error: unknown) =>
            failed('error', {
              detail: error instanceof Error ? error.message : String(error),
            })
        );
    };

    // Only an attached macOS sheet announces itself; a standalone panel and
    // other platforms' dialogs are answered or they throw.
    if (!parent || deps.platform !== 'darwin') {
      ask();
      return answer;
    }

    return new Promise(resolve => {
      let begun = false;
      let settled = false;
      const onBegin = () => {
        begun = true;
        clearTimeout(timer);
      };
      // Listen before asking: AppKit begins the sheet inside the request.
      parent.once('sheet-begin', onBegin);
      const timer = setTimeout(() => {
        if (begun || settled) return;
        settled = true;
        parent.removeListener('sheet-begin', onBegin);
        resolve(failed('not-presented', { deadlineMs: deadline }));
        // Should the panel turn up after all, its answer has nowhere to go;
        // record that it happened rather than open a Project unasked.
        void answer.then(late =>
          deps.record('native-dialog.late-answer', {
            kind: 'open-directory',
            status: late.status,
          })
        );
      }, deadline);
      ask();
      void answer.then(outcome => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        parent.removeListener('sheet-begin', onBegin);
        resolve(outcome);
      });
    });
  }

  return {
    openDirectory(requested, requestedTitle) {
      const parent = usable(requested);
      const line = lineOf(parent);
      if (picking.has(line)) return Promise.resolve(failed('busy'));
      picking.add(line);
      const options: OpenDialogOptions = {
        title:
          typeof requestedTitle === 'string' &&
          requestedTitle.length > 0 &&
          requestedTitle.length <= 80
            ? requestedTitle
            : DEFAULT_DIRECTORY_TITLE,
        properties: ['openDirectory', 'createDirectory'],
      };
      return inTurn(line, () => presentDirectory(parent, options)).finally(() =>
        picking.delete(line)
      );
    },

    messageBox(requested, options) {
      const parent = usable(requested);
      return inTurn(lineOf(parent), async () => {
        // Aborted while it waited: it never shows, and answers as Electron
        // answers an aborted box, with its cancel button.
        if (options.signal?.aborted) {
          return { response: options.cancelId ?? 0, checkboxChecked: false };
        }
        try {
          return await deps.showMessageBox(usable(parent), options);
        } catch (error) {
          deps.record('native-dialog.failed', {
            kind: 'message-box',
            reason: 'error',
            detail: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      });
    },
  };
}

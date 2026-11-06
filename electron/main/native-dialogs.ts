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
 *
 * `sheet-begin` and `sheet-end` are AppKit's own announcements, not the
 * broker's. Electron's window delegate forwards NSWindowDelegate's
 * `windowWillBeginSheet:` / `windowDidEndSheet:` for EVERY sheet on the
 * window (shell/browser/ui/cocoa/electron_ns_window_delegate.mm, v43.8.3
 * lines 426-432, emitted by BaseWindow::OnWindowSheetBegin/End in
 * shell/browser/api/electron_api_base_window.cc:307-313), and
 * `dialog.showOpenDialog(win, …)` / `dialog.showMessageBox(win, …)` present
 * through `beginSheetModalForWindow:` (shell/browser/ui/file_dialog_mac.mm
 * ShowOpenDialog, shell/browser/ui/message_box_mac.mm). So the events fire
 * for the broker's own sheets and for the ones Chromium shows itself (an
 * `<input type="file">` chooser, a JS `confirm`), which is how the broker
 * accounts for dialogs it never asked for.
 */
export interface DialogParent {
  readonly id: number;
  isDestroyed(): boolean;
  focus(): void;
  on(event: 'sheet-begin', listener: () => void): unknown;
  on(event: 'sheet-end', listener: () => void): unknown;
  on(event: 'closed', listener: () => void): unknown;
}

export interface NativeDialogBroker<W extends DialogParent> {
  /**
   * Follow a window's sheets from its creation, so a dialog Chromium shows
   * on it occupies its line too. Idempotent; a request from a window not
   * yet watched starts watching it.
   */
  watch(window: W): void;
  /**
   * The native folder picker, attached to the window that asked. Always
   * settles, never rejects: picked, cancelled, or failed with a reason. A
   * request whose window is gone is cancelled without showing anything.
   */
  openDirectory(
    parent: W | null,
    requestedTitle?: unknown
  ): Promise<DirectoryPickOutcome>;
  /**
   * A native message box, in turn with every other dialog on its window.
   * Main still needs the answer when the window goes, so a box whose window
   * closed while it waited is asked app-modal instead.
   */
  messageBox(
    parent: W | null,
    options: MessageBoxOptions
  ): Promise<MessageBoxReturnValue>;
}

/**
 * How long a request on a macOS window has to get its sheet on screen,
 * counted from the request while no sheet is up on that window. Electron
 * calls `beginSheetModalForWindow` inside the native call and AppKit
 * announces the sheet as it starts, so a healthy request begins within
 * milliseconds of its turn. A request still without a sheet after this
 * long has nothing on screen for the operator to answer.
 */
export const SHEET_PRESENTATION_DEADLINE_MS = 2_000;

const DEFAULT_DIRECTORY_TITLE = 'Open project directory';

type DialogKind = 'open-directory' | 'message-box';

/** One request, from the moment it is made until its native call settles. */
interface DialogRequest<W extends DialogParent> {
  readonly kind: DialogKind;
  /** Answered for its caller. The native call may still be outstanding. */
  answered: boolean;
  /** Its own sheet is on screen. */
  begun: boolean;
  /** Ask the native dialog; resolves when the native call settles. */
  show(parent: W | null): Promise<void>;
  /** Its deadline passed with no sheet of its own on screen. */
  expire(): void;
  /** Its window closed before it was asked. */
  windowGone(): void;
  clock: Clock | null;
}

/** A deadline that only runs while no sheet is up on the window. */
interface Clock {
  remaining: number;
  startedAt: number | null;
  timer: ReturnType<typeof setTimeout> | null;
}

/** One window's dialogs (or the app-modal ones, `parent: null`). */
interface Line<W extends DialogParent> {
  readonly parent: W | null;
  readonly waiting: DialogRequest<W>[];
  /** Asked, and its native call has not settled. */
  active: DialogRequest<W> | null;
  /** Sheets on screen on this window, whoever showed them. */
  sheets: number;
}

/**
 * The one owner of native dialogs in main (ENG-016, BUG-327).
 *
 * Every `dialog.*` call goes through here, so these hold for all of them:
 *
 * 1. Dialogs on one window take turns, and the turn is held until the native
 *    call settles, even after the caller was answered. A window's turn is
 *    also held while any sheet is up on it, the ones Chromium shows itself
 *    included. A window never has two sheets racing for its slot, and a
 *    panel AppKit begins late cannot stack a second one beside it.
 * 2. Every request on a macOS window settles within the presentation
 *    deadline of its own sheet being on screen, counted from the request,
 *    whether it was waiting its turn or already asked. Time behind a sheet
 *    the operator is answering does not count: that dialog is on screen,
 *    and the request is asked when it closes. A folder request that runs
 *    out ends as `not-presented`; a message box ends with its cancel
 *    button, and one already asked is closed so its turn passes on.
 * 3. A second folder request while one is up on the same window is refused
 *    (`busy`), never coalesced: a "Locate" request must not be answered with
 *    the folder another request picked, and never from another window.
 * 4. A folder request whose window is gone is cancelled without a panel:
 *    nobody is left to answer it, and its answer would go nowhere.
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
  const appLine: Line<W> = {
    parent: null,
    waiting: [],
    active: null,
    sheets: 0,
  };
  const windowLines = new Map<number, Line<W>>();
  /** Windows whose renderer has a folder request it has not been answered. */
  const picking = new Set<number>();

  const live = (parent: W | null): W | null =>
    parent && !parent.isDestroyed() ? parent : null;
  /** Only an attached macOS sheet announces itself; a standalone panel and
   *  other platforms' dialogs are answered or they throw. */
  const announcesSheets = (line: Line<W>) =>
    line.parent !== null && deps.platform === 'darwin';

  // --- the deadline -------------------------------------------------------

  function runClock(request: DialogRequest<W>) {
    const clock = request.clock;
    if (!clock || clock.timer || request.answered || request.begun) return;
    clock.startedAt = Date.now();
    clock.timer = setTimeout(() => {
      clock.timer = null;
      if (!request.answered && !request.begun) request.expire();
    }, clock.remaining);
  }

  function pauseClock(request: DialogRequest<W>) {
    const clock = request.clock;
    if (!clock?.timer || clock.startedAt === null) return;
    clearTimeout(clock.timer);
    clock.timer = null;
    clock.remaining = Math.max(
      0,
      clock.remaining - (Date.now() - clock.startedAt)
    );
    clock.startedAt = null;
  }

  function stopClock(request: DialogRequest<W>) {
    if (request.clock?.timer) clearTimeout(request.clock.timer);
    request.clock = null;
  }

  // --- lines --------------------------------------------------------------

  function lineFor(window: W): Line<W> {
    const known = windowLines.get(window.id);
    if (known) return known;
    const created: Line<W> = {
      parent: window,
      waiting: [],
      active: null,
      sheets: 0,
    };
    windowLines.set(window.id, created);
    window.on('sheet-begin', () => {
      created.sheets += 1;
      const active = created.active;
      if (active && !active.begun) {
        // Asked only while no sheet was up, so this one is its own.
        active.begun = true;
        stopClock(active);
      }
      for (const request of created.waiting) pauseClock(request);
    });
    window.on('sheet-end', () => {
      created.sheets = Math.max(0, created.sheets - 1);
      if (created.sheets === 0) {
        for (const request of created.waiting) runClock(request);
      }
      pump(created);
    });
    window.on('closed', () => {
      windowLines.delete(window.id);
      picking.delete(window.id);
      const waiting = created.waiting.splice(0);
      for (const request of waiting) {
        stopClock(request);
        if (!request.answered) request.windowGone();
      }
    });
    return created;
  }

  function enqueue(line: Line<W>, request: DialogRequest<W>) {
    if (announcesSheets(line)) {
      request.clock = { remaining: deadline, startedAt: null, timer: null };
      if (line.sheets === 0) runClock(request);
    }
    line.waiting.push(request);
    pump(line);
  }

  /** Ask the next request once the line is free: nothing asked is still
   *  outstanding and no sheet is on screen. */
  function pump(line: Line<W>) {
    while (!line.active && line.sheets === 0 && line.waiting.length > 0) {
      const request = line.waiting.shift()!;
      if (request.answered) continue;
      if (line.parent && !live(line.parent)) {
        stopClock(request);
        request.windowGone();
        continue;
      }
      line.active = request;
      if (!announcesSheets(line)) request.begun = true;
      line.parent?.focus();
      void request.show(line.parent).finally(() => {
        stopClock(request);
        if (line.active === request) line.active = null;
        pump(line);
      });
    }
  }

  // --- folder requests ----------------------------------------------------

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

  function cancelledWithoutWindow(): DirectoryPickOutcome {
    deps.record('native-dialog.window-gone', { kind: 'open-directory' });
    return { status: 'cancelled' };
  }

  // --- the broker ---------------------------------------------------------

  return {
    watch(window) {
      if (!window.isDestroyed()) lineFor(window);
    },

    openDirectory(requested, requestedTitle) {
      const parent = live(requested);
      if (!parent) return Promise.resolve(cancelledWithoutWindow());
      if (picking.has(parent.id)) return Promise.resolve(failed('busy'));
      const line = lineFor(parent);
      picking.add(parent.id);
      const options: OpenDialogOptions = {
        title:
          typeof requestedTitle === 'string' &&
          requestedTitle.length > 0 &&
          requestedTitle.length <= 80
            ? requestedTitle
            : DEFAULT_DIRECTORY_TITLE,
        properties: ['openDirectory', 'createDirectory'],
      };

      return new Promise<DirectoryPickOutcome>(resolve => {
        const answer = (outcome: () => DirectoryPickOutcome) => {
          if (request.answered) return;
          request.answered = true;
          stopClock(request);
          picking.delete(parent.id);
          resolve(outcome());
        };
        const request: DialogRequest<W> = {
          kind: 'open-directory',
          answered: false,
          begun: false,
          clock: null,
          async show(window) {
            let outcome: DirectoryPickOutcome;
            try {
              const result = await deps.showOpenDialog(window, options);
              outcome =
                result.canceled || result.filePaths.length === 0
                  ? { status: 'cancelled' }
                  : { status: 'picked', path: result.filePaths[0] };
            } catch (error) {
              const detail =
                error instanceof Error ? error.message : String(error);
              if (!request.answered) {
                answer(() => failed('error', { detail }));
                return;
              }
              outcome = { status: 'failed', reason: 'error', detail };
            }
            if (request.answered) {
              // The panel turned up after its caller was told it did not;
              // its answer has nowhere to go, and a Project must not open
              // unasked. Record that it happened.
              deps.record('native-dialog.late-answer', {
                kind: 'open-directory',
                status: outcome.status,
              });
              return;
            }
            answer(() => outcome);
          },
          expire() {
            answer(() =>
              failed('not-presented', {
                deadlineMs: deadline,
                asked: line.active === request,
              })
            );
          },
          windowGone() {
            answer(cancelledWithoutWindow);
          },
        };
        enqueue(line, request);
      });
    },

    messageBox(requested, options) {
      const parent = live(requested);
      const cancelled = (): MessageBoxReturnValue => ({
        response: options.cancelId ?? 0,
        checkboxChecked: false,
      });

      return new Promise<MessageBoxReturnValue>((resolve, reject) => {
        /** Closes the box when its deadline passes after it was asked. */
        const presentation = new AbortController();
        const settle = (finish: () => void) => {
          if (request.answered) return;
          request.answered = true;
          stopClock(request);
          finish();
        };
        // Aborted while it waited: it never shows, and answers as Electron
        // answers an aborted box, with its cancel button.
        options.signal?.addEventListener(
          'abort',
          () => {
            if (!request.begun) settle(() => resolve(cancelled()));
          },
          { once: true }
        );
        const request: DialogRequest<W> = {
          kind: 'message-box',
          answered: false,
          begun: false,
          clock: null,
          async show(window) {
            if (request.answered) return;
            const signals = [
              options.signal,
              request.clock && presentation.signal,
            ].filter((signal): signal is AbortSignal => Boolean(signal));
            const asked: MessageBoxOptions =
              signals.length === 0
                ? options
                : {
                    ...options,
                    signal:
                      signals.length === 1
                        ? signals[0]
                        : AbortSignal.any(signals),
                  };
            try {
              const result = await deps.showMessageBox(window, asked);
              settle(() => resolve(result));
            } catch (error) {
              deps.record('native-dialog.failed', {
                kind: 'message-box',
                reason: 'error',
                detail: error instanceof Error ? error.message : String(error),
              });
              settle(() => reject(error));
            }
          },
          expire() {
            const asked = parentLine.active === request;
            deps.record('native-dialog.failed', {
              kind: 'message-box',
              reason: 'not-presented',
              deadlineMs: deadline,
              asked,
            });
            settle(() => resolve(cancelled()));
            // Close it, so the native call settles and the turn passes on.
            if (asked) presentation.abort();
          },
          windowGone() {
            // Main asked for this answer and still needs it.
            enqueue(appLine, request);
          },
        };
        const parentLine = parent ? lineFor(parent) : appLine;
        if (options.signal?.aborted) {
          settle(() => resolve(cancelled()));
          return;
        }
        enqueue(parentLine, request);
      });
    },
  };
}

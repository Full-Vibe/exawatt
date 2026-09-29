import type { MessageBoxOptions } from 'electron';
import type { DiagnosticRecorder } from './diagnostics-log';

/**
 * Self-healing for the processes the window depends on (BUG-223, incident
 * `0028`).
 *
 * Electron main is the one Exawatt process nothing can bring back. Everything
 * it depends on can be killed underneath it: Chromium's renderer, GPU and
 * network helpers, and the loopback server that serves the packaged renderer.
 * On 2026-09-24 an agent's `pkill -f "next start" -f` killed every process on
 * the machine whose command line contains `-f` (every Chromium helper carries
 * `--field-trial-handle`), across Exawatt, Brave, Slack and every other
 * Electron app at once. Chromium restarted the GPU and network helpers on its
 * own. Nothing restarted the renderer, and ⌘R could not either (the menu's
 * `reload` role targets the focused web contents, and a crashed renderer has
 * no view to hold focus), so the window stayed black until a force quit.
 *
 * The contract this module keeps:
 *
 * - **Every death is on the record.** Renderer, helper and renderer-server
 *   deaths land in `logs/main.jsonl` with Chromium's own reason and exit
 *   code, so the next one is a file to read rather than an investigation.
 * - **A dead renderer reloads itself.** Sessions, their PTYs and their history
 *   live in main, so a reload costs the page and nothing else.
 * - **A dead renderer server restarts on its own port**, keeping the origin
 *   and everything the renderer stored under it, then reloads the window.
 * - **Recovery never loops, and never gives up silently.** Automatic attempts
 *   are budgeted per window of time. A renderer or server that keeps dying
 *   past the budget stops restarting and asks the operator (Reload Window or
 *   Quit) instead.
 * - **A quit is never fought.** Nothing restarts once shutdown has begun. A
 *   shutdown the operator cancels hands the processes back, and anything that
 *   died while it owned them is brought back then.
 * - **A hung renderer is the operator's call** (BUG-129). A page stuck in a
 *   loop never dies, so nothing above would fire: the window just ignores
 *   every click. When Chromium reports it unresponsive, the operator is asked
 *   to wait or reload; the question withdraws itself if the page recovers,
 *   and Reload ends the stuck renderer so the recovery above brings it back.
 */

/** Automatic recoveries allowed per window before recovery asks instead. */
export const RECOVERY_BUDGET = { attempts: 3, windowMs: 60_000 } as const;

/** A sliding-window count of automatic recovery attempts. */
export function createRecoveryBudget(
  options: { attempts: number; windowMs: number },
  now: () => number
): { spend(): boolean; reset(): void } {
  let spentAt: number[] = [];
  return {
    spend() {
      const at = now();
      spentAt = spentAt.filter(time => at - time < options.windowMs);
      if (spentAt.length >= options.attempts) return false;
      spentAt.push(at);
      return true;
    },
    reset() {
      spentAt = [];
    },
  };
}

/** Chromium's account of a renderer that went away (`render-process-gone`). */
interface RendererGoneDetails {
  reason: string;
  exitCode: number;
}

/** Chromium's account of any other helper that went away. */
interface ChildGoneDetails {
  type: string;
  reason: string;
  exitCode: number;
  serviceName?: string;
  name?: string;
}

/** The window surface recovery touches, and nothing more. */
export interface RecoverableWindow {
  isDestroyed(): boolean;
  webContents: {
    reload(): void;
    isCrashed(): boolean;
    isLoading(): boolean;
    once(event: 'did-stop-loading', listener: () => void): unknown;
    forcefullyCrashRenderer(): void;
  };
}

export type HangChoice = 'wait' | 'reload';

/** The question asked while the window's renderer is hung. */
export function rendererHangPrompt(productName: string): {
  options: MessageBoxOptions;
  choice(response: number): HangChoice;
} {
  return {
    options: {
      type: 'warning',
      message: `${productName} isn't responding`,
      detail:
        'The window stopped responding. Your agents and terminals are still running. Wait for it, or reload the window.',
      buttons: ['Wait', 'Reload Window'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    },
    choice: response => (response === 1 ? 'reload' : 'wait'),
  };
}

/** Automation answers the hang question from the environment, never a dialog. */
export function testHangChoice(env: NodeJS.ProcessEnv): HangChoice {
  return env.EXAWATT_TEST_UNRESPONSIVE_RESPONSE === 'reload'
    ? 'reload'
    : 'wait';
}

export type RecoveryChoice = 'reload' | 'quit';

/**
 * One operator prompt at a time. The renderer and its server can both run out
 * of automatic recovery in the same moment (the server dies, so the page the
 * renderer reloads cannot load); the operator is asked once and both hear the
 * same answer.
 */
export function sharedRecoveryPrompt(
  show: () => Promise<RecoveryChoice>
): () => Promise<RecoveryChoice> {
  let open: Promise<RecoveryChoice> | null = null;
  return () =>
    (open ??= show().finally(() => {
      open = null;
    }));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The question asked once automatic recovery is spent. */
export function rendererRecoveryPrompt(productName: string): {
  options: MessageBoxOptions;
  choice(response: number): RecoveryChoice;
} {
  return {
    options: {
      type: 'warning',
      message: `The ${productName} window stopped working`,
      detail: `It stopped several times in the last minute, so ${productName} paused reloading it. Your agents and terminals are still running.`,
      buttons: ['Reload Window', `Quit ${productName}`],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    },
    choice: response => (response === 1 ? 'quit' : 'reload'),
  };
}

interface RendererRecoveryDependencies {
  record: DiagnosticRecorder;
  /** True once shutdown is past confirmation: nothing restarts from then on. */
  isQuitting: () => boolean;
  /** Asked only when the automatic budget is spent. */
  ask: () => Promise<RecoveryChoice>;
  /** Asked while the renderer is hung; `signal` aborts it if the page recovers. */
  askWhileUnresponsive: (
    win: RecoverableWindow,
    signal: AbortSignal
  ) => Promise<HangChoice>;
  quit: () => void;
  now?: () => number;
  /** Defers the reload out of Chromium's own crash notification. */
  defer?: (run: () => void) => void;
}

/**
 * Recovery for the main window's renderer. `rendererGone` is wired to the
 * window's `render-process-gone`; everything else follows from it.
 */
export function createRendererRecovery(deps: RendererRecoveryDependencies): {
  rendererGone(win: RecoverableWindow, details: RendererGoneDetails): void;
  rendererUnresponsive(win: RecoverableWindow): void;
  rendererResponsive(): void;
  /**
   * A shutdown that had begun returned to idle (the operator cancelled it, or
   * a step failed). A renderer that died while shutdown owned the processes
   * was deliberately left down; the app is staying open, so bring it back.
   */
  shutdownCancelled(windows: readonly RecoverableWindow[]): void;
} {
  const now = deps.now ?? Date.now;
  const defer = deps.defer ?? (run => setTimeout(run, 0));
  const budget = createRecoveryBudget(RECOVERY_BUDGET, now);
  let asking = false;
  /** When the current hang began, while one is open. */
  let hungSince: number | null = null;
  let hangQuestion: AbortController | null = null;
  /** The operator chose Reload for a hung renderer: its death is expected,
   *  and reloading it spends nothing from the automatic budget. */
  let reloadRequested = false;

  function reload(win: RecoverableWindow): void {
    if (win.isDestroyed() || deps.isQuitting()) return;
    win.webContents.reload();
  }

  /**
   * The reload runs a turn after Chromium's crash notification. A navigation
   * already in flight when the renderer died (startup entering the workspace,
   * say) starts a renderer of its own and lands by itself; reloading then
   * would abort it and put the window back on the page that died. So a
   * window still loading is left to finish, and reloaded only if it is still
   * down once loading stops.
   */
  function reloadIfStillDown(win: RecoverableWindow): void {
    if (win.isDestroyed() || !win.webContents.isCrashed()) return;
    if (win.webContents.isLoading()) {
      win.webContents.once('did-stop-loading', () => reloadIfStillDown(win));
      return;
    }
    reload(win);
  }

  function ask(win: RecoverableWindow): void {
    if (asking) return;
    asking = true;
    void deps
      .ask()
      .then(choice => {
        deps.record('renderer.recovery-choice', { choice });
        if (choice === 'reload') {
          budget.reset();
          reload(win);
        } else if (choice === 'quit') {
          deps.quit();
        }
      })
      .catch(error => {
        deps.record('renderer.recovery-prompt-failed', {
          message: errorMessage(error),
        });
      })
      .finally(() => {
        asking = false;
      });
  }

  function endHang(): void {
    hangQuestion?.abort();
    hangQuestion = null;
    hungSince = null;
  }

  return {
    rendererGone(win, details) {
      const fields = { reason: details.reason, exitCode: details.exitCode };
      const requested = reloadRequested;
      reloadRequested = false;
      endHang();
      if (win.isDestroyed() || deps.isQuitting()) {
        deps.record('renderer.gone', { ...fields, action: 'none' });
        return;
      }
      if (requested) {
        deps.record('renderer.gone', {
          ...fields,
          action: 'reload',
          requested,
        });
        defer(() => reloadIfStillDown(win));
        return;
      }
      if (budget.spend()) {
        deps.record('renderer.gone', { ...fields, action: 'reload' });
        defer(() => reloadIfStillDown(win));
        return;
      }
      deps.record('renderer.gone', { ...fields, action: 'ask' });
      ask(win);
    },

    rendererUnresponsive(win) {
      if (win.isDestroyed() || deps.isQuitting() || hangQuestion) return;
      hungSince = now();
      deps.record('renderer.unresponsive');
      const question = new AbortController();
      hangQuestion = question;
      void deps
        .askWhileUnresponsive(win, question.signal)
        .then(choice => {
          // The page came back while the question was open: it answered itself.
          if (question.signal.aborted) return;
          deps.record('renderer.unresponsive-choice', { choice });
          if (choice === 'reload' && !win.isDestroyed() && !deps.isQuitting()) {
            reloadRequested = true;
            win.webContents.forcefullyCrashRenderer();
          }
        })
        .catch(error => {
          deps.record('renderer.unresponsive-prompt-failed', {
            message: errorMessage(error),
          });
        })
        .finally(() => {
          if (hangQuestion === question) hangQuestion = null;
        });
    },

    rendererResponsive() {
      if (hungSince !== null) {
        deps.record('renderer.responsive', { afterMs: now() - hungSince });
      }
      endHang();
    },

    shutdownCancelled(windows) {
      for (const win of windows) {
        if (win.isDestroyed() || !win.webContents.isCrashed()) continue;
        deps.record('renderer.reloaded', { after: 'cancelled-shutdown' });
        reload(win);
      }
    },
  };
}

/**
 * Chromium restarts its own GPU, network and utility helpers; the finding
 * worth keeping is that one died, and how. A clean exit is an idle service
 * ending on purpose, not a death.
 */
export function recordChildProcessGone(
  record: DiagnosticRecorder,
  details: ChildGoneDetails
): void {
  if (details.reason === 'clean-exit') return;
  record('child.gone', {
    type: details.type,
    reason: details.reason,
    exitCode: details.exitCode,
    serviceName: details.serviceName ?? null,
    name: details.name ?? null,
  });
}

interface RendererServerSupervisorDependencies {
  record: DiagnosticRecorder;
  isQuitting: () => boolean;
  /** Starts the server again on the port it was serving. */
  restart: () => Promise<unknown>;
  /** True when the server has served before and nothing is serving now. */
  isDown: () => boolean;
  /** Reloads the window if it is showing the renderer the server serves. */
  reloadWorkspace: () => void;
  /** Asked only when the automatic budget is spent. */
  ask: () => Promise<RecoveryChoice>;
  quit: () => void;
  now?: () => number;
}

/**
 * Supervision for the packaged renderer's loopback server. Only an exit the
 * server did not ask for reaches it: `stop()` and a failed start are the
 * renderer server's own business. A restart that fails (the new server dies
 * while starting, or never answers and is killed) is retried while the budget
 * lasts; once it is spent the operator is asked, never left with a window
 * that silently cannot load.
 */
export function createRendererServerSupervisor(
  deps: RendererServerSupervisorDependencies
): {
  exited(details: { code: number | null; signal: string | null }): void;
  /** A shutdown that had begun returned to idle: serve again if it stopped. */
  shutdownCancelled(): void;
} {
  const budget = createRecoveryBudget(RECOVERY_BUDGET, deps.now ?? Date.now);
  let restarting = false;
  let asking = false;

  function restart(): void {
    restarting = true;
    void deps.restart().then(
      () => {
        restarting = false;
        deps.record('renderer-server.restarted');
        if (!deps.isQuitting()) deps.reloadWorkspace();
      },
      error => {
        restarting = false;
        const message = errorMessage(error);
        if (deps.isQuitting()) {
          deps.record('renderer-server.restart-failed', {
            message,
            action: 'none',
          });
        } else if (budget.spend()) {
          deps.record('renderer-server.restart-failed', {
            message,
            action: 'retry',
          });
          restart();
        } else {
          deps.record('renderer-server.restart-failed', {
            message,
            action: 'ask',
          });
          ask();
        }
      }
    );
  }

  function ask(): void {
    if (asking) return;
    asking = true;
    void deps
      .ask()
      .then(choice => {
        asking = false;
        deps.record('renderer-server.recovery-choice', { choice });
        if (choice === 'quit') {
          deps.quit();
        } else if (!deps.isQuitting() && !restarting) {
          budget.reset();
          budget.spend();
          restart();
        }
      })
      .catch(error => {
        asking = false;
        deps.record('renderer-server.recovery-prompt-failed', {
          message: errorMessage(error),
        });
      });
  }

  return {
    exited({ code, signal }) {
      const fields = { code, signal };
      if (deps.isQuitting() || restarting) {
        deps.record('renderer-server.exited', { ...fields, action: 'none' });
        return;
      }
      if (!budget.spend()) {
        deps.record('renderer-server.exited', { ...fields, action: 'ask' });
        ask();
        return;
      }
      deps.record('renderer-server.exited', { ...fields, action: 'restart' });
      restart();
    },
    shutdownCancelled() {
      if (deps.isQuitting() || restarting || asking || !deps.isDown()) return;
      if (!budget.spend()) {
        deps.record('renderer-server.resumed', { action: 'ask' });
        ask();
        return;
      }
      deps.record('renderer-server.resumed', { action: 'restart' });
      restart();
    },
  };
}

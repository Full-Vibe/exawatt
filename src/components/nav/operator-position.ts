/**
 * Who may move the operator (ENG-016, BUG-018 and the focus half of BUG-012).
 *
 * Work in this app finishes at an unbounded, hostile time. A launch waits on a
 * worktree checkout and a cold provider; a reopen waits on the ledger; a
 * Project resolve waits on the main process. Every one of those completions
 * used to assert the operator's position when it landed — write `activeTabId`,
 * write `activeDir`, close the Sessions altitude, and let the terminal pane
 * turn that activation into keyboard focus — as though he were still standing
 * where he was when he asked. Usually he is not, and the defect scaled in
 * exactly the wrong direction: the slower the work, the likelier he had
 * correctly moved on, and the likelier he was yanked back.
 *
 * That is one ownership question, not one bug per call site. The rule lives
 * here, is stated once, and is tested once:
 *
 *   **Only the intent that is still current may move the operator.**
 *
 * A verb that will move him states the position authorising the move BEFORE
 * it awaits anything (`claim` / `claimHere`). When its work lands it asks
 * `stillCurrent()`. True means he has not moved since he asked, so the move is
 * his own. False means he has, and the completion still finishes its real job
 * — promote the draft tab to live, append the Session, register the Project —
 * without touching selection, altitude, or keyboard focus. The readiness is
 * surfaced where it belongs: in that Session's own tab.
 *
 * Two things this deliberately does NOT do:
 *
 * - It does not measure elapsed time. A fast completion may still be stale
 *   (he switched tabs in 200ms) and a slow one may still be current.
 * - It does not read OS window focus. An app in the background is not the same
 *   as an operator who changed tabs, and the reverse is just as wrong.
 *
 * Position is PULLED from whoever owns it, never mirrored into this module. A
 * mirrored copy is one more thing every selection verb must remember to
 * update, and the verb that forgets is the next stolen focus.
 */

import { sameLocation, type NavLocation } from './nav-history';

/** Reads the operator's position from whichever surface owns it. */
export type OperatorPositionSource = () => NavLocation | null;

export interface OperatorMoveClaim {
  /** The position that authorises this move; null when it was never known. */
  readonly from: NavLocation | null;
  /** True only while the operator is still standing where he asked from. */
  stillCurrent(): boolean;
}

/** A claim nothing can satisfy — the honest answer when position is unknown. */
const NEVER_CURRENT: OperatorMoveClaim = {
  from: null,
  stillCurrent: () => false,
};

export class OperatorPositionAuthority {
  private source: OperatorPositionSource | null = null;

  /**
   * Register where position is read from. The workspace owns the truth (which
   * Project, which tab, which altitude); this module owns the rule about it.
   *
   * Registering replaces; passing null clears. A surface clears on unmount so
   * an unmounted workspace can never authorise a move into itself.
   */
  setSource(source: OperatorPositionSource | null): void {
    this.source = source;
  }

  /** Null while no surface owns a position — nothing is mounted yet. */
  current(): NavLocation | null {
    return this.source?.() ?? null;
  }

  /**
   * State the position that authorises a move, before awaiting anything.
   *
   * An unknown position never authorises one. Failing closed is the cheap
   * direction: a Session that starts without pulling the operator is
   * recoverable in one keystroke, and focus taken from under him is not.
   */
  claim(from: NavLocation | null): OperatorMoveClaim {
    if (!from) return NEVER_CURRENT;
    return {
      from,
      stillCurrent: () => {
        const now = this.current();
        return now !== null && sameLocation(now, from);
      },
    };
  }

  /** Claim wherever the operator is standing right now — the common case. */
  claimHere(): OperatorMoveClaim {
    return this.claim(this.current());
  }

  /**
   * Claim the current surface, on a tab named explicitly.
   *
   * For a verb that knows exactly which tab authorised it rather than
   * inferring it: ⌘T launches from its own draft tab, and saying so is both
   * clearer than "wherever he was" and immune to reading position a beat
   * before the surface has published the selection that verb just made.
   */
  claimTab(dir: string, tabId: string): OperatorMoveClaim {
    const here = this.current();
    if (!here) return NEVER_CURRENT;
    return this.claim({ surface: here.surface, tab: { dir, tabId } });
  }
}

/** Module singleton per renderer, like the back stack it shares a vocabulary
 *  with. Pure; not persisted. */
export const operatorPosition = new OperatorPositionAuthority();

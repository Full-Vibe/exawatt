// No 'use client' directive: only imported by the client workspace surface.

/**
 * ⌘W close confirm (ENG-016 D27, amends D24's native dialog — the operator
 * wants the app's own chrome). Shown only for STARTED live agents; drafts,
 * fresh tabs, and stopped tabs close without ceremony.
 *
 * macOS selection semantics: the default button (Close) starts focused and
 * is visually dominant; ⏎ presses the DEFAULT from anywhere in the dialog,
 * space presses the FOCUSED button (native button behavior), tab/shift-tab
 * cycles focus between the two buttons, esc cancels. The copy names the
 * consequence and the recovery path.
 */
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { HUD } from '@/components/hud';

export function CloseConfirm({
  title,
  goal,
  working,
  color,
  onClose,
  onCancel,
}: {
  title: string;
  /** goal subtitle when one exists — names what is being closed */
  goal: string | null;
  /** mid-turn close interrupts work — the copy says so */
  working: boolean;
  /** project color — the dialog belongs to the tab it is about */
  color: string;
  onClose: () => void;
  onCancel: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);
  return (
    <div
      data-close-confirm
      role="dialog"
      aria-modal="true"
      aria-label={`Close ${title}?`}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          // ⏎ always presses the DEFAULT, wherever focus sits (macOS)
          e.preventDefault();
          onClose();
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
          return;
        }
        if (e.key === 'Tab') {
          // two-stop focus trap: tab and shift-tab both flip to the other
          e.preventDefault();
          const other =
            document.activeElement === closeRef.current
              ? cancelRef.current
              : closeRef.current;
          other?.focus();
        }
        // space presses the FOCUSED button — native button behavior
      }}
      className="fixed inset-0 z-50 flex items-center justify-center motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150"
      style={{ background: 'rgba(4,6,11,0.55)' }}
      onClick={onCancel}
    >
      <div
        className="flex w-[26rem] max-w-[calc(100%-2rem)] flex-col gap-3 rounded border p-4"
        style={{
          borderColor: `${color}55`,
          background: HUD.bg.panelFill,
          boxShadow: `0 0 28px rgba(0,0,0,0.55), 0 0 12px ${color}22`,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="font-mono text-sm" style={{ color: HUD.text }}>
          Close <span style={{ color }}>{title}</span>?
        </div>
        {goal && (
          <div
            className="font-sans text-xs leading-4"
            style={{ color: `${color}B0` }}
          >
            {goal}
          </div>
        )}
        <div
          className="font-sans text-xs leading-5"
          style={{ color: HUD.textDim }}
        >
          {working && (
            <>It is still working — closing interrupts the turn in flight. </>
          )}
          The agent stops, and the Session — conversation, goal, and scrollback
          — moves to Recently closed. Reopen it from ⌘K within 14 days.
        </div>
        <div className="flex items-center justify-end gap-2">
          {/* one button system (D32): neutral outline + the DEFAULT in the
              operator's system accent — never the project hue */}
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            className="font-mono"
          >
            Cancel
          </Button>
          <Button
            ref={closeRef}
            type="button"
            size="sm"
            onClick={onClose}
            className="font-mono"
          >
            Close ⏎
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Group-close guard: one confirmation owns the batch, then every tab uses
 * the normal stop/archive path before the empty Project retracts. */
export function CloseProjectConfirm({
  title,
  tabCount,
  workingCount,
  color,
  onClose,
  onCancel,
}: {
  title: string;
  tabCount: number;
  workingCount: number;
  color: string;
  onClose: () => void;
  onCancel: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);
  return (
    <div
      data-project-close-confirm
      role="dialog"
      aria-modal="true"
      aria-label={`Close ${title}?`}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          onClose();
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
          return;
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          const other =
            document.activeElement === closeRef.current
              ? cancelRef.current
              : closeRef.current;
          other?.focus();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150"
      style={{ background: 'rgba(4,6,11,0.55)' }}
      onClick={onCancel}
    >
      <div
        className="flex w-[26rem] max-w-[calc(100%-2rem)] flex-col gap-3 rounded border p-4"
        style={{
          borderColor: `${color}55`,
          background: HUD.bg.panelFill,
          boxShadow: `0 0 28px rgba(0,0,0,0.55), 0 0 12px ${color}22`,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="font-mono text-sm" style={{ color: HUD.text }}>
          Close Project <span style={{ color }}>{title}</span>?
        </div>
        <div
          className="font-sans text-xs leading-5"
          style={{ color: HUD.textDim }}
        >
          {tabCount} open {tabCount === 1 ? 'tab' : 'tabs'} will close.
          {workingCount > 0 && (
            <>
              {' '}
              {workingCount === 1
                ? 'One Agent is still working; its turn will be interrupted.'
                : `${workingCount} Agents are still working; their turns will be interrupted.`}
            </>
          )}{' '}
          Sessions move to Recently closed for 14 days. The Project stays in
          your library and can be reopened with ⌘N.
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            className="font-mono"
          >
            Cancel
          </Button>
          <Button
            ref={closeRef}
            type="button"
            size="sm"
            onClick={onClose}
            className="font-mono"
          >
            Close Project ⏎
          </Button>
        </div>
      </div>
    </div>
  );
}

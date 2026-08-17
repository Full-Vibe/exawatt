/**
 * The dialog primary-action contract (BUG-049).
 *
 * The chord itself is a manifest verb dispatched by the shortcut provider;
 * `command-verbs.contract.test.ts` holds that join. This holds the other half:
 * what a dialog publishes, when it publishes it, and what ⌘⏎ finds when it
 * arrives.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from './dialog';
import { runTopDialogPrimaryAction } from './dialog-primary-action';

afterEach(cleanup);

function Sheet({
  open,
  label = 'Send feedback',
  disabled = false,
  onRun,
}: {
  open: boolean;
  label?: string;
  disabled?: boolean;
  onRun: () => void;
}) {
  return (
    <Dialog open={open}>
      <DialogContent
        primaryAction={{ label, run: onRun, disabled }}
        aria-describedby={undefined}
      >
        <DialogTitle>{label}</DialogTitle>
        <textarea aria-label="Feedback" />
        <DialogFooter>
          <button type="button">Cancel</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

describe('a dialog’s primary action', () => {
  it('prints the chord on the button that runs it', () => {
    render(<Sheet open onRun={() => {}} />);
    const button = screen.getByRole('button', { name: /Send feedback/ });
    expect(button.textContent).toContain('⌘↵');
    expect(button.getAttribute('aria-keyshortcuts')).toBe('Meta+Enter');
  });

  it('is what the chord presses', () => {
    const run = vi.fn();
    render(<Sheet open onRun={run} />);
    expect(runTopDialogPrimaryAction()).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('publishes nothing while the dialog is closed', () => {
    // Every provider-level <Dialog> renders its content element whether or not
    // it is open. A primary action registered from there would let ⌘⏎ press a
    // Send button nobody can see.
    const run = vi.fn();
    render(<Sheet open={false} onRun={run} />);
    expect(runTopDialogPrimaryAction()).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('swallows the chord while the action is disabled', () => {
    const run = vi.fn();
    render(<Sheet open disabled onRun={run} />);
    expect(runTopDialogPrimaryAction()).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('answers for the newest dialog when two are open', () => {
    const under = vi.fn();
    const over = vi.fn();
    function Stack() {
      const [second] = useState(true);
      return (
        <>
          <Sheet open label="Save" onRun={under} />
          {second && <Sheet open label="Close Project" onRun={over} />}
        </>
      );
    }
    render(<Stack />);
    expect(runTopDialogPrimaryAction()).toBe(true);
    expect(over).toHaveBeenCalledTimes(1);
    expect(under).not.toHaveBeenCalled();
  });

  it('leaves nothing behind when the dialog closes', () => {
    const { rerender } = render(<Sheet open onRun={() => {}} />);
    expect(runTopDialogPrimaryAction()).toBe(true);
    rerender(<Sheet open={false} onRun={() => {}} />);
    expect(runTopDialogPrimaryAction()).toBe(false);
  });
});

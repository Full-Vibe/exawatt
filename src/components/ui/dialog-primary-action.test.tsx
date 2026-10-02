/**
 * The dialog primary-action contract (BUG-049).
 *
 * The chord itself is a manifest verb dispatched by the shortcut provider;
 * `command-verbs.contract.test.ts` holds that join. This holds the other half:
 * what a dialog publishes, when it publishes it, and what ⌘⏎ finds when it
 * arrives.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTitle, DialogTrigger } from './dialog';
import { runTopDialogPrimaryAction } from './dialog-primary-action';

afterEach(cleanup);

function Sheet({
  open,
  label = 'Send feedback',
  disabled = false,
  onRun,
  forceMount,
}: {
  open: boolean;
  label?: string;
  disabled?: boolean;
  onRun: () => void;
  forceMount?: true;
}) {
  return (
    <Dialog open={open}>
      <DialogContent
        forceMount={forceMount}
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
  it('cannot execute while closed content is retained, and registers only for the open state', () => {
    const run = vi.fn();
    const { rerender } = render(<Sheet open={false} forceMount onRun={run} />);
    const retained = screen.getByRole('dialog');
    expect(retained).toHaveAttribute('data-state', 'closed');
    expect(retained).toHaveAttribute('inert');
    expect(runTopDialogPrimaryAction()).toBe(false);
    rerender(<Sheet open forceMount onRun={run} />);
    expect(retained).not.toHaveAttribute('inert');
    expect(runTopDialogPrimaryAction()).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    rerender(<Sheet open={false} forceMount onRun={run} />);
    expect(retained.isConnected).toBe(true);
    expect(retained).toHaveAttribute('data-state', 'closed');
    expect(retained).toHaveAttribute('inert');
    expect(runTopDialogPrimaryAction()).toBe(false);
    expect(run).toHaveBeenCalledOnce();
  });

  it('uncontrolled trigger and close actions share one logical state even with retained content', () => {
    const run = vi.fn();
    const changed = vi.fn();
    // A force-mounted modal keeps Radix's background isolation. Use its
    // nonmodal mode here to exercise the outside trigger's state ownership.
    render(
      <Dialog defaultOpen={false} onOpenChange={changed} modal={false}>
        <DialogTrigger>Open editor</DialogTrigger>
        <DialogContent forceMount primaryAction={{ label: 'Apply', run }} aria-describedby={undefined}>
          <DialogTitle>Editor</DialogTitle>
          <DialogFooter><DialogClose>Close editor</DialogClose></DialogFooter>
        </DialogContent>
      </Dialog>
    );
    expect(runTopDialogPrimaryAction()).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Open editor' }));
    expect(runTopDialogPrimaryAction()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));
    expect(runTopDialogPrimaryAction()).toBe(false);
    expect(changed.mock.calls).toEqual([[true], [false]]);
    expect(run).toHaveBeenCalledOnce();
  });

  it('respects defaultOpen and releases the action when an uncontrolled dialog closes', () => {
    const run = vi.fn();
    render(
      <Dialog defaultOpen>
        <DialogContent forceMount primaryAction={{ label: 'Apply', run }} aria-describedby={undefined}>
          <DialogTitle>Editor</DialogTitle>
          <DialogFooter><DialogClose>Close editor</DialogClose></DialogFooter>
        </DialogContent>
      </Dialog>
    );
    expect(runTopDialogPrimaryAction()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));
    expect(runTopDialogPrimaryAction()).toBe(false);
    expect(run).toHaveBeenCalledOnce();
  });

  it('keeps controlled authority when the owner refuses a requested close', () => {
    const run = vi.fn();
    const changed = vi.fn();
    const view = (open: boolean) => (
      <Dialog open={open} onOpenChange={changed}>
        <DialogContent forceMount primaryAction={{ label: 'Apply', run }} aria-describedby={undefined}>
          <DialogTitle>Editor</DialogTitle>
          <DialogFooter><DialogClose>Close editor</DialogClose></DialogFooter>
        </DialogContent>
      </Dialog>
    );
    const { rerender } = render(view(true));
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));
    expect(changed).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledWith(false);
    expect(runTopDialogPrimaryAction()).toBe(true);
    rerender(view(false));
    expect(runTopDialogPrimaryAction()).toBe(false);
  });

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

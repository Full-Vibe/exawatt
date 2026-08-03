import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandDialog, CommandInput } from './command';

afterEach(cleanup);

function EscapeHarness() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open commands
      </button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput aria-label="Command search" />
      </CommandDialog>
    </>
  );
}

function ControlledDialog({ open }: { open: boolean }) {
  return (
    <CommandDialog open={open} onOpenChange={() => undefined}>
      <CommandInput aria-label="Command search" />
    </CommandDialog>
  );
}

describe('CommandDialog focus restoration', () => {
  it('restores an ordinary control with preventScroll after Escape', async () => {
    render(<EscapeHarness />);
    const opener = screen.getByRole('button', { name: 'Open commands' });

    opener.focus();
    const focusSpy = vi.spyOn(opener, 'focus');
    fireEvent.click(opener);
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' });

    await waitFor(() => expect(opener).toHaveFocus());
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('restores the xterm helper textarea after a programmatic close', async () => {
    const terminalInput = document.createElement('textarea');
    terminalInput.className = 'xterm-helper-textarea';
    document.body.appendChild(terminalInput);
    terminalInput.focus();
    const focusSpy = vi.spyOn(terminalInput, 'focus');

    const { rerender } = render(<ControlledDialog open />);
    await screen.findByRole('dialog');
    rerender(<ControlledDialog open={false} />);

    await waitFor(() => expect(terminalInput).toHaveFocus());
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    terminalInput.remove();
  });

  it('does not try to focus a target disconnected before close', async () => {
    const target = document.createElement('button');
    document.body.appendChild(target);
    target.focus();
    const focusSpy = vi.spyOn(target, 'focus');

    const { rerender } = render(<ControlledDialog open />);
    await screen.findByRole('dialog');
    target.remove();

    expect(() => rerender(<ControlledDialog open={false} />)).not.toThrow();
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    expect(focusSpy).not.toHaveBeenCalled();
  });
});

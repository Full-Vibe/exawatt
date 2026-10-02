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

function HandoffHarness({ onAccepted }: { onAccepted: () => void }) {
  const [open, setOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Work origin</button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        onAfterClose={() => {
          if (accepted) onAccepted();
          setAccepted(false);
        }}
      >
        <CommandInput aria-label="Command search" />
        <button
          onClick={() => {
            setAccepted(true);
            setOpen(false);
          }}
        >
          Accept action
        </button>
      </CommandDialog>
    </>
  );
}

describe('CommandDialog focus restoration', () => {
  it('runs accepted handoff once after the origin is focused and palette removed', async () => {
    const accepted = vi.fn(() => {
      expect(screen.getByRole('button', { name: 'Work origin' })).toHaveFocus();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    render(<HandoffHarness onAccepted={accepted} />);
    const origin = screen.getByRole('button', { name: 'Work origin' });
    origin.focus();
    fireEvent.click(origin);
    fireEvent.click(screen.getByRole('button', { name: 'Accept action' }));
    await waitFor(() => expect(accepted).toHaveBeenCalledOnce());
    fireEvent.click(origin);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(origin).toHaveFocus());
    expect(accepted).toHaveBeenCalledOnce();
  });
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

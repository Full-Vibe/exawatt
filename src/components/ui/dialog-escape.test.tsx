/**
 * Escape inside a dialog (BUG-302's ladder, dialog rung).
 *
 * Radix answers Escape before any element inside the dialog sees it, so a
 * field's own handler could never keep the dialog open. The dialog now asks
 * its own rungs first, and an IME candidate keeps Escape for itself.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useBackOut } from '@/lib/shortcuts/back-out';
import { Dialog, DialogContent, DialogTitle } from './dialog';

afterEach(cleanup);

function Sheet({ withRename = false }: { withRename?: boolean }) {
  const [open, setOpen] = useState(true);
  const [renaming, setRenaming] = useState(withRename);
  const field = useRef<HTMLInputElement>(null);
  useBackOut({
    rung: 'field',
    element: field,
    enabled: renaming,
    back: () => {
      setRenaming(false);
      return true;
    },
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        primaryAction={{ none: 'A test sheet with no action.' }}
        aria-describedby={undefined}
      >
        <DialogTitle>Sheet</DialogTitle>
        {renaming ? (
          <input ref={field} aria-label="Name" autoFocus />
        ) : (
          <textarea aria-label="Notes" />
        )}
      </DialogContent>
    </Dialog>
  );
}

describe('Escape inside a dialog', () => {
  it('a field rung inside the dialog backs out before the dialog closes', () => {
    render(<Sheet withRename />);
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Escape' });
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByLabelText('Notes'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each([{ isComposing: true }, { keyCode: 229 }])(
    'an IME candidate keeps Escape (%o)',
    init => {
      render(<Sheet />);
      fireEvent.keyDown(screen.getByLabelText('Notes'), {
        key: 'Escape',
        ...init,
      });
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    }
  );
});

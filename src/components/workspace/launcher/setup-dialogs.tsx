'use client';

/**
 * The New Agent window's two questions about a setup: what to call it, and
 * whether to delete it.
 *
 * Both are the app's own dialog (`@/components/ui/dialog`), never the
 * browser's. Electron replaces `window.prompt` with a function that throws
 * ("prompt() is not supported"), so Rename and Name setup… did nothing in the
 * app; and `window.confirm` is a blocking Chromium dialog outside the app's
 * dialog line. macOS button semantics through the dialog contract: Cancel on
 * the left, the declared primary action rightmost with its chord on its face,
 * Return in the name field saves, Escape cancels.
 */

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface SetupNameRequest {
  title: string;
  description: string;
  confirmLabel: string;
  initialName: string;
  /** Rejects with the reason the name was not saved, shown in the dialog. */
  submit: (name: string) => Promise<void>;
}

/** Mounted per request (keyed by the caller), so each opens fresh. */
export function SetupNameDialog({
  request,
  onClose,
}: {
  request: SetupNameRequest;
  onClose: () => void;
}) {
  const [name, setName] = useState(request.initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();
  const errorId = useId();
  const ready = name.trim().length > 0 && !saving;
  const save = async () => {
    if (!ready) return;
    setSaving(true);
    setError(null);
    try {
      await request.submit(name.trim());
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : 'That name could not be saved.'
      );
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        data-setup-name-dialog
        className="sm:max-w-sm"
        showCloseButton={false}
        primaryAction={{
          label: saving ? 'Saving…' : request.confirmLabel,
          run: () => void save(),
          disabled: !ready,
        }}
      >
        <DialogHeader>
          <DialogTitle>{request.title}</DialogTitle>
          <DialogDescription>{request.description}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={event => {
            event.preventDefault();
            void save();
          }}
          className="grid gap-1.5"
        >
          <label htmlFor={fieldId} className="text-chrome-label font-medium">
            Name
          </label>
          <input
            id={fieldId}
            value={name}
            maxLength={80}
            onChange={event => setName(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            data-setup-name-field
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {error ? (
            <p id={errorId} role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </form>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface SetupDeleteRequest {
  label: string;
  confirm: () => Promise<void>;
}

export function SetupDeleteDialog({
  request,
  onClose,
}: {
  request: SetupDeleteRequest;
  onClose: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    if (deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await request.confirm();
      onClose();
    } catch {
      setError('That setup could not be deleted.');
      setDeleting(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !deleting) onClose();
      }}
    >
      <DialogContent
        data-setup-delete-dialog
        className="sm:max-w-sm"
        showCloseButton={false}
        primaryAction={{
          label: deleting ? 'Deleting…' : 'Delete',
          run: () => void confirm(),
          destructive: true,
          disabled: deleting,
        }}
      >
        <DialogHeader>
          <DialogTitle>Delete {request.label}?</DialogTitle>
          <DialogDescription>
            Its launch history in every Project goes with it.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={deleting}
            onClick={onClose}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

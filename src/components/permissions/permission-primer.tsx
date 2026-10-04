'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { permissionDeclaration, type PermissionId } from '@exawatt/core';

/**
 * The first-party primer shown before a system permission prompt (ENG-045),
 * following Apple's guidance for private data: a short explanation and one
 * button that leads into the system dialog. It is the dialog primitive with
 * its one primary action, so Continue gets the chord, the hint and the
 * focus behavior every dialog has.
 *
 * `intro` is the moment before the system prompt. `denied` is the same
 * moment after the user has already said no in macOS, where the only way
 * forward is System Settings and the one button opens it.
 */
type PrimerStep = 'intro' | 'denied';

export interface PrimerState {
  id: PermissionId;
  /** Why the caller needs the grant right now, in the user's words. */
  reason: string;
  step: PrimerStep;
}

export function PermissionPrimer({
  primer,
  onContinue,
  onDismiss,
}: {
  primer: PrimerState;
  onContinue: () => void;
  onDismiss: () => void;
}) {
  const declaration = permissionDeclaration(primer.id);
  const denied = primer.step === 'denied';
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onDismiss();
      }}
    >
      <DialogContent
        showCloseButton={false}
        data-permission-primer={primer.id}
        data-primer-step={primer.step}
        className="sm:max-w-md"
        primaryAction={{
          label: denied ? 'Open System Settings' : 'Continue',
          run: onContinue,
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-base">
            {denied
              ? `${declaration.label} are off for Exawatt`
              : declaration.primer.title}
          </DialogTitle>
          <DialogDescription>
            {denied
              ? `Turn them on in ${declaration.settingsPath}. Exawatt picks the change up here as soon as you make it.`
              : primer.reason}
          </DialogDescription>
        </DialogHeader>
        {!denied && (
          <div className="grid gap-2 text-sm leading-5">
            <p>{declaration.primer.will}</p>
            <p className="text-muted-foreground">{declaration.primer.wont}</p>
          </div>
        )}
        <DialogFooter />
      </DialogContent>
    </Dialog>
  );
}

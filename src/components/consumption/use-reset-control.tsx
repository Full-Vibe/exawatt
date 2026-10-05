'use client';

/**
 * "Use reset" on an account card (ENG-008 E17, operator pick 2026-10-05).
 *
 * Spending a banked reset is irreversible, so it sits behind an in-app
 * confirm with macOS semantics (the dialog primitive's one primary action,
 * Cancel beside it, Escape cancels) that states the effect in facts: which
 * limits go back to zero and how many resets remain. The result comes back
 * in the vendor's own terms and is said in place on the row.
 */
import { useState } from 'react';
import type { PlanResetOutcome } from '@exawatt/core';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CONSUMPTION_CHROME as CHROME } from './flux';
import type { UsageAccount } from './accounts';

const OUTCOME_LINE: Record<PlanResetOutcome, string> = {
  reset: 'Reset used. Limits are back to 0%.',
  'nothing-to-reset': 'Nothing to reset right now. No reset was used.',
  'no-credit': 'No free resets left.',
  failed: "Couldn't use a reset. No reset was used.",
};

export type UseAccountReset = (
  account: UsageAccount
) => Promise<PlanResetOutcome>;

export function UseResetControl({
  account,
  onUseReset,
}: {
  account: UsageAccount;
  onUseReset: UseAccountReset;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<PlanResetOutcome | null>(null);
  const available = account.resets?.available ?? 0;
  const limits = account.meters.filter(m => m.live && m.usedPercent > 0);

  const run = () => {
    setPending(true);
    void onUseReset(account)
      .catch((): PlanResetOutcome => 'failed')
      .then(result => {
        setOutcome(result);
        setPending(false);
        setOpen(false);
      });
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-usage-use-reset={account.key}
        onClick={() => {
          setOutcome(null);
          setOpen(true);
        }}
      >
        Use reset
      </Button>
      {outcome && (
        <span
          data-usage-reset-outcome={outcome}
          className="basis-full text-right text-chrome-meta"
          style={{ color: CHROME.textDim }}
        >
          {OUTCOME_LINE[outcome]}
        </span>
      )}
      <Dialog open={open} onOpenChange={next => !pending && setOpen(next)}>
        <DialogContent
          showCloseButton={false}
          className="sm:max-w-md"
          data-usage-reset-confirm={account.key}
          primaryAction={{ label: 'Use reset', run, disabled: pending }}
        >
          <DialogHeader>
            <DialogTitle className="text-base">
              Use a free {account.name} reset?
            </DialogTitle>
            <DialogDescription>
              {available === 1
                ? 'This is your last free reset.'
                : `${available - 1} of ${available} free resets left after this.`}
            </DialogDescription>
          </DialogHeader>
          {limits.length > 0 && (
            <ul className="grid gap-1 text-sm">
              {limits.map(meter => (
                <li key={meter.key} className="flex justify-between gap-4">
                  <span>{meter.label}</span>
                  <span className="tabular-nums" style={{ color: CHROME.textDim }}>
                    {Math.round(meter.usedPercent)}% to 0%
                  </span>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

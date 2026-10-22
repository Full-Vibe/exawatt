'use client';

import { useEffect, useState } from 'react';
import type {
  MoveToApplicationsOffer,
  MoveToApplicationsOutcome,
  NoticeDismissals,
} from '@exawatt/core/desktop-bridge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  isDismissed,
  moveToApplicationsNotice,
} from '@/lib/notices/notice-identity';

/** What stopped a move, in the words that say what to do next. */
const STAYED: Partial<Record<MoveToApplicationsOutcome, string>> = {
  'other-copy-open':
    'Quit the {product} open from Applications, then try again.',
  failed: "{product} couldn't move itself. Drag it to Applications in Finder.",
};

/**
 * The offer an official build running outside Applications makes once per
 * location (BUG-305): move there, or Not Now. macOS semantics: the move is
 * the default button, Not Now and Escape decline, and declining is kept in
 * main's one record of dismissed notices, so it does not ask again here.
 */
export function MoveToApplicationsDialog() {
  const [productName, setProductName] = useState('Exawatt');
  const [offer, setOffer] = useState<MoveToApplicationsOffer | null>(null);
  const [dismissals, setDismissals] = useState<NoticeDismissals | null>(null);
  const [pending, setPending] = useState(false);
  const [stayed, setStayed] = useState<MoveToApplicationsOutcome | null>(null);

  useEffect(() => {
    const api = window.electron?.app;
    if (!api?.moveToApplicationsOffer) return;
    let live = true;
    void api
      .getBuildInfo()
      .then(info => {
        if (live) setProductName(info.distribution.identity.productName);
      })
      .catch(() => undefined);
    void Promise.all([api.moveToApplicationsOffer(), api.noticeDismissals()])
      .then(([nextOffer, nextDismissals]) => {
        if (!live) return;
        setOffer(nextOffer);
        setDismissals(nextDismissals);
      })
      .catch(() => undefined);
    const off = api.onNoticeDismissalsChanged(next => {
      if (live) setDismissals(next);
    });
    return () => {
      live = false;
      off();
    };
  }, []);

  const notice = moveToApplicationsNotice(offer);
  const open =
    notice !== null && dismissals !== null && !isDismissed(notice, dismissals);
  if (!notice) return null;

  const decline = () => {
    if (pending) return;
    setDismissals(current => ({ ...current, [notice.id]: notice.version }));
    void window.electron?.app
      ?.dismissNotice(notice.id, notice.version)
      .catch(() => undefined);
  };
  const move = () => {
    setPending(true);
    setStayed(null);
    void (
      window.electron?.app?.moveToApplications() ?? Promise.resolve('failed')
    )
      .catch((): MoveToApplicationsOutcome => 'failed')
      .then(outcome => {
        // A move relaunches the app from Applications; this window is closing.
        if (outcome === 'moving') return;
        setPending(false);
        setStayed(outcome);
      });
  };
  const stayedLine = stayed ? STAYED[stayed] : undefined;

  return (
    <Dialog open={open} onOpenChange={next => !next && decline()}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md"
        data-move-to-applications=""
        primaryAction={{
          label: 'Move to Applications',
          run: move,
          disabled: pending,
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-base">
            Move {productName} to Applications?
          </DialogTitle>
          <DialogDescription>
            {stayedLine
              ? stayedLine.replaceAll('{product}', productName)
              : `${productName} keeps itself up to date from the Applications folder.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            data-move-to-applications-decline=""
            onClick={decline}
          >
            Not Now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

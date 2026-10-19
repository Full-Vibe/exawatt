'use client';

import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type {
  NoticeDismissals,
  ProductUpdateStatus,
  ShutdownStatus,
  ShutdownWait,
  UpdateReadyNotice as InstalledBuild,
} from '@exawatt/core/desktop-bridge';
import { Button } from '@/components/ui/button';
import { OperationReceipt } from '@/components/ui/operation-receipt';
import { NoticeLaneItem } from '@/components/ui/notice-lane';
import {
  isDismissed,
  localBuildNotice,
  productUpdateNotice,
} from '@/lib/notices/notice-identity';

/** What a stalled shutdown is waiting on, in the operator's words (BUG-286). */
const WAITING_ON: Record<ShutdownWait, string> = {
  'update-staging': 'Waiting for macOS to accept the update.',
  'agents-starting': 'Waiting for an agent that is still starting.',
  'window-saving': 'Waiting for the window to save your place.',
  'processes-stopping': 'Waiting for agents and shells to stop.',
  'services-closing': 'Waiting for background services to close.',
  installer: 'Waiting for the installer.',
};

/**
 * The update lane: a newer local build, the product updater's progress, and
 * the lifecycle owner's shutdown progress. Every fact is read from main on
 * mount as well as subscribed, and dismissal is main's one record, so a
 * reload, a new window or returning to the app shows exactly what the last
 * window showed (BUG-285).
 */
export function UpdateReadyNotice() {
  const [productName, setProductName] = useState('Exawatt');
  const [installed, setInstalled] = useState<InstalledBuild | null>(null);
  const [status, setStatus] = useState<ProductUpdateStatus | null>(null);
  const [dismissals, setDismissals] = useState<NoticeDismissals>({});
  const [shutdown, setShutdown] = useState<ShutdownStatus | null>(null);
  // An update error that arrives while the restart is finalizing is the
  // installer refusing; one already showing when a quit began is not.
  const finalizing = useRef(false);
  const [installRefused, setInstallRefused] = useState(false);

  useEffect(() => {
    const api = window.electron?.app;
    if (!api) return;
    const ignore = () => undefined;
    void api
      .getBuildInfo()
      .then(info => setProductName(info.distribution.identity.productName))
      .catch(ignore);
    void api.installedBuild?.().then(setInstalled).catch(ignore);
    void api.noticeDismissals?.().then(setDismissals).catch(ignore);
    void api
      .shutdownStatus?.()
      .then(next => {
        finalizing.current = next.phase === 'finalizing';
        setShutdown(next);
      })
      .catch(ignore);
    const updates = api.updates;
    if (updates) {
      void updates.getStatus().then(setStatus).catch(ignore);
    }
    const offLocal = api.onUpdateReady(setInstalled);
    const offDismissals =
      api.onNoticeDismissalsChanged?.(setDismissals) ?? ignore;
    const offProduct = updates
      ? updates.onStatus(next => {
          setStatus(next);
          if (next.phase === 'error' && finalizing.current) {
            setInstallRefused(true);
          }
        })
      : ignore;
    const offShutdown = api.onShutdownStatus(next => {
      finalizing.current = next.phase === 'finalizing';
      if (!finalizing.current) setInstallRefused(false);
      setShutdown(next);
    });
    return () => {
      offLocal();
      offDismissals();
      offProduct();
      offShutdown();
    };
  }, []);

  const localNotice = localBuildNotice(installed);
  const productNotice = productUpdateNotice(status);
  const showLocal =
    localNotice !== null && !isDismissed(localNotice, dismissals);
  const showProduct =
    productNotice !== null && !isDismissed(productNotice, dismissals);
  // The installer's refusal outranks "Closing…": hiding its reason is how a
  // failed install read as a hang (BUG-286, incident 0026).
  const shutdownActive =
    shutdown &&
    !installRefused &&
    (shutdown.phase === 'preparing' ||
      shutdown.phase === 'checkpointing' ||
      shutdown.phase === 'stopping' ||
      shutdown.phase === 'finalizing');
  if (!showLocal && !showProduct && !shutdownActive) return null;

  const message = shutdownActive
    ? shutdown.phase === 'preparing'
      ? `Preparing ${productName} ${status?.availableVersion ?? 'update'}…`
      : shutdown.phase === 'checkpointing'
        ? 'Saving Session state…'
        : shutdown.phase === 'stopping'
          ? `Stopping ${shutdown.agents} ${shutdown.agents === 1 ? 'agent' : 'agents'}${shutdown.shells > 0 ? ` and ${shutdown.shells} ${shutdown.shells === 1 ? 'shell' : 'shells'}` : ''}…`
          : `Closing ${productName}…`
    : showLocal
      ? 'New local build installed. Restart when convenient.'
      : status?.phase === 'checking'
        ? 'Checking for updates…'
        : status?.phase === 'available'
          ? `${productName} ${status.availableVersion} is available.`
          : status?.phase === 'downloading'
            ? `Downloading ${productName} ${status.availableVersion} · ${Math.round(status.percent ?? 0)}%`
            : status?.phase === 'downloaded'
              ? `${productName} ${status.availableVersion} is ready to install.`
              : // the reason is the whole value of this line: without it a
                // stuck user can only report "it failed" (ENG-030 OS1.6)
                `Update failed, so ${productName} ${status?.currentVersion} stays installed. ${status?.error ?? 'No reason was reported.'}`;

  const dismissed = showLocal ? localNotice : productNotice;
  const waitingOn = shutdownActive ? shutdown.waitingOn : null;

  return (
    <NoticeLaneItem lane="update">
      <OperationReceipt
        state={
          shutdownActive ||
          (!showLocal &&
            (status?.phase === 'checking' || status?.phase === 'downloading'))
            ? 'pending'
            : showLocal || status?.phase === 'downloaded'
              ? 'success'
              : status?.phase === 'error'
                ? 'error'
                : 'neutral'
        }
        title={message}
        description={
          waitingOn
            ? WAITING_ON[waitingOn]
            : !shutdownActive && (showLocal || status?.phase === 'downloaded')
              ? 'Tabs, purpose, read status and unanswered requests are saved, and so is where you are. Agents reopen paused; you choose when to resume.'
              : undefined
        }
        actions={
          shutdownActive && shutdown.cancellable ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void window.electron?.app?.cancelShutdown?.()}
            >
              Cancel
            </Button>
          ) : !shutdownActive &&
            !showLocal &&
            status?.phase === 'downloaded' ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void window.electron?.app?.updates?.restart()}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Restart to Update
            </Button>
          ) : undefined
        }
        dismissLabel="Dismiss update notice"
        onDismiss={
          shutdownActive || !dismissed
            ? undefined
            : () => {
                // Hidden at once; main's record makes it hold everywhere.
                setDismissals(current => ({
                  ...current,
                  [dismissed.id]: dismissed.version,
                }));
                void window.electron?.app
                  ?.dismissNotice?.(dismissed.id, dismissed.version)
                  .then(setDismissals)
                  .catch(() => undefined);
              }
        }
      />
    </NoticeLaneItem>
  );
}

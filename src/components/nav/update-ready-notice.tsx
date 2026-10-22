'use client';

import { useEffect, useRef, useState } from 'react';
import {
  useLatestRequest,
  type LatestRequest,
} from '@/hooks/use-latest-request';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import type {
  NoticeDismissals,
  PreviousVersion,
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
  whatsNewNotice,
} from '@/lib/notices/notice-identity';
import { EXAWATT_HOSTED_ORIGIN } from '@/lib/analytics/config';
import { changelogEntryUrl } from '@/lib/changelog/versions.mjs';

/** What a stalled shutdown is waiting on, in the operator's words (BUG-286). */
const WAITING_ON: Record<ShutdownWait, string> = {
  'update-staging': 'Waiting for macOS to accept the update.',
  'agents-starting': 'Waiting for an agent that is still starting.',
  'window-saving': 'Waiting for the window to save your place.',
  'history-saving': 'Waiting for terminal history to save.',
  'processes-stopping': 'Waiting for agents and shells to stop.',
  'run-recording': 'Waiting to record that everything stopped.',
  'services-closing': 'Waiting for background services to close.',
  installer: 'Waiting for the installer.',
  relaunching: 'Waiting to reopen the current version.',
};

/**
 * One fact main both answers on request and pushes. Every push, and every
 * change this window makes, supersedes a read still in flight, so a read
 * commits only while nothing newer has landed (the 0.1.22 review: a mount
 * read that answered late put an older answer back on screen).
 */
function orderedFact<T>(channel: LatestRequest, commit: (value: T) => void) {
  return {
    read(request: Promise<T> | undefined): void {
      const ticket = channel.begin();
      void request
        ?.then(value => {
          if (ticket.current) commit(value);
        })
        .catch(() => undefined);
    },
    push(value: T): void {
      channel.begin();
      commit(value);
    },
  };
}

/**
 * The update lane: a newer local build, the product updater's progress, the
 * lifecycle owner's shutdown progress, and what is new in the version the
 * app just started on (ENG-031 W28). Every fact is read from main on
 * mount as well as subscribed, ordered against its pushes, and dismissal is
 * main's one record, so a reload, a new window or returning to the app shows
 * exactly what the last window showed (BUG-285).
 */
export function UpdateReadyNotice() {
  const [productName, setProductName] = useState('Exawatt');
  const [installed, setInstalled] = useState<InstalledBuild | null>(null);
  const [status, setStatus] = useState<ProductUpdateStatus | null>(null);
  const [dismissals, setDismissals] = useState<NoticeDismissals>({});
  const [shutdown, setShutdown] = useState<ShutdownStatus | null>(null);
  // Fixed for the run, so read once and never pushed.
  const [previousVersion, setPreviousVersion] =
    useState<PreviousVersion | null>(null);
  // An update error that arrives while the restart is finalizing is the
  // installer refusing; one already showing when a quit began is not.
  const finalizing = useRef(false);
  const [installRefused, setInstallRefused] = useState(false);
  const installedReads = useLatestRequest();
  const statusReads = useLatestRequest();
  const dismissalReads = useLatestRequest();
  const shutdownReads = useLatestRequest();

  useEffect(() => {
    const api = window.electron?.app;
    if (!api) return;
    const ignore = () => undefined;
    void api
      .getBuildInfo()
      .then(info => setProductName(info.distribution.identity.productName))
      .catch(ignore);
    const installedFact = orderedFact(installedReads, setInstalled);
    const dismissalFact = orderedFact(dismissalReads, setDismissals);
    const shutdownFact = orderedFact<ShutdownStatus>(shutdownReads, next => {
      finalizing.current = next.phase === 'finalizing';
      setShutdown(next);
    });
    const statusFact = orderedFact(statusReads, setStatus);
    installedFact.read(api.installedBuild?.());
    dismissalFact.read(api.noticeDismissals?.());
    shutdownFact.read(api.shutdownStatus?.());
    void api.previousVersion?.().then(setPreviousVersion).catch(ignore);
    const updates = api.updates;
    if (updates) statusFact.read(updates.getStatus());
    const offLocal = api.onUpdateReady(installedFact.push);
    const offDismissals =
      api.onNoticeDismissalsChanged?.(dismissalFact.push) ?? ignore;
    const offProduct = updates
      ? updates.onStatus(next => {
          statusFact.push(next);
          if (next.phase === 'error' && finalizing.current) {
            setInstallRefused(true);
          }
        })
      : ignore;
    const offShutdown = api.onShutdownStatus(next => {
      shutdownFact.push(next);
      if (!finalizing.current) setInstallRefused(false);
    });
    return () => {
      offLocal();
      offDismissals();
      offProduct();
      offShutdown();
    };
  }, [installedReads, statusReads, dismissalReads, shutdownReads]);

  const localNotice = localBuildNotice(installed);
  const productNotice = productUpdateNotice(status);
  const whatsNew = whatsNewNotice(previousVersion, status);
  const showLocal =
    localNotice !== null && !isDismissed(localNotice, dismissals);
  const showProduct =
    productNotice !== null && !isDismissed(productNotice, dismissals);
  const showWhatsNew = whatsNew !== null && !isDismissed(whatsNew, dismissals);
  // The installer's refusal outranks "Closing…": hiding its reason is how a
  // failed install read as a hang (BUG-286, incident 0026).
  const shutdownActive =
    shutdown &&
    !installRefused &&
    (shutdown.phase === 'preparing' ||
      shutdown.phase === 'checkpointing' ||
      shutdown.phase === 'stopping' ||
      shutdown.phase === 'finalizing');
  if (!showLocal && !showProduct && !showWhatsNew && !shutdownActive)
    return null;
  // News waits behind anything the operator may have to act on.
  const news =
    !shutdownActive && !showLocal && !showProduct && showWhatsNew
      ? whatsNew
      : null;

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
      : news
        ? `What's new in ${news.version}`
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

  const dismissed = showLocal ? localNotice : (news ?? productNotice);
  const waitingOn = shutdownActive ? shutdown.waitingOn : null;

  // Hidden at once; main's record makes it hold everywhere. The write
  // supersedes any read in flight, and main's answer commits only if nothing
  // newer arrived first.
  const dismiss = (notice: { id: string; version: string }) => {
    const ticket = dismissalReads.begin();
    setDismissals(current => ({ ...current, [notice.id]: notice.version }));
    void window.electron?.app
      ?.dismissNotice?.(notice.id, notice.version)
      .then(next => {
        if (ticket.current) setDismissals(next);
      })
      .catch(() => undefined);
  };

  return (
    <NoticeLaneItem lane="update">
      <OperationReceipt
        state={
          news
            ? 'neutral'
            : shutdownActive ||
                (!showLocal &&
                  (status?.phase === 'checking' ||
                    status?.phase === 'downloading'))
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
            : !shutdownActive &&
                !news &&
                (showLocal || status?.phase === 'downloaded')
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
          ) : news ? (
            <Button asChild size="sm" variant="outline">
              {/* Opened in the browser: main hands an https window to it. */}
              <a
                href={changelogEntryUrl(EXAWATT_HOSTED_ORIGIN, news.version)}
                target="_blank"
                rel="noreferrer"
                data-whats-new={news.version}
                onClick={() => dismiss(news)}
              >
                Read
                <ArrowUpRight className="size-4" aria-hidden="true" />
              </a>
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
          shutdownActive || !dismissed ? undefined : () => dismiss(dismissed)
        }
      />
    </NoticeLaneItem>
  );
}

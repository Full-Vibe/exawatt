'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { ProductUpdateStatus } from '@exawatt/core/desktop-bridge';
import { Button } from '@/components/ui/button';
import { OperationReceipt } from '@/components/ui/operation-receipt';
import { NoticeLaneItem } from '@/components/ui/notice-lane';

export function UpdateReadyNotice() {
  const [productName, setProductName] = useState('Exawatt');
  const [installedSha, setInstalledSha] = useState<string | null>(null);
  const [status, setStatus] = useState<ProductUpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [shutdown, setShutdown] = useState<{
    phase: 'idle' | 'confirming' | 'checkpointing' | 'stopping' | 'finalizing';
    agents: number;
    shells: number;
  } | null>(null);

  useEffect(() => {
    const api = window.electron?.app;
    if (!api) return;
    void api
      .getBuildInfo()
      .then(info => setProductName(info.distribution.identity.productName))
      .catch(() => undefined);
    const updates = api.updates;
    if (updates) {
      void updates
        .getStatus()
        .then(setStatus)
        .catch(() => undefined);
    }
    const offLocal = api.onUpdateReady(update => {
      setInstalledSha(update.installedSha);
    });
    const offProduct = updates
      ? updates.onStatus(next => {
          setStatus(next);
          setDismissed(null);
        })
      : () => undefined;
    const offShutdown = api.onShutdownStatus(setShutdown);
    return () => {
      offLocal();
      offProduct();
      offShutdown();
    };
  }, []);

  const productKey = status
    ? `${status.phase}:${status.availableVersion ?? ''}:${status.error ?? ''}`
    : null;
  const showProduct =
    status && status.phase !== 'idle' && productKey !== dismissed;
  const shutdownActive =
    shutdown &&
    (shutdown.phase === 'checkpointing' ||
      shutdown.phase === 'stopping' ||
      shutdown.phase === 'finalizing');
  if (!installedSha && !showProduct && !shutdownActive) return null;

  const message = shutdownActive
    ? shutdown.phase === 'checkpointing'
      ? 'Saving Session state…'
      : shutdown.phase === 'stopping'
        ? `Stopping ${shutdown.agents} ${shutdown.agents === 1 ? 'agent' : 'agents'}${shutdown.shells > 0 ? ` and ${shutdown.shells} ${shutdown.shells === 1 ? 'shell' : 'shells'}` : ''}…`
        : `Closing ${productName}…`
    : installedSha
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

  return (
    <NoticeLaneItem lane="update">
      <OperationReceipt
        state={
          shutdownActive ||
          (!installedSha &&
            (status?.phase === 'checking' || status?.phase === 'downloading'))
            ? 'pending'
            : installedSha || status?.phase === 'downloaded'
              ? 'success'
              : status?.phase === 'error'
                ? 'error'
                : 'neutral'
        }
        title={message}
        actions={
          !shutdownActive && !installedSha && status?.phase === 'downloaded' ? (
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
          shutdownActive
            ? undefined
            : () => {
                if (installedSha) setInstalledSha(null);
                else setDismissed(productKey);
              }
        }
      />
    </NoticeLaneItem>
  );
}

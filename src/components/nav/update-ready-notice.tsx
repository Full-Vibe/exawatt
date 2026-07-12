'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import type { ProductUpdateStatus } from '@/types/electron';

export function UpdateReadyNotice() {
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
      .getUpdateStatus()
      .then(setStatus)
      .catch(() => undefined);
    const offLocal = api.onUpdateReady(update => {
      setInstalledSha(update.installedSha);
    });
    const offProduct = api.onUpdateStatus(next => {
      setStatus(next);
      setDismissed(null);
    });
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
        : 'Closing Exawatt…'
    : installedSha
      ? 'New local build installed. Restart when convenient.'
      : status?.phase === 'checking'
        ? 'Checking for updates…'
        : status?.phase === 'available'
          ? `Exawatt ${status.availableVersion} is available.`
          : status?.phase === 'downloading'
            ? `Downloading Exawatt ${status.availableVersion} · ${Math.round(status.percent ?? 0)}%`
            : status?.phase === 'downloaded'
              ? `Exawatt ${status.availableVersion} is ready to install.`
              : `Update failed. Exawatt ${status?.currentVersion} remains installed.`;

  return (
    <div className="fixed bottom-8 left-1/2 z-[100] flex w-[min(42rem,calc(100%-2rem))] -translate-x-1/2 flex-wrap items-center gap-3 border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 shadow-lg">
      <span className="min-w-0 flex-1">{message}</span>
      {!shutdownActive && !installedSha && status?.phase === 'downloaded' && (
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1.5 border border-white/15 px-2 text-zinc-100 hover:bg-white/10"
          onClick={() => void window.electron?.app?.restartUpdate()}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Restart to Update
        </button>
      )}
      {!shutdownActive && (
        <button
          type="button"
          className="ml-auto grid h-6 w-6 shrink-0 place-items-center text-zinc-400 hover:text-white"
          aria-label="Dismiss update notice"
          title="Dismiss"
          onClick={() => {
            if (installedSha) setInstalledSha(null);
            else setDismissed(productKey);
          }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

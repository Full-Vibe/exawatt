'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import type { ProductUpdateStatus } from '@/types/electron';

export function UpdateReadyNotice() {
  const [installedSha, setInstalledSha] = useState<string | null>(null);
  const [status, setStatus] = useState<ProductUpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    const api = window.electron?.app;
    if (!api) return;
    void api.getUpdateStatus().then(setStatus).catch(() => undefined);
    const offLocal = api.onUpdateReady(update => {
      setInstalledSha(update.installedSha);
    });
    const offProduct = api.onUpdateStatus(next => {
      setStatus(next);
      setDismissed(null);
    });
    return () => {
      offLocal();
      offProduct();
    };
  }, []);

  const productKey = status
    ? `${status.phase}:${status.availableVersion ?? ''}:${status.error ?? ''}`
    : null;
  const showProduct =
    status && status.phase !== 'idle' && productKey !== dismissed;
  if (!installedSha && !showProduct) return null;

  const message = installedSha
    ? 'New local build installed. Restart when convenient.'
    : status?.phase === 'checking'
      ? 'Checking for updates…'
      : status?.phase === 'available'
        ? `Exawatt ${status.availableVersion} is available.`
        : status?.phase === 'downloading'
          ? `Downloading Exawatt ${status.availableVersion} · ${Math.round(status.percent ?? 0)}%`
          : status?.phase === 'downloaded'
            ? `Exawatt ${status.availableVersion} is ready.${status.liveSessions > 0 ? ` Restarting will stop ${status.liveSessions} live session${status.liveSessions === 1 ? '' : 's'}.` : ''}`
            : `Update failed. Exawatt ${status?.currentVersion} remains installed.`;

  return (
    <div className="fixed bottom-8 left-1/2 z-[100] flex w-[min(42rem,calc(100%-2rem))] -translate-x-1/2 flex-wrap items-center gap-3 border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 shadow-lg">
      <span className="min-w-0 flex-1">{message}</span>
      {!installedSha && status?.phase === 'downloaded' && (
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1.5 border border-white/15 px-2 text-zinc-100 hover:bg-white/10"
          onClick={() => void window.electron?.app?.restartUpdate()}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Restart when convenient
        </button>
      )}
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
    </div>
  );
}

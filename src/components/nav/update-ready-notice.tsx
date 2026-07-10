'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

export function UpdateReadyNotice() {
  const [installedSha, setInstalledSha] = useState<string | null>(null);

  useEffect(() => {
    return window.electron?.app?.onUpdateReady(update => {
      setInstalledSha(update.installedSha);
    });
  }, []);

  if (!installedSha) return null;

  return (
    <div className="fixed bottom-8 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-3 border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 shadow-lg">
      <span>New build installed. Restart when convenient.</span>
      <button
        type="button"
        className="grid h-6 w-6 place-items-center text-zinc-400 hover:text-white"
        aria-label="Dismiss update notice"
        title="Dismiss"
        onClick={() => setInstalledSha(null)}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useLatestRequest } from '@/hooks/use-latest-request';
import type { HostPowerSnapshot } from '@exawatt/core/desktop-bridge';

/** Rendering facts are independent of the Agent source. Demo and Live on
 * the same Electron host therefore conserve the same battery. A hosted
 * browser has no host bridge and retains its ordinary visibility policy.
 *
 * Battery is reported as its own fact. It is a cadence input for ambient
 * motion, not the weak-hardware low-power mode: it must never lower the
 * board's resolution or freeze a Working mark (BUG-263). */
export function useHostRenderPolicy(): {
  onBattery: boolean;
  visible: boolean;
} {
  const reads = useLatestRequest();
  const [host, setHost] = useState<HostPowerSnapshot | null>(null);
  const [pageVisible, setPageVisible] = useState(
    () =>
      typeof document === 'undefined' || document.visibilityState === 'visible'
  );
  useEffect(() => {
    const updateVisibility = () =>
      setPageVisible(document.visibilityState === 'visible');
    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);
    const app = window.electron?.app;
    const ticket = reads.begin();
    let revision = -1;
    const receive = (snapshot: HostPowerSnapshot) => {
      if (!ticket.current || snapshot.revision < revision) return;
      revision = snapshot.revision;
      setHost(snapshot);
    };
    // Subscribe before reading, then reject an older read arriving after a
    // newer push. Otherwise an unplug or lock during mount can be undone.
    const unsubscribe = app?.onHostPowerChanged?.(receive);
    void app
      ?.hostPower?.()
      .then(receive)
      .catch(() => {
        // An unavailable host observation is not a claim of AC or unlock.
      });
    return () => {
      reads.invalidate();
      unsubscribe?.();
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, [reads]);
  return {
    onBattery: host?.powerSource === 'battery',
    visible:
      pageVisible &&
      host?.screenLock !== 'locked' &&
      host?.systemSleep !== 'suspended',
  };
}

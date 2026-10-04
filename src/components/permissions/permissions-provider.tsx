'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  PermissionId,
  PermissionState,
  PermissionsSnapshot,
} from '@exawatt/core';
import type { DesktopPermissionsApi } from '@exawatt/core/desktop-bridge';
import { useLatestRequest } from '@/hooks/use-latest-request';
import { PermissionPrimer, type PrimerState } from './permission-primer';

/**
 * The renderer's one view of the permission registry (ENG-045): a read-only
 * snapshot, and `ensure`, the one way a surface asks for a grant at its moment
 * of need. Main owns every status read and every system prompt; this provider
 * shows the first-party primer main asks for, hands the user's Continue back,
 * and follows the answer.
 *
 * It re-reads when the window regains focus and while the system prompt or
 * System Settings is the thing the user is looking at, so a grant made there
 * shows up without a restart.
 */

/** How often to re-read while the user is answering a prompt in macOS. */
const FOLLOW_INTERVAL_MS = 1500;

interface PermissionsValue {
  /** False outside the desktop app, where there is nothing to grant. */
  available: boolean;
  /** Null until the first read lands. */
  snapshot: PermissionsSnapshot | null;
  stateOf: (id: PermissionId) => PermissionState | null;
  /**
   * Asks for a grant at a moment of need. Resolves true once it is given and
   * false when the user dismissed the primer or declined the prompt. A grant
   * that macOS cannot report is attempted rather than refused.
   */
  ensure: (id: PermissionId, reason: string) => Promise<boolean>;
  /** Opens the grant's System Settings pane and follows the change. */
  openSettings: (id: PermissionId) => void;
}

const UNAVAILABLE: PermissionsValue = {
  available: false,
  snapshot: null,
  stateOf: () => null,
  ensure: () => Promise.resolve(false),
  openSettings: () => undefined,
};

const PermissionsContext = createContext<PermissionsValue>(UNAVAILABLE);

export function usePermissions(): PermissionsValue {
  return useContext(PermissionsContext);
}

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const [api, setApi] = useState<DesktopPermissionsApi | null>(null);
  const [snapshot, setSnapshot] = useState<PermissionsSnapshot | null>(null);
  const [primer, setPrimer] = useState<PrimerState | null>(null);
  const [following, setFollowing] = useState(false);
  const primerRef = useRef<PrimerState | null>(null);
  const reads = useLatestRequest();
  // Callers waiting on an `ensure`, and which prompt each one is behind.
  const waiters = useRef(new Map<PermissionId, Array<(ok: boolean) => void>>());
  /** The system prompt is up: a denial settles the waiter as false. */
  const answering = useRef(new Set<PermissionId>());
  /** System Settings is open: only a grant settles it. */
  const inSettings = useRef(new Set<PermissionId>());

  const showPrimer = useCallback((next: PrimerState | null) => {
    primerRef.current = next;
    setPrimer(next);
  }, []);

  const syncFollowing = useCallback(() => {
    setFollowing(
      answering.current.size > 0 ||
        inSettings.current.size > 0 ||
        primerRef.current !== null
    );
  }, []);

  const settle = useCallback((id: PermissionId, ok: boolean) => {
    const pending = waiters.current.get(id) ?? [];
    waiters.current.delete(id);
    for (const resolve of pending) resolve(ok);
  }, []);

  const apply = useCallback(
    (next: PermissionsSnapshot) => {
      setSnapshot(next);
      for (const { id, state } of next) {
        if (state === 'granted' || state === 'needs-relaunch') {
          answering.current.delete(id);
          inSettings.current.delete(id);
          if (primerRef.current?.id === id) showPrimer(null);
          settle(id, true);
        } else if (
          (state === 'denied' || state === 'restricted') &&
          answering.current.has(id)
        ) {
          answering.current.delete(id);
          settle(id, false);
        }
      }
      syncFollowing();
    },
    [settle, showPrimer, syncFollowing]
  );

  const refresh = useCallback(
    (bridge: DesktopPermissionsApi) => {
      const ticket = reads.begin();
      void bridge.refresh().then(
        next => {
          if (ticket.current) apply(next);
        },
        () => undefined
      );
    },
    [apply, reads]
  );

  useEffect(() => {
    const bridge = window.electron?.permissions;
    if (!bridge) return;
    setApi(bridge);
    const ticket = reads.begin();
    void bridge.snapshot().then(
      next => {
        if (ticket.current) apply(next);
      },
      () => undefined
    );
    const offChanged = bridge.onChanged?.(next => apply(next));
    // Main saw a moment of need while the user was elsewhere.
    const offPrimer = bridge.onPrimerRequested?.(request => {
      if (primerRef.current) return;
      showPrimer({ id: request.id, reason: request.reason, step: 'intro' });
      syncFollowing();
    });
    const onFocus = () => refresh(bridge);
    window.addEventListener('focus', onFocus);
    return () => {
      reads.invalidate();
      offChanged?.();
      offPrimer?.();
      window.removeEventListener('focus', onFocus);
    };
  }, [apply, reads, refresh, showPrimer, syncFollowing]);

  useEffect(() => {
    if (!api || !following) return;
    const timer = setInterval(() => refresh(api), FOLLOW_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [api, following, refresh]);

  const waitFor = useCallback(
    (id: PermissionId, show: () => void) =>
      new Promise<boolean>(resolve => {
        waiters.current.set(id, [...(waiters.current.get(id) ?? []), resolve]);
        show();
        syncFollowing();
      }),
    [syncFollowing]
  );

  const ensure = useCallback(
    async (id: PermissionId, reason: string) => {
      if (!api) return false;
      let result;
      try {
        result = await api.ensure(id, { reason });
      } catch {
        return false;
      }
      if (result.outcome === 'ready') return true;
      if (result.outcome === 'primer') {
        return waitFor(id, () => showPrimer({ id, reason, step: 'intro' }));
      }
      if (result.outcome === 'settings' && result.state === 'denied') {
        return waitFor(id, () => showPrimer({ id, reason, step: 'denied' }));
      }
      return false;
    },
    [api, showPrimer, waitFor]
  );

  const openSettings = useCallback(
    (id: PermissionId) => {
      if (!api) return;
      void api.openSettings(id).catch(() => undefined);
      inSettings.current.add(id);
      syncFollowing();
    },
    [api, syncFollowing]
  );

  const dismissPrimer = useCallback(() => {
    const open = primerRef.current;
    showPrimer(null);
    if (open) {
      inSettings.current.delete(open.id);
      if (!answering.current.has(open.id)) settle(open.id, false);
    }
    syncFollowing();
  }, [settle, showPrimer, syncFollowing]);

  const continuePrimer = useCallback(async () => {
    const open = primerRef.current;
    if (!open || !api) return;
    if (open.step === 'denied') {
      // The primer stays up, and the change is followed, until it is made.
      openSettings(open.id);
      return;
    }
    // The system prompt takes over from here.
    showPrimer(null);
    let result;
    try {
      result = await api.ensure(open.id, { reason: open.reason, primed: true });
    } catch {
      settle(open.id, false);
      syncFollowing();
      return;
    }
    if (result.outcome === 'ready' || result.outcome === 'relaunch') {
      settle(open.id, true);
    } else if (result.outcome === 'requested') {
      // A status macOS cannot report is not a refusal: attempt it and let
      // the system decide. Otherwise follow the answer.
      if (result.state === 'unknown') settle(open.id, true);
      else answering.current.add(open.id);
    } else {
      settle(open.id, false);
    }
    syncFollowing();
  }, [api, openSettings, settle, showPrimer, syncFollowing]);

  const value = useMemo<PermissionsValue>(
    () => ({
      available: api !== null,
      snapshot,
      stateOf: id => snapshot?.find(entry => entry.id === id)?.state ?? null,
      ensure,
      openSettings,
    }),
    [api, ensure, openSettings, snapshot]
  );

  return (
    <PermissionsContext.Provider value={value}>
      {children}
      {primer && (
        <PermissionPrimer
          primer={primer}
          onContinue={() => void continuePrimer()}
          onDismiss={dismissPrimer}
        />
      )}
    </PermissionsContext.Provider>
  );
}

'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { navHistory, type NavLocation } from './nav-history';
import { requestTabSelect } from '@/components/workspace/session-jump';
import { Grid2X2, Orbit, SquareTerminal } from 'lucide-react';
import {
  COMMAND_ALTITUDE_SURFACES,
  resolveCommandAltitude,
  type CommandAltitude,
} from './command-altitude';
import { resolveSurfaceHref } from './surfaces';
import {
  FOCUS_SESSIONS_EVENT,
  RECENTER_SPATIAL_EVENT,
} from './command-altitude-events';
import { FOCUS_ACTIVE_TERMINAL_EVENT } from '@/components/workspace/session-jump';
import {
  altitudeHandoffAllowed,
  captureAltitudeCards,
  prefersReducedMotion,
  publishAltitudeHandoff,
  type HandoffSnapshot,
} from './altitude-handoff';
import { AltitudeHandoffGhosts } from './altitude-handoff-ghosts';

/** `handoff` (ENG-004 V3.0, decision 0023): Team → Fleet position handoff.
 *  Card ghosts crossfade into board zones at the entry pose; every other
 *  phase is the fast directional transition, which is also this phase's
 *  guaranteed fallback. */
type TransitionPhase = 'departing' | 'traversing' | 'arriving' | 'handoff';

/** V2.4: transitions are DIRECTIONAL along the command-altitude continuum.
 *  Ascending (toward Spatial) pulls back — the frame rings contract like a
 *  world shrinking below you; descending (toward Terminal) dives — the rings
 *  expand past the viewport. */
type TransitionDirection = 'ascend' | 'descend';

const ALTITUDE_ORDER: Record<CommandAltitude, number> = {
  terminal: 0,
  sessions: 1,
  spatial: 2,
};

interface CommandTransition {
  phase: TransitionPhase;
  target: CommandAltitude;
  direction: TransitionDirection;
  startedAt: number;
  /** Present only while `phase === 'handoff'`. */
  handoff?: HandoffSnapshot;
}

interface CommandNavigationContextValue {
  navigateCommandSurface: (
    href: string,
    options?: { replace?: boolean }
  ) => void;
  activateCommandAltitude: (target: CommandAltitude) => void;
  /** ⌘[ / ⌘] (D27): walk recorded app locations — surfaces AND tabs */
  canNavigateBack: boolean;
  canNavigateForward: boolean;
  navigateBack: () => boolean;
  navigateForward: () => boolean;
}

const CommandNavigationContext =
  createContext<CommandNavigationContextValue | null>(null);

function commandRegime(pathname: string): 'terminal' | 'spatial' | null {
  if (pathname.startsWith('/fleet/spatial')) return 'spatial';
  if (pathname.startsWith('/workspace')) return 'terminal';
  return null;
}

export function useCommandNavigation() {
  const value = useContext(CommandNavigationContext);
  if (!value) {
    throw new Error(
      'useCommandNavigation must be used within CommandNavigationProvider'
    );
  }
  return value;
}

export function CommandNavigationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [transition, setTransition] = useState<CommandTransition | null>(null);
  useSyncExternalStore(navHistory.subscribe, navHistory.getRevision, () => 0);
  const canNavigateBack = navHistory.canBack();
  const canNavigateForward = navHistory.canForward();
  const targetPath = useRef<string | null>(null);
  const frame = useRef<number | null>(null);
  const timer = useRef<number | null>(null);

  const clearScheduled = useCallback(() => {
    if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    if (timer.current !== null) window.clearTimeout(timer.current);
    frame.current = null;
    timer.current = null;
  }, []);

  const navigateCommandSurface = useCallback(
    (href: string, options?: { replace?: boolean }) => {
      const targetUrl = new URL(href, window.location.origin);
      const currentRegime = commandRegime(window.location.pathname);
      const targetRegime = commandRegime(targetUrl.pathname);
      const targetAltitude = resolveCommandAltitude(
        targetUrl.pathname,
        targetUrl.searchParams
      );
      const crossesRegime =
        currentRegime !== null &&
        targetRegime !== null &&
        currentRegime !== targetRegime;

      if (!crossesRegime) {
        if (options?.replace) router.replace(href);
        else router.push(href);
        return;
      }

      clearScheduled();
      const startedAt = performance.now();
      targetPath.current = targetUrl.pathname;
      const currentAltitude = resolveCommandAltitude(
        window.location.pathname,
        new URLSearchParams(window.location.search)
      );
      const target = targetAltitude ?? targetRegime;
      const direction: TransitionDirection =
        ALTITUDE_ORDER[target] >=
        ALTITUDE_ORDER[currentAltitude ?? 'terminal']
          ? 'ascend'
          : 'descend';
      // Team → Fleet position handoff (V3.0): capture the visible cards and
      // let the board claim them for its entry pose. Any decline — reduced
      // motion, low power, nothing to capture, or later a missed budget or
      // unsolvable pose — takes the ordinary directional cut instead.
      const handoff =
        currentAltitude === 'sessions' &&
        target === 'spatial' &&
        altitudeHandoffAllowed()
          ? captureAltitudeCards()
          : null;
      if (handoff) {
        publishAltitudeHandoff(handoff);
        setTransition({
          phase: 'handoff',
          target,
          direction,
          startedAt,
          handoff,
        });
        frame.current = window.requestAnimationFrame(() => {
          frame.current = null;
          // Hard safety net: the ghost layer owns completion (pose or
          // fallback); if it never reports, the transition still ends.
          timer.current = window.setTimeout(() => {
            setTransition(null);
            targetPath.current = null;
            timer.current = null;
          }, 3_000);
          if (options?.replace) router.replace(href);
          else router.push(href);
        });
        return;
      }
      setTransition({
        phase: 'departing',
        target,
        direction,
        startedAt,
      });
      frame.current = window.requestAnimationFrame(() => {
        frame.current = null;
        setTransition({
          phase: 'traversing',
          target,
          direction,
          startedAt,
        });
        timer.current = window.setTimeout(() => {
          setTransition(null);
          targetPath.current = null;
          timer.current = null;
        }, 1_200);
        if (options?.replace) router.replace(href);
        else router.push(href);
      });
    },
    [clearScheduled, router]
  );

  // ── App-location back stack (D27). The workspace records its own richer
  // entries (surface + active tab); this provider records every OTHER
  // route (settings, spatial, …) so the stack spans the whole app.
  useEffect(() => {
    if (pathname.startsWith('/workspace')) return;
    navHistory.visit({
      surface: `${window.location.pathname}${window.location.search}`,
    });
  }, [pathname]);

  const applyLocation = useCallback(
    (location: NavLocation) => {
      const current = `${window.location.pathname}${window.location.search}`;
      if (location.surface !== current) {
        // replace: applying history must not manufacture browser history
        navigateCommandSurface(location.surface, { replace: true });
      }
      if (location.tab) {
        requestTabSelect(location.tab.dir, location.tab.tabId);
      }
    },
    [navigateCommandSurface]
  );

  const navigateBack = useCallback(() => {
    const location = navHistory.back();
    if (!location) return false;
    applyLocation(location);
    return true;
  }, [applyLocation]);

  const navigateForward = useCallback(() => {
    const location = navHistory.forward();
    if (!location) return false;
    applyLocation(location);
    return true;
  }, [applyLocation]);

  const activateCommandAltitude = useCallback(
    (target: CommandAltitude) => {
      const active = resolveCommandAltitude(
        window.location.pathname,
        new URLSearchParams(window.location.search)
      );
      if (active === target) {
        const event =
          target === 'terminal'
            ? FOCUS_ACTIVE_TERMINAL_EVENT
            : target === 'sessions'
              ? FOCUS_SESSIONS_EVENT
              : RECENTER_SPATIAL_EVENT;
        window.dispatchEvent(new CustomEvent(event));
        return;
      }
      navigateCommandSurface(
        resolveSurfaceHref(COMMAND_ALTITUDE_SURFACES[target])
      );
    },
    [navigateCommandSurface]
  );

  useEffect(() => {
    if (
      !transition ||
      transition.phase === 'arriving' ||
      transition.phase === 'handoff' || // the ghost layer owns completion
      pathname !== targetPath.current
    ) {
      return;
    }
    clearScheduled();
    const reduced = prefersReducedMotion();
    const minimumTravel = reduced ? 20 : 130;
    const elapsed = performance.now() - transition.startedAt;
    timer.current = window.setTimeout(
      () => {
        setTransition(current =>
          current ? { ...current, phase: 'arriving' } : null
        );
        timer.current = window.setTimeout(
          () => {
            setTransition(null);
            targetPath.current = null;
            timer.current = null;
          },
          reduced ? 70 : 190
        );
      },
      Math.max(0, minimumTravel - elapsed)
    );
  }, [clearScheduled, pathname, transition]);

  useEffect(() => clearScheduled, [clearScheduled]);

  const value = useMemo(
    () => ({
      navigateCommandSurface,
      canNavigateBack,
      canNavigateForward,
      navigateBack,
      navigateForward,
      activateCommandAltitude,
    }),
    [
      activateCommandAltitude,
      canNavigateBack,
      canNavigateForward,
      navigateBack,
      navigateForward,
      navigateCommandSurface,
    ]
  );
  const TargetIcon =
    transition?.target === 'spatial'
      ? Orbit
      : transition?.target === 'sessions'
        ? Grid2X2
        : SquareTerminal;

  // Ends exactly the handoff it was created for: a stray late callback can
  // never clear a newer transition (the safety timer and clearScheduled own
  // the rest of the cleanup).
  const completeHandoff = useCallback((snapshot: HandoffSnapshot) => {
    setTransition(current =>
      current?.phase === 'handoff' && current.handoff === snapshot
        ? null
        : current
    );
  }, []);

  return (
    <CommandNavigationContext.Provider value={value}>
      {children}
      {transition?.phase === 'handoff' && transition.handoff && (
        <AltitudeHandoffGhosts
          snapshot={transition.handoff}
          onDone={() => completeHandoff(transition.handoff!)}
        />
      )}
      {transition && transition.phase !== 'handoff' && (
        <div
          data-command-transition={transition.phase}
          data-command-transition-target={transition.target}
          data-command-transition-direction={transition.direction}
          aria-hidden="true"
          className={`pointer-events-none fixed inset-x-0 bottom-0 top-12 z-[60] overflow-hidden transition-colors duration-[180ms] motion-reduce:duration-75 ${
            transition.phase === 'traversing'
              ? 'bg-[var(--exa-hud-fill)]'
              : 'bg-transparent'
          }`}
        >
          {/* Nested viewport frames flying past: ascending contracts them
              (world pulling away below), descending expands them (diving
              back in). Reduced motion keeps the crossfade only. */}
          {[
            { size: '46vmin', borderOpacity: 40, span: 0.1 },
            { size: '72vmin', borderOpacity: 20, span: 0.16 },
          ].map(ring => {
            const contract = transition.direction === 'ascend';
            const from = contract ? 1 + ring.span : 1 - ring.span;
            const to = contract ? 1 - ring.span : 1 + ring.span;
            const scale =
              transition.phase === 'departing'
                ? from
                : transition.phase === 'traversing'
                  ? 1
                  : to;
            return (
              <div
                key={ring.size}
                style={{
                  width: ring.size,
                  height: ring.size,
                  transform: `translate(-50%, -50%) scale(${scale})`,
                  borderColor: `color-mix(in srgb, var(--exa-foundation-action) ${ring.borderOpacity}%, transparent)`,
                }}
                className={`absolute left-1/2 top-1/2 border transition-[transform,opacity] duration-[180ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-opacity motion-reduce:duration-75 ${
                  transition.phase === 'traversing'
                    ? 'opacity-100'
                    : 'opacity-0'
                }`}
              />
            );
          })}
          <div
            className={`exa-material-overlay absolute left-1/2 top-1/2 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center border border-[var(--exa-hud-stroke)] text-[var(--exa-hud-cyan)] transition-[opacity,transform] duration-[180ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-opacity motion-reduce:duration-75 ${
              transition.phase === 'departing'
                ? `${transition.direction === 'ascend' ? 'scale-75' : 'scale-125'} opacity-0`
                : transition.phase === 'traversing'
                  ? 'scale-100 opacity-100'
                  : `${transition.direction === 'ascend' ? 'scale-110' : 'scale-90'} opacity-0`
            }`}
            style={{
              boxShadow:
                '0 0 32px color-mix(in srgb, var(--exa-hud-cyan) 12%, transparent)',
            }}
          >
            <TargetIcon className="h-4 w-4" strokeWidth={1.5} />
          </div>
        </div>
      )}
    </CommandNavigationContext.Provider>
  );
}

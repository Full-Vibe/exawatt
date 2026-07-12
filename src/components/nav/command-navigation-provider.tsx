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
import { usePathname, useRouter } from 'next/navigation';
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

type TransitionPhase = 'departing' | 'traversing' | 'arriving';

interface CommandTransition {
  phase: TransitionPhase;
  target: CommandAltitude;
  startedAt: number;
}

interface CommandNavigationContextValue {
  navigateCommandSurface: (
    href: string,
    options?: { replace?: boolean }
  ) => void;
  activateCommandAltitude: (target: CommandAltitude) => void;
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
      setTransition({
        phase: 'departing',
        target: targetAltitude ?? targetRegime,
        startedAt,
      });
      frame.current = window.requestAnimationFrame(() => {
        frame.current = null;
        setTransition({
          phase: 'traversing',
          target: targetAltitude ?? targetRegime,
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
      pathname !== targetPath.current
    ) {
      return;
    }
    clearScheduled();
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;
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
    () => ({ navigateCommandSurface, activateCommandAltitude }),
    [activateCommandAltitude, navigateCommandSurface]
  );
  const TargetIcon =
    transition?.target === 'spatial'
      ? Orbit
      : transition?.target === 'sessions'
        ? Grid2X2
        : SquareTerminal;

  return (
    <CommandNavigationContext.Provider value={value}>
      {children}
      {transition && (
        <div
          data-command-transition={transition.phase}
          data-command-transition-target={transition.target}
          aria-hidden="true"
          className={`pointer-events-none fixed inset-x-0 bottom-0 top-12 z-[60] overflow-hidden transition-colors duration-[180ms] motion-reduce:duration-75 ${
            transition.phase === 'traversing'
              ? 'bg-zinc-950/20'
              : 'bg-transparent'
          }`}
        >
          <div
            className={`absolute left-0 right-0 top-[calc(50%-22px)] h-px origin-center bg-teal-200/35 transition-[transform,opacity] duration-[180ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-opacity motion-reduce:duration-75 ${
              transition.phase === 'departing'
                ? 'scale-x-[0.15] opacity-0'
                : transition.phase === 'traversing'
                  ? 'scale-x-100 opacity-100'
                  : 'scale-x-[0.3] opacity-0'
            }`}
          />
          <div
            className={`absolute left-0 right-0 top-[calc(50%+22px)] h-px origin-center bg-teal-200/25 transition-[transform,opacity] duration-[180ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-opacity motion-reduce:duration-75 ${
              transition.phase === 'departing'
                ? 'scale-x-[0.15] opacity-0'
                : transition.phase === 'traversing'
                  ? 'scale-x-100 opacity-100'
                  : 'scale-x-[0.3] opacity-0'
            }`}
          />
          <div
            className={`absolute left-1/2 top-1/2 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center border border-teal-200/45 bg-zinc-950/90 text-teal-100 shadow-[0_0_32px_rgba(94,234,212,0.12)] transition-[opacity,transform] duration-[180ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-opacity motion-reduce:duration-75 ${
              transition.phase === 'departing'
                ? 'scale-75 opacity-0'
                : transition.phase === 'traversing'
                  ? 'scale-100 opacity-100'
                  : 'scale-110 opacity-0'
            }`}
          >
            <TargetIcon className="h-4 w-4" strokeWidth={1.5} />
          </div>
        </div>
      )}
    </CommandNavigationContext.Provider>
  );
}

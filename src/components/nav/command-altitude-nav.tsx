'use client';

import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Grid2X2, Orbit, SquareTerminal } from 'lucide-react';
import {
  altitudeShortcutId,
  resolveCommandAltitude,
  type CommandAltitude,
} from './command-altitude';
import { formatShortcutKeys, formatShortcutKeysAria } from '@/lib/shortcuts';
import { useEffectiveShortcut } from '@/components/shortcuts';
import { surfacesByTier, type AppSurface } from './surfaces';
import {
  commandSurfaceAddress,
  LAST_COMMAND_SURFACE_KEY,
  validStoredCommandSurface,
} from './command-surface-memory';
import { useCommandNavigation } from './command-navigation-provider';

let didRestoreInitialCommandSurface = false;

type SpineSurface = AppSurface & { id: CommandAltitude };

const SPINE_SURFACES = surfacesByTier('spine') as SpineSurface[];
const ALTITUDE_ICONS: Record<CommandAltitude, typeof SquareTerminal> = {
  terminal: SquareTerminal,
  sessions: Grid2X2,
  spatial: Orbit,
};

function AltitudeLevel({
  surface,
  active,
  index,
  onActivate,
}: {
  surface: SpineSurface;
  active: CommandAltitude | null;
  index: number;
  onActivate: (surface: SpineSurface) => void;
}) {
  const current = surface.id === active;
  const shortcutId = altitudeShortcutId(surface.id);
  const keys = useEffectiveShortcut(shortcutId);
  const shortcut = keys ? formatShortcutKeys(keys) : undefined;
  const ariaShortcut = keys ? formatShortcutKeysAria(keys) : undefined;
  const Icon = ALTITUDE_ICONS[surface.id];

  return (
    <div className="flex min-w-0 items-center">
      {index > 0 && (
        <span aria-hidden="true" className="h-px w-2 bg-zinc-800 sm:w-3" />
      )}
      <button
        type="button"
        data-command-altitude-level={surface.id}
        aria-current={current ? 'page' : undefined}
        aria-keyshortcuts={ariaShortcut}
        aria-label={`${surface.name}: ${surface.summary}${shortcut ? ` (${shortcut})` : ''}`}
        title={`${surface.summary}${shortcut ? ` · ${shortcut}` : ''}`}
        onClick={() => onActivate(surface)}
        className={`group flex h-8 min-w-0 items-center gap-1.5 px-2 font-mono text-chrome-label font-medium outline-none transition-[background-color,color,transform] duration-150 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-teal-300 motion-reduce:transition-none sm:px-2.5 ${
          current
            ? 'bg-zinc-800/90 text-zinc-50'
            : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 active:scale-[0.98]'
        }`}
      >
        <Icon
          aria-hidden="true"
          className={`h-3.5 w-3.5 shrink-0 ${
            current ? 'text-teal-200' : 'text-zinc-600'
          }`}
        />
        <span data-command-altitude-label className="hidden sm:inline">
          {surface.name}
        </span>
        {shortcut && (
          <kbd
            aria-hidden="true"
            className={`hidden border px-1 text-chrome-micro font-normal lg:inline ${
              current
                ? 'border-zinc-600 text-zinc-300'
                : 'border-zinc-700 text-zinc-500 group-hover:text-zinc-300'
            }`}
          >
            {shortcut}
          </kbd>
        )}
      </button>
    </div>
  );
}

export function CommandAltitudeNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { activateCommandAltitude } = useCommandNavigation();
  // null on non-spine surfaces (settings, legacy views): the rail still
  // renders — every level stays one click away — with no current level marked
  const active = resolveCommandAltitude(pathname, searchParams);

  useEffect(() => {
    if (!window.electron?.isElectron) return;
    const current = commandSurfaceAddress(
      pathname,
      new URLSearchParams(searchParams.toString())
    );
    if (!current) return;

    if (!didRestoreInitialCommandSurface) {
      didRestoreInitialCommandSurface = true;
      const stored = validStoredCommandSurface(
        window.localStorage.getItem(LAST_COMMAND_SURFACE_KEY)
      );
      if (current === '/workspace' && stored && stored !== current) {
        router.replace(stored);
        return;
      }
    }
    window.localStorage.setItem(LAST_COMMAND_SURFACE_KEY, current);
  }, [pathname, router, searchParams]);

  return (
    <nav
      data-command-altitude
      aria-label="Command altitude"
      className="mx-3 flex min-w-0 items-center border border-zinc-800/90 bg-zinc-950/70 p-0.5 shadow-[0_8px_24px_rgba(0,0,0,0.22)]"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {SPINE_SURFACES.map((surface, index) => (
        <AltitudeLevel
          key={surface.id}
          surface={surface}
          active={active}
          index={index}
          onActivate={target => activateCommandAltitude(target.id)}
        />
      ))}
    </nav>
  );
}

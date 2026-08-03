'use client';

import { useEffect, useRef } from 'react';
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
  validStoredCommandSurfaceForWorkspace,
} from './command-surface-memory';
import { useCommandNavigation } from './command-navigation-provider';
import { useOptionalWorkspaceTenancy } from '@/lib/tenancy/tenancy-provider';
import {
  PERSONAL_WORKSPACE,
  workspaceScopedStorageKey,
} from '@/lib/tenancy/workspace-scope';

let didRestoreInitialCommandSurface = false;

/** TEST ONLY: the boot restore is one-shot per renderer process. */
export function resetInitialCommandSurfaceRestoreForTests() {
  didRestoreInitialCommandSurface = false;
}

type SpineSurface = AppSurface & { id: CommandAltitude };

const SPINE_SURFACES = surfacesByTier('spine') as SpineSurface[];
/** Canonical icon per command altitude — reuse anywhere a spine surface is
 *  represented outside the rail (e.g. the web header's Agent link). */
export const ALTITUDE_ICONS: Record<CommandAltitude, typeof SquareTerminal> = {
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
        <span
          aria-hidden="true"
          className="h-px w-2 bg-[var(--exa-foundation-border)] sm:w-3"
        />
      )}
      <button
        type="button"
        data-command-altitude-level={surface.id}
        aria-current={current ? 'page' : undefined}
        aria-keyshortcuts={ariaShortcut}
        aria-label={`${surface.name}: ${surface.summary}${shortcut ? ` (${shortcut})` : ''}`}
        title={`${surface.summary}${shortcut ? ` · ${shortcut}` : ''}`}
        onClick={() => onActivate(surface)}
        className={`group flex h-8 min-w-0 items-center gap-1.5 px-2 font-mono text-chrome-label font-medium outline-none transition-[background-color,color,transform] duration-150 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--exa-foundation-focus)] motion-reduce:transition-none sm:px-2.5 ${
          current
            ? 'bg-[var(--exa-foundation-secondary)] text-[var(--exa-foundation-secondary-text)]'
            : 'text-[var(--exa-foundation-text-muted)] hover:bg-[var(--exa-foundation-secondary)] hover:text-[var(--exa-foundation-text)] active:scale-[0.98]'
        }`}
      >
        <Icon
          aria-hidden="true"
          className={`h-3.5 w-3.5 shrink-0 ${
            current
              ? 'text-[var(--exa-foundation-action)]'
              : 'text-[var(--exa-foundation-text-faint)]'
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
                ? 'border-[var(--exa-foundation-border-strong)] text-[var(--exa-foundation-text-muted)]'
                : 'border-[var(--exa-foundation-border)] text-[var(--exa-foundation-text-faint)] group-hover:text-[var(--exa-foundation-text-muted)]'
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
  // the surface memory is Workspace-scoped view state (ENG-027 W1): each
  // tenant remembers its own last command surface. Personal keeps the legacy
  // unscoped key so pre-tenancy operator memory survives.
  const tenancy = useOptionalWorkspaceTenancy();
  const activeWorkspace = tenancy?.activeWorkspace ?? PERSONAL_WORKSPACE;
  // no provider means no persisted tenant to wait for
  const tenancyHydrated = tenancy?.hydrated ?? true;
  const surfaceMemoryKey = workspaceScopedStorageKey(
    activeWorkspace.id,
    LAST_COMMAND_SURFACE_KEY
  );
  // which tenant key the currently recorded address was recorded under —
  // lets the effect tell "navigation landed" apart from "tenant changed"
  const lastRecordedRef = useRef<{ key: string; address: string } | null>(
    null
  );

  useEffect(() => {
    // Boot fence (ENG-027): child effects run before the provider's mount
    // effect, so until the persisted tenant is resolved this effect would
    // read/write PERSONAL's key and consume the one-shot restore against the
    // wrong tenant. Wait for hydration; the restore then runs exactly once
    // against the correct tenant's memory.
    if (!tenancyHydrated) return;
    if (!window.electron?.isElectron) return;
    const current = commandSurfaceAddress(
      pathname,
      new URLSearchParams(searchParams.toString())
    );
    if (!current) return;

    if (!didRestoreInitialCommandSurface) {
      didRestoreInitialCommandSurface = true;
      const stored = validStoredCommandSurfaceForWorkspace(
        window.localStorage.getItem(surfaceMemoryKey),
        activeWorkspace
      );
      if (current === '/workspace' && stored && stored !== current) {
        router.replace(stored);
        return;
      }
    }

    const last = lastRecordedRef.current;
    if (last && last.address === current && last.key !== surfaceMemoryKey) {
      // Workspace switch in flight: the tenant key changed while the address
      // did not, so `current` is still the PREVIOUS tenant's surface. Do not
      // write it under the new tenant's key; record again once navigation
      // lands (pathname/search change) or the operator moves.
      lastRecordedRef.current = { key: surfaceMemoryKey, address: current };
      return;
    }
    window.localStorage.setItem(surfaceMemoryKey, current);
    lastRecordedRef.current = { key: surfaceMemoryKey, address: current };
  }, [
    activeWorkspace,
    pathname,
    router,
    searchParams,
    surfaceMemoryKey,
    tenancyHydrated,
  ]);

  return (
    <nav
      data-command-altitude
      aria-label="Command altitude"
      className="exa-material-chrome mx-3 flex min-w-0 items-center border border-[var(--exa-foundation-border)] p-0.5 shadow-lg"
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

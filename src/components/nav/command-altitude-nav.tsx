'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Grid2X2, Orbit, SquareTerminal } from 'lucide-react';
import {
  COMMAND_ALTITUDE_HREFS,
  resolveCommandAltitude,
  type CommandAltitude,
} from './command-altitude';
import { spatialReturnHref } from './spatial-return';
import { FOCUS_ACTIVE_TERMINAL_EVENT } from '@/components/workspace/session-jump';
import {
  FOCUS_SESSIONS_EVENT,
  RECENTER_SPATIAL_EVENT,
} from './command-altitude-events';

const LEVELS: Array<{
  id: CommandAltitude;
  label: string;
  detail: string;
  shortcut?: string;
  icon: typeof SquareTerminal;
}> = [
  {
    id: 'terminal',
    label: 'Terminal',
    detail: 'Focus one live session',
    icon: SquareTerminal,
  },
  {
    id: 'sessions',
    label: 'Sessions',
    detail: 'Overview of live sessions',
    shortcut: '⌘O',
    icon: Grid2X2,
  },
  {
    id: 'spatial',
    label: 'Spatial',
    detail: 'Fleet command field',
    shortcut: '⌘⇧M',
    icon: Orbit,
  },
];

export function CommandAltitudeNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  // null on non-spine surfaces (settings, legacy views): the rail still
  // renders — every level stays one click away — with no current level marked
  const active = resolveCommandAltitude(pathname, searchParams);

  return (
    <nav
      data-command-altitude
      aria-label="Command altitude"
      className="mx-3 flex min-w-0 items-center border border-zinc-800/90 bg-zinc-950/70 p-0.5 shadow-[0_8px_24px_rgba(0,0,0,0.22)]"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {LEVELS.map(({ id, label, detail, shortcut, icon: Icon }, index) => {
        const current = id === active;
        return (
          <div key={id} className="flex min-w-0 items-center">
            {index > 0 && (
              <span
                aria-hidden="true"
                className="h-px w-2 bg-zinc-800 sm:w-3"
              />
            )}
            <button
              type="button"
              data-command-altitude-level={id}
              aria-current={current ? 'page' : undefined}
              aria-keyshortcuts={
                id === 'sessions'
                  ? 'Meta+O'
                  : id === 'spatial'
                    ? 'Meta+Shift+M'
                    : undefined
              }
              aria-label={`${label}: ${detail}${shortcut ? ` (${shortcut})` : ''}`}
              title={`${detail}${shortcut ? ` · ${shortcut}` : ''}`}
              onClick={() => {
                if (current) {
                  const event =
                    id === 'terminal'
                      ? FOCUS_ACTIVE_TERMINAL_EVENT
                      : id === 'sessions'
                        ? FOCUS_SESSIONS_EVENT
                        : RECENTER_SPATIAL_EVENT;
                  window.dispatchEvent(new CustomEvent(event));
                  return;
                }
                router.push(
                  id === 'spatial'
                    ? spatialReturnHref()
                    : COMMAND_ALTITUDE_HREFS[id]
                );
              }}
              className={`group flex h-7 min-w-0 items-center gap-1.5 px-2 font-mono text-[10px] outline-none transition-[background-color,color,transform] duration-150 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-teal-300 motion-reduce:transition-none sm:px-2.5 ${
                current
                  ? 'bg-zinc-800/90 text-zinc-50'
                  : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200 active:scale-[0.98]'
              }`}
            >
              <Icon
                aria-hidden="true"
                className={`h-3.5 w-3.5 shrink-0 ${
                  current ? 'text-teal-200' : 'text-zinc-600'
                }`}
              />
              <span className="hidden sm:inline">{label}</span>
              {shortcut && (
                <kbd
                  aria-hidden="true"
                  className={`hidden border px-1 text-[9px] leading-4 lg:inline ${
                    current
                      ? 'border-zinc-600 text-zinc-300'
                      : 'border-zinc-800 text-zinc-600 group-hover:text-zinc-400'
                  }`}
                >
                  {shortcut}
                </kbd>
              )}
            </button>
          </div>
        );
      })}
    </nav>
  );
}

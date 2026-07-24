'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  LayoutDashboard,
  LayoutGrid,
  User,
  LogOut,
  Network,
  Settings,
  Server,
  SquareTerminal,
  Blocks,
  MessageSquareWarning,
  type LucideIcon,
} from 'lucide-react';
import { signOut } from '@/app/actions/projects';
import { isAdminEmail } from '@/lib/auth/admin';
import { CommandAltitudeNav } from './command-altitude-nav';
import { isAppRoute, surfacesByTier, type AppSurface } from './surfaces';
import { useOptionalProductFeedback } from '@/components/feedback/product-feedback-provider';

const LEGACY_ICONS: Partial<Record<AppSurface['id'], LucideIcon>> = {
  dashboard: LayoutDashboard,
  board: LayoutGrid,
  fleet: Server,
};

interface SiteHeaderNavProps {
  isAuthenticated: boolean;
  userName?: string;
  userEmail?: string;
}

export function SiteHeaderNav({
  isAuthenticated,
  userName,
  userEmail,
}: SiteHeaderNavProps) {
  const pathname = usePathname();
  const isHome = pathname === '/';
  const isArchitecture = pathname?.startsWith('/architecture');
  const isComponentLibrary = pathname?.startsWith('/hud-gallery');
  const isWorkspace = pathname?.startsWith('/workspace');
  const isAdmin = isAdminEmail(userEmail);
  const feedback = useOptionalProductFeedback();
  // in the desktop app the Workspace (terminal) link is always relevant,
  // signed in or not; detected post-mount for hydration safety
  const [inElectron, setInElectron] = useState(false);
  useEffect(() => setInElectron(!!window.electron?.isElectron), []);

  return (
    <header
      id="site-header"
      className="sticky top-0 z-40 flex h-12 items-center justify-between border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 md:px-6"
      // desktop app: hiddenInset title bar — clear the macOS traffic lights
      // and let the header double as the window drag strip
      style={
        inElectron
          ? ({
              paddingLeft: 84,
              WebkitAppRegion: 'drag',
            } as React.CSSProperties)
          : undefined
      }
    >
      {/* Left: Logo → Home */}
      {isHome ? (
        <span
          data-chrome-brand
          className="inline-flex h-8 items-center gap-2 rounded-md px-3 text-chrome-title! font-semibold"
        >
          <Image
            src="/icon.png"
            alt=""
            width={16}
            height={16}
            className="h-4 w-4"
          />
          Exawatt
        </span>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          asChild
          style={
            inElectron
              ? ({ WebkitAppRegion: 'no-drag' } as React.CSSProperties)
              : undefined
          }
        >
          <Link
            href="/"
            data-chrome-brand
            className="gap-2 text-chrome-title! font-semibold"
          >
            <Image
              src="/icon.png"
              alt=""
              width={16}
              height={16}
              className="h-4 w-4"
            />
            Exawatt
          </Link>
        </Button>
      )}

      {/* the navigation spine: present on every desktop surface so the way
          back to Terminal is never hunted for (ENG-016 D8) */}
      {inElectron && <CommandAltitudeNav />}

      {/* Right: Auth-dependent links */}
      <div
        className="flex items-center gap-1"
        style={
          inElectron
            ? ({ WebkitAppRegion: 'no-drag' } as React.CSSProperties)
            : undefined
        }
      >
        {!isArchitecture && (
          <Button variant="ghost" size="sm" asChild>
            <Link href="/architecture" className="text-chrome-title!">
              <Network className="h-3.5 w-3.5" />
              Architecture
            </Link>
          </Button>
        )}
        {isAdmin && !isComponentLibrary && (
          <Button variant="ghost" size="sm" asChild>
            <Link href="/hud-gallery">
              <Blocks className="h-3.5 w-3.5" />
              Components
            </Link>
          </Button>
        )}
        {/* authenticated web app surfaces only — in Electron the altitude
            rail owns this destination */}
        {!inElectron &&
          isAuthenticated &&
          isAppRoute(pathname) &&
          !isWorkspace && (
            <Button variant="ghost" size="sm" asChild>
              <Link href="/workspace">
                <SquareTerminal className="h-3.5 w-3.5" />
                Workspace
              </Link>
            </Button>
          )}
        {!isAuthenticated && isAppRoute(pathname) && (
          <Button variant="ghost" size="sm" asChild>
            <Link href="/sign-in">Sign In</Link>
          </Button>
        )}
        {isAuthenticated && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                  <User className="h-4 w-4" />
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {(userName || userEmail) && (
                <>
                  <DropdownMenuLabel>
                    {userName && <div className="font-medium">{userName}</div>}
                    {userEmail && (
                      <div className="text-xs text-muted-foreground truncate">
                        {userEmail}
                      </div>
                    )}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem asChild>
                <Link href="/settings">
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => feedback?.openFeedback()}>
                <MessageSquareWarning className="mr-2 h-4 w-4" />
                Submit feedback
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Legacy views
              </DropdownMenuLabel>
              {surfacesByTier('legacy').map(s => {
                const Icon = LEGACY_ICONS[s.id] ?? Server;
                return (
                  <DropdownMenuItem key={s.id} asChild>
                    <Link href={s.href}>
                      <Icon className="mr-2 h-4 w-4" />
                      {s.name}
                    </Link>
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={async () => {
                  await signOut();
                }}
              >
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}

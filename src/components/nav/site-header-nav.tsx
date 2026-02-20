'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LayoutDashboard, User, LogOut, Settings } from 'lucide-react';
import { signOut } from '@/app/actions/projects';

interface SiteHeaderNavProps {
  isAuthenticated: boolean;
  userName?: string;
  userEmail?: string;
}

export function SiteHeaderNav({ isAuthenticated, userName, userEmail }: SiteHeaderNavProps) {
  const pathname = usePathname();
  const isHome = pathname === '/';
  const isDashboard = pathname === '/dashboard';

  return (
    <header
      id="site-header"
      className="sticky top-0 z-40 flex h-12 items-center justify-between border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 md:px-6"
    >
      {/* Left: Logo → Home */}
      {isHome ? (
        <span className="inline-flex items-center gap-2 rounded-md px-3 text-xs font-semibold h-8">
          <Image src="/icon.png" alt="" width={16} height={16} className="h-4 w-4" />
          Exawatt
        </span>
      ) : (
        <Button variant="ghost" size="sm" asChild>
          <Link href="/" className="gap-2 font-semibold">
            <Image src="/icon.png" alt="" width={16} height={16} className="h-4 w-4" />
            Exawatt
          </Link>
        </Button>
      )}

      {/* Right: Auth-dependent links */}
      <div className="flex items-center gap-1">
        {isAuthenticated && !isHome && !isDashboard && (
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard">
              <LayoutDashboard className="h-3.5 w-3.5" />
              Lattice
            </Link>
          </Button>
        )}
        {!isAuthenticated && !isHome && (
          <Button variant="ghost" size="sm" asChild>
            <Link href="/sign-in">Sign In</Link>
          </Button>
        )}
        {isAuthenticated && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
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

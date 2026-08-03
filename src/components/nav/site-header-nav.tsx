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
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  Laptop,
  MonitorPlay,
  User,
  LogOut,
  Network,
  Trophy,
  Settings,
  Blocks,
  MessageSquareWarning,
  type LucideIcon,
} from 'lucide-react';
import { signOut } from '@/app/actions/projects';
import { isAdminEmail } from '@/lib/auth/admin';
import { ALTITUDE_ICONS, CommandAltitudeNav } from './command-altitude-nav';
import { APP_SURFACES, isAppRoute } from './surfaces';
import {
  AMBIENT_CHROME_METER_ENABLED,
  AmbientChromeMeter,
} from '@/components/consumption/meter/ambient-meter-chrome';
import { useOptionalProductFeedback } from '@/components/feedback/product-feedback-provider';
import { ComingSoonMarker } from '@/components/readiness';
import { useOptionalWorkspaceTenancy } from '@/lib/tenancy/tenancy-provider';
import type { TenantWorkspaceKind } from '@/lib/tenancy/workspace-scope';
import { useCommandNavigation } from './command-navigation-provider';

const WORKSPACE_KIND_ICONS: Record<TenantWorkspaceKind, LucideIcon> = {
  personal: Laptop,
  demo: MonitorPlay,
  organization: Building2,
};

// the Agent altitude as the manifest names it — the web header's link must
// carry the same label and icon as every other consumer (decision 0023)
const AGENT_SURFACE = APP_SURFACES.find(surface => surface.id === 'terminal')!;
const AgentSurfaceIcon = ALTITUDE_ICONS.terminal;

function WorkspaceIdentityChip({
  workspace,
}: {
  workspace: { id: string; name: string; kind: TenantWorkspaceKind };
}) {
  const KindIcon = WORKSPACE_KIND_ICONS[workspace.kind];
  return (
    <span
      data-active-tenant-workspace={workspace.id}
      className="mr-1 inline-flex h-6 items-center gap-1.5 border border-[var(--exa-hud-stroke-soft)] bg-[var(--exa-hud-fill)] px-2 font-mono text-chrome-meta font-medium text-[var(--exa-hud-cyan)]"
    >
      <KindIcon aria-hidden="true" className="h-3 w-3" />
      {workspace.name}
    </span>
  );
}

/** D27's app-location history, exposed in the title bar through the same
 * owner as ⌘[/⌘]. The controls are deliberately quiet chrome: familiar
 * chevrons, no new color channel, and truthful disabled state. */
function HeaderHistoryControls() {
  const { canNavigateBack, canNavigateForward, navigateBack, navigateForward } =
    useCommandNavigation();

  return (
    <nav
      aria-label="Navigation history"
      className="ml-1 inline-flex items-center gap-0.5"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        data-navigation-back
        aria-label="Back"
        title="Back · ⌘["
        disabled={!canNavigateBack}
        onClick={navigateBack}
        className="h-7 w-7 text-muted-foreground disabled:opacity-25"
      >
        <ChevronLeft aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        data-navigation-forward
        aria-label="Forward"
        title="Forward · ⌘]"
        disabled={!canNavigateForward}
        onClick={navigateForward}
        className="h-7 w-7 text-muted-foreground disabled:opacity-25"
      >
        <ChevronRight aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
      </Button>
    </nav>
  );
}

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
  const isAgentmaxxing =
    pathname?.startsWith('/agentmaxxing') ||
    pathname?.startsWith('/operator/') ||
    pathname?.startsWith('/run/');
  const isComponentLibrary = pathname?.startsWith('/hud-gallery');
  const isWorkspace = pathname?.startsWith('/workspace');
  const isAdmin = isAdminEmail(userEmail);
  const feedback = useOptionalProductFeedback();
  const tenancy = useOptionalWorkspaceTenancy();
  const activeWorkspace = tenancy?.activeWorkspace;
  // in the desktop app the Workspace (terminal) link is always relevant,
  // signed in or not; detected post-mount for hydration safety
  const [inElectron, setInElectron] = useState(false);
  useEffect(() => setInElectron(!!window.electron?.isElectron), []);

  return (
    <header
      id="site-header"
      className="exa-material-chrome sticky top-0 z-40 flex h-12 items-center justify-between border-b px-4 md:px-6"
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
      {/* Left: Logo → Home, then the visible twin of ⌘[/⌘]. */}
      <div className="flex items-center gap-0.5">
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
        {inElectron && <HeaderHistoryControls />}
      </div>

      {/* the navigation spine: present on every desktop surface so the way
          back to the Agent altitude is never hunted for (ENG-016 D8) */}
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
        {/* ambient consumption meter (ENG-008): the always-on plan-window
            glance and /usage's first-class chrome entry — glyph,
            hover popover, click-through. App surfaces only; the flag is
            the whole mount. */}
        {AMBIENT_CHROME_METER_ENABLED &&
          (inElectron || isAppRoute(pathname)) && <AmbientChromeMeter />}
        {/* non-personal tenancy identity is ALWAYS visible (ENG-027): demo
            data must never be mistaken for Personal truth */}
        {activeWorkspace && activeWorkspace.kind !== 'personal' && (
          <WorkspaceIdentityChip workspace={activeWorkspace} />
        )}
        {!isArchitecture && (
          <Button variant="ghost" size="sm" asChild>
            <Link href="/architecture" className="text-chrome-title!">
              <Network className="h-3.5 w-3.5" />
              Architecture
            </Link>
          </Button>
        )}
        {!isAgentmaxxing && (
          <Button variant="ghost" size="sm" asChild>
            <Link href="/agentmaxxing" className="text-chrome-title!">
              <Trophy className="h-3.5 w-3.5" />
              Agentmaxxing
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
              <Link href={AGENT_SURFACE.href}>
                <AgentSurfaceIcon className="h-3.5 w-3.5" />
                {AGENT_SURFACE.name}
              </Link>
            </Button>
          )}
        {!isAuthenticated && isAppRoute(pathname) && (
          <Button variant="ghost" size="sm" asChild>
            <Link href="/sign-in">Sign In</Link>
          </Button>
        )}
        {/* the account menu is the tenancy seam (ENG-027): in the desktop app
            it renders signed in or not, because the Workspace switcher must
            always be reachable */}
        {(isAuthenticated || inElectron) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                data-account-menu-trigger
                aria-label="Account and Workspace menu"
                className="h-8 w-8 rounded-full"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                  <User className="h-4 w-4" />
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
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
              {tenancy && (
                <>
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    Workspace
                  </DropdownMenuLabel>
                  {tenancy.workspaces.map(workspace => {
                    const Icon = WORKSPACE_KIND_ICONS[workspace.kind];
                    const isActive =
                      workspace.id === tenancy.activeWorkspace.id;
                    const comingSoon = workspace.availability === 'coming-soon';
                    const preview = workspace.availability === 'preview';
                    const content = (
                      <>
                        <Icon className="mr-2 h-4 w-4" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate">{workspace.name}</span>
                          {workspace.tagline && (
                            <span className="truncate text-chrome-meta text-muted-foreground">
                              {workspace.tagline}
                            </span>
                          )}
                        </span>
                        {isActive && (
                          <Check className="ml-2 h-4 w-4 shrink-0 text-primary" />
                        )}
                        {(comingSoon || preview) && (
                          <ComingSoonMarker className="ml-2" />
                        )}
                      </>
                    );
                    if (preview) {
                      return (
                        <DropdownMenuItem
                          key={workspace.id}
                          asChild
                          data-workspace-preview={workspace.id}
                          data-organization-anchor={
                            workspace.kind === 'organization' || undefined
                          }
                        >
                          <Link href={workspace.href!}>{content}</Link>
                        </DropdownMenuItem>
                      );
                    }
                    return (
                      <DropdownMenuItem
                        key={workspace.id}
                        data-workspace-switch={workspace.id}
                        disabled={comingSoon}
                        onSelect={() => tenancy.switchWorkspace(workspace.id)}
                      >
                        {content}
                      </DropdownMenuItem>
                    );
                  })}
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
              {isAuthenticated && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={async () => {
                      await signOut();
                    }}
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign out
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}

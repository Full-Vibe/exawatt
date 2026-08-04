import type { Metadata } from 'next';
import { Exo_2, Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ShortcutProvider } from '@/components/shortcuts';
import { SiteHeader } from '@/components/nav/site-header';
import { SiteFooter } from '@/components/nav/site-footer';
import { FleetProvider } from '@/lib/fleet/fleet-provider';
import { UpdateReadyNotice } from '@/components/nav/update-ready-notice';
import { CommandNavigationProvider } from '@/components/nav/command-navigation-provider';
import { ProductFeedbackProvider } from '@/components/feedback/product-feedback-provider';
import { WorkspaceTenancyProvider } from '@/lib/tenancy/tenancy-provider';
import { AppearanceProvider } from '@/components/appearance/appearance-provider';
import { GoalVisualPreferenceProvider } from '@/components/goal-visuals/goal-visual-preference-provider';
import { APPEARANCE_BOOTSTRAP_SCRIPT } from '@/lib/appearance/bootstrap-script';

const exo2 = Exo_2({
  variable: '--font-exo2',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

// Clean technical grotesk for the HUD display + UI type — replaces the
// "space-font" Orbitron/Rajdhani for a professional, utilitarian read.
const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  // per-surface titles (ENG-016 D9): segment layouts set a plain title and
  // this template suffixes the app name, so the window switcher, ⌘Tab, and
  // history can tell surfaces apart
  title: { default: 'Exawatt', template: '%s — Exawatt' },
  description: 'Power your AI agents',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${exo2.variable} ${geistMono.variable} ${geistSans.variable}`}
      data-exa-theme="exawatt-classic-dark"
      data-exa-appearance="dark"
      data-exa-contrast="standard"
      data-exa-transparency="standard"
      data-exa-font="theme"
      data-exa-typography="classic"
      style={{
        background: 'var(--background)',
        color: 'var(--foreground)',
      }}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOTSTRAP_SCRIPT }}
        />
      </head>
      <body className="font-sans antialiased">
        <AppearanceProvider>
          <GoalVisualPreferenceProvider>
            <TooltipProvider>
              <CommandNavigationProvider>
                {/* Workspace tenancy (ENG-027 W1) scopes everything below it —
                  the header switcher and every surface read the active tenant */}
                <WorkspaceTenancyProvider>
                  {/* Feedback sits above ShortcutProvider so the ⌘K palette can
                  read auth state for its quick-feedback verbs (ENG-025 F1) */}
                  <ProductFeedbackProvider>
                    <ShortcutProvider>
                      <FleetProvider>
                        <SiteHeader />
                        <UpdateReadyNotice />
                        {children}
                      </FleetProvider>
                    </ShortcutProvider>
                  </ProductFeedbackProvider>
                </WorkspaceTenancyProvider>
              </CommandNavigationProvider>
            </TooltipProvider>
            <SiteFooter />
          </GoalVisualPreferenceProvider>
        </AppearanceProvider>
      </body>
    </html>
  );
}

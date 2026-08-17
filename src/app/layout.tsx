import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ShortcutProvider } from '@/components/shortcuts';
import { SiteHeader } from '@/components/nav/site-header';
import { SiteFooter } from '@/components/nav/site-footer';
import { FleetProvider } from '@/lib/fleet/fleet-provider';
import { UpdateReadyNotice } from '@/components/nav/update-ready-notice';
import { AccountFirstRunCard } from '@/components/auth/account-first-run-card';
import { CommandNavigationProvider } from '@/components/nav/command-navigation-provider';
import { ProductFeedbackProvider } from '@/components/feedback/product-feedback-provider';
import { WorkspaceTenancyProvider } from '@/lib/tenancy/tenancy-provider';
import { AppearanceProvider } from '@/components/appearance/appearance-provider';
import { GoalVisualPreferenceProvider } from '@/components/goal-visuals/goal-visual-preference-provider';
import { APPEARANCE_BOOTSTRAP_SCRIPT } from '@/lib/appearance/bootstrap-script';
import { resolvedDistribution } from '@/lib/distribution/resolved';
import { resolveDistributionIdentity } from '@exawatt/core/distribution';

const exo2 = localFont({
  src: './fonts/Exo2-Variable-Latin.woff2',
  variable: '--font-exo2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
});

const geistMono = localFont({
  src: './fonts/GeistMono-Variable-Latin.woff2',
  variable: '--font-geist-mono',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
});

// Clean technical grotesk for the HUD display + UI type — replaces the
// "space-font" Orbitron/Rajdhani for a professional, utilitarian read.
const geistSans = localFont({
  src: './fonts/Geist-Variable-Latin.woff2',
  variable: '--font-geist-sans',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
});

const distributionIdentity = resolveDistributionIdentity(
  resolvedDistribution()
);

export const metadata: Metadata = {
  // per-surface titles (ENG-016 D9): segment layouts set a plain title and
  // this template suffixes the app name, so the window switcher, ⌘Tab, and
  // history can tell surfaces apart
  title: {
    default: distributionIdentity.productName,
    template: `%s — ${distributionIdentity.productName}`,
  },
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
                        {/* one-time, dismissible, never a gate (ENG-030
                          OS0.1); it gates itself on signed-out app surfaces */}
                        <AccountFirstRunCard />
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

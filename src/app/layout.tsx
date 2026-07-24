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
import { SystemAccent } from '@/components/nav/system-accent';
import { ProductFeedbackProvider } from '@/components/feedback/product-feedback-provider';

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
    // Exawatt is a dark-branded HUD product: force dark so shadcn surfaces
    // (⌘K palette, dialogs) never render light on a light-mode OS while the
    // HUD chrome around them is hardcoded dark
    <html lang="en" className="dark">
      <body
        className={`${exo2.variable} ${geistMono.variable} ${geistSans.variable} font-sans antialiased`}
      >
        <TooltipProvider>
          <SystemAccent />
          <CommandNavigationProvider>
            <ShortcutProvider>
              <FleetProvider>
                <ProductFeedbackProvider>
                  <SiteHeader />
                  <UpdateReadyNotice />
                  {children}
                </ProductFeedbackProvider>
              </FleetProvider>
            </ShortcutProvider>
          </CommandNavigationProvider>
        </TooltipProvider>
        <SiteFooter />
      </body>
    </html>
  );
}

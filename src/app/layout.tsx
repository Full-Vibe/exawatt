import type { Metadata } from 'next';
import { Exo_2, Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ShortcutProvider } from '@/components/shortcuts';
import { SiteHeader } from '@/components/nav/site-header';
import { SiteFooter } from '@/components/nav/site-footer';
import { FleetProvider } from '@/lib/fleet/fleet-provider';

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
  title: 'Exawatt',
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
          <ShortcutProvider>
            <FleetProvider>
              <SiteHeader />
              {children}
            </FleetProvider>
          </ShortcutProvider>
        </TooltipProvider>
        <SiteFooter />
      </body>
    </html>
  );
}

import type { Metadata } from 'next';
import { Exo_2, Geist, Geist_Mono } from 'next/font/google';
import Link from 'next/link';
import './globals.css';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ShortcutProvider } from '@/components/shortcuts';
import { SiteHeader } from '@/components/nav/site-header';
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
    <html lang="en">
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
        <footer
          id="site-footer"
          className="border-t py-6 text-center text-xs text-muted-foreground"
        >
          <div className="flex items-center justify-center gap-4">
            <Link
              href="/privacy"
              className="hover:text-foreground transition-colors"
            >
              Privacy Policy
            </Link>
            <Link
              href="/terms"
              className="hover:text-foreground transition-colors"
            >
              Terms of Service
            </Link>
          </div>
        </footer>
      </body>
    </html>
  );
}

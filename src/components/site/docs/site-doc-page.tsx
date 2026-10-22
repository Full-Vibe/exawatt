import type { ReactNode } from 'react';

/**
 * The frame every written page on the site shares (ENG-031): the changelog
 * and the guides. Dark like the homepage, under its nav and download button,
 * on the fixed exhibition ground rather than the app's appearance, so a
 * visitor in light mode reads the same page (`globals.css` paints the
 * document behind it for overscroll).
 */
export function SiteDocPage({ children }: { children: ReactNode }) {
  return (
    <main
      className="min-h-screen bg-[var(--exa-public-exhibition-canvas)] font-ui text-white"
      data-public-exhibition-surface="true"
      data-site-document
    >
      <div className="mx-auto max-w-5xl px-4 pb-24 pt-14 sm:px-6 md:pt-20">
        {children}
      </div>
    </main>
  );
}

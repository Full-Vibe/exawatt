import { HomeHero } from './_home-hero';

export default function Home() {
  return (
    <>
      <style>{`
        #site-header,
        #site-footer,
        [data-home-hero] {
          --exa-interface-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          --font-ui: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          --font-display: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
        #site-header {
          background: rgba(255, 255, 255, 0.05) !important;
          border-color: rgba(255, 255, 255, 0.1) !important;
          color: white !important;
          -webkit-backdrop-filter: blur(24px) !important;
          backdrop-filter: blur(24px) !important;
        }
        #site-header button,
        #site-header a {
          color: white !important;
        }
        #site-header .bg-muted {
          background: rgba(255, 255, 255, 0.15) !important;
        }
        #site-footer {
          background: rgb(10, 10, 12);
          border-color: rgba(255, 255, 255, 0.1);
          color: rgba(255, 255, 255, 0.5);
        }
        #site-footer a {
          color: rgba(255, 255, 255, 0.5);
        }
        #site-footer a:hover {
          color: white;
        }
        @media (max-height: 520px) {
          .home-hero-content {
            gap: 1rem;
          }
          .home-hero-title {
            font-size: 2.25rem;
            line-height: 2.5rem;
          }
          .home-hero-copy {
            font-size: 0.875rem;
            line-height: 1.4;
          }
        }
      `}</style>
      <HomeHero />
    </>
  );
}

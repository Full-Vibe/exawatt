import { HomeHero } from './_home-hero';

export default function Home() {
  return (
    <>
      <style>{`
        [data-home-hero] {
          --exa-interface-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          --font-ui: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          --font-display: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
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

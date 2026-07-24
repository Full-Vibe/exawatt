import { ArchitectureKeySwitchLink } from '@/components/hud/webgl/keyswitch-study';
import { HeroBg } from './_hero-bg';

export default function Home() {
  return (
    <>
      <style>{`
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
      <div
        className="relative -mt-12 flex min-h-screen items-center justify-center bg-black pt-12"
        data-home-hero
      >
        <HeroBg />
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/50 to-black/80" />
        <main
          className="home-hero-content relative z-10 flex flex-col items-center gap-8 px-4 text-center"
          data-home-hero-content
        >
          <h1
            className="home-hero-title text-4xl font-bold tracking-tight text-white drop-shadow-lg sm:text-6xl"
            data-home-hero-title
          >
            Exawatt
          </h1>
          <p className="home-hero-copy w-full max-w-3xl text-xs leading-relaxed text-white/80 drop-shadow-md sm:text-lg">
            <span className="block">The economy is refactoring.</span>
            <span className="block">
              Exawatt is the command interface for billions of agents.
            </span>
          </p>
          <ArchitectureKeySwitchLink />
        </main>
      </div>
    </>
  );
}

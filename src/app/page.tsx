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
      `}</style>
      <div className="relative -mt-12 flex min-h-screen items-center justify-center bg-black">
        <HeroBg />
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/50 to-black/80" />
        <main className="relative z-10 flex flex-col items-center gap-8 text-center px-4">
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-6xl drop-shadow-lg">
            Exawatt
          </h1>
          <p className="w-full max-w-3xl text-xs leading-relaxed text-white/80 drop-shadow-md sm:text-lg">
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

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/server';
import { HeroBg } from './_hero-bg';

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
        <p className="max-w-md text-lg text-white/80 drop-shadow-md">
          Mission control for your AI agents. Monitor, manage, and unblock your fleet of autonomous workers.
        </p>
        <div className="flex gap-4">
          {user ? (
            <Button asChild>
              <Link href="/dashboard">Go to Lattice</Link>
            </Button>
          ) : (
            <>
              <Button asChild>
                <Link href="/sign-in">Sign In</Link>
              </Button>
              <Button asChild variant="outline" className="border-white/30 text-white hover:bg-white/10">
                <Link href="/sign-up">Sign Up</Link>
              </Button>
            </>
          )}
        </div>
      </main>
      </div>
    </>
  );
}

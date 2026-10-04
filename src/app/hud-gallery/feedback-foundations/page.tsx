import Link from 'next/link';
import { FeedbackRecoveryStudy } from './study';

export default function FeedbackRecoveryPage() {
  return (
    <main className="min-h-screen bg-background px-4 py-6 font-ui text-foreground sm:px-6 sm:py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-chrome-micro uppercase tracking-widest text-muted-foreground">
              HUD gallery / Feedback
            </p>
            <h1 className="mt-2 text-surface-title font-semibold">
              Feedback
            </h1>
          </div>
          <Link
            href="/hud-gallery"
            className="text-chrome-label underline underline-offset-4"
          >
            HUD gallery
          </Link>
        </header>
        <FeedbackRecoveryStudy />
      </div>
    </main>
  );
}

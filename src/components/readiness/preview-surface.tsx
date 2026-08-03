/**
 * The shell every `preview` vision surface renders (ENG-026 N1; body contract
 * amended by N3–N5).
 *
 * A preview surface is not a mockup: it is the real page at its real route,
 * marked honestly, whose body is the designed shape of what the surface will
 * show (N3–N5 landed those bodies) and whose readiness flips `live` in the
 * manifest when the capability ships. This shell is the page frame — name,
 * the one Coming soon marker, the intent, the honest "today" footer — so
 * nothing in the spine ever links into a broken state and no page repeats
 * the disclaimer the marker already carries.
 *
 * Copy stays minimal by canon: the design carries the explanation, not
 * pasted prose. Representative data appears only under the marker and is
 * never presented as the operator's own.
 *
 * Design kernel citations: `font-ui` root on semantic chrome tokens, h1
 * `text-surface-title font-semibold`, lede `text-reading`, metadata
 * `text-chrome-meta`, sections `space-y-6`, gutter `px-8`.
 */
import type { ReactNode } from 'react';
import { SurfaceReadinessMarker } from './readiness';
import { surfaceById, type AppSurface } from '@/components/nav/surfaces';

export function PreviewSurfaceShell({
  surfaceId,
  /** The recurring user question this surface exists to answer, if one does. */
  question,
  /** One or two sentences of intent. */
  intent,
  /** What ships this, e.g. "ENG-033 · cloud-hosted agents". */
  owner,
  /** The honest one-liner about today, stated plainly. */
  today,
  /** `reading` (760px) for prose-shaped pages; `wide` (1040px) for boards. */
  width = 'reading',
  children,
}: {
  surfaceId: AppSurface['id'];
  question?: string;
  intent: string;
  owner: string;
  today: string;
  width?: 'reading' | 'wide';
  children: ReactNode;
}) {
  const surface = surfaceById(surfaceId);
  return (
    <main className="min-h-svh bg-background font-ui text-foreground">
      <div
        className={`mx-auto w-full space-y-6 px-8 py-16 ${
          width === 'wide' ? 'max-w-[1040px]' : 'max-w-[760px]'
        }`}
      >
        <header className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-surface-title font-semibold tracking-tight">
              {surface.name}
            </h1>
            <SurfaceReadinessMarker surfaceId={surfaceId} />
          </div>
          <p className="max-w-[60ch] text-reading text-muted-foreground">
            {surface.summary}. {intent}
          </p>
          {question && (
            <p className="max-w-[60ch] border-l-2 border-border pl-3 text-sm text-muted-foreground">
              Asked by users: &ldquo;{question}&rdquo;
            </p>
          )}
        </header>

        {children}

        <footer className="space-y-1.5">
          <p className="text-chrome-meta text-muted-foreground">
            Today: {today}
          </p>
          <p className="text-chrome-meta text-muted-foreground">
            This is the designed shape of {surface.name}, not a shipped
            capability. It goes live with {owner}.
          </p>
        </footer>
      </div>
    </main>
  );
}

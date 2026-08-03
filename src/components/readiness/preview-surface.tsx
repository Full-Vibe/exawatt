/**
 * The shell every `preview` vision surface renders (ENG-026 N1; body contract
 * amended by N3–N5; production voice by ENG-036).
 *
 * A preview surface is not a mockup: it is the real page at its real route,
 * marked honestly, whose body is the designed shape of what the surface will
 * show, and whose readiness flips `live` in the manifest when the capability
 * ships. The shell is deliberately thin — name, summary, the one Coming soon
 * marker (naming its owner), and a one-line footer stating today's state.
 *
 * Voice rule (design-system.md, Voice): the body demonstrates with
 * product-shaped UI — labels, values, states, marked representative data.
 * No thesis sentences, no quoted user questions, no explanation of what the
 * surface is or why it exists. The readiness grammar carries the honesty.
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
  /** What ships this, named on the marker — e.g. "ENG-033". */
  owner,
  /** One factual line about today's state, rendered as footer metadata. */
  today,
  /** `reading` (760px) for prose-shaped pages; `wide` (1040px) for boards. */
  width = 'reading',
  children,
}: {
  surfaceId: AppSurface['id'];
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
            <SurfaceReadinessMarker surfaceId={surfaceId} owner={owner} />
          </div>
          <p className="max-w-[60ch] text-reading text-muted-foreground">
            {surface.summary}
          </p>
        </header>

        {children}

        <footer>
          <p className="text-chrome-meta text-muted-foreground">{today}</p>
        </footer>
      </div>
    </main>
  );
}

/**
 * The shell every `preview` vision surface renders (ENG-026 N1).
 *
 * A preview surface is not a mockup: it is the real page at its real route,
 * marked honestly, whose body grows as its owning roadmap item lands content
 * (N3–N5) and whose readiness flips `live` in the manifest when the
 * capability ships. This shell is the page frame — name, the one Coming soon
 * marker, the intent, and the designed shape of what the surface will show —
 * so nothing in the spine ever links into a broken state.
 *
 * Copy stays minimal by canon: the design carries the explanation, not
 * pasted prose. No fabricated numbers appear here — a shell states shape,
 * never data.
 *
 * Design kernel citations: `font-ui` root on semantic chrome tokens, h1
 * `text-surface-title font-semibold`, lede `text-reading`, operational card
 * `rounded-lg border border-border p-4`, metadata `text-chrome-meta`,
 * sections `space-y-6`, gutter `px-8`.
 */
import { SurfaceReadinessMarker } from './readiness';
import { surfaceById, type AppSurface } from '@/components/nav/surfaces';

export interface PreviewSurfaceRow {
  /** What the surface will show, named as the thing itself. */
  title: string;
  /** One clause of operational meaning. */
  detail: string;
}

export function PreviewSurfaceShell({
  surfaceId,
  /** The recurring user question this surface exists to answer, if one does. */
  question,
  /** One or two sentences of intent. */
  intent,
  rows,
  /** What ships this, e.g. "ENG-033 · cloud-hosted agents". */
  owner,
  /** The honest one-liner about today, stated plainly. */
  today,
}: {
  surfaceId: AppSurface['id'];
  question?: string;
  intent: string;
  rows: PreviewSurfaceRow[];
  owner: string;
  today: string;
}) {
  const surface = surfaceById(surfaceId);
  return (
    <main className="min-h-svh bg-background font-ui text-foreground">
      <div className="mx-auto w-full max-w-[760px] space-y-6 px-8 py-16">
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

        <section
          aria-label={`What ${surface.name} will show`}
          className="rounded-lg border border-border bg-card p-4"
        >
          <ul className="divide-y divide-border">
            {rows.map(row => (
              <li key={row.title} className="flex flex-col gap-0.5 py-3 first:pt-1 last:pb-1">
                <span className="text-sm font-medium">{row.title}</span>
                <span className="text-chrome-meta text-muted-foreground">
                  {row.detail}
                </span>
              </li>
            ))}
          </ul>
        </section>

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

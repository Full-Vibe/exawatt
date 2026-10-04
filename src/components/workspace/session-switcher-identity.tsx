import type { SessionRow } from './switcher-rows';
import { HARNESS_META } from './harnesses';

/** One readable purpose line; source and scope remain secondary and searchable. */
export function SessionSwitcherIdentity({
  session,
}: {
  session: Pick<
    SessionRow,
    'title' | 'subtitle' | 'harness' | 'projectName' | 'roadmapItemId'
  >;
}) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate text-sm" title={session.title}>
        {session.title}
      </span>
      <span className="truncate text-chrome-label text-muted-foreground">
        {session.projectName} · {HARNESS_META[session.harness].label}
        {session.roadmapItemId ? ` · ${session.roadmapItemId}` : ''}
        {session.subtitle ? ` · ${session.subtitle}` : ''}
      </span>
    </span>
  );
}

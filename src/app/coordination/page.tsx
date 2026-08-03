import type { Metadata } from 'next';
import { Eye, FileText, RadioTower } from 'lucide-react';
import { PreviewSurfaceShell } from '@/components/readiness';
import {
  demoCoordinationBoard,
  HANDOFF_SPECIMEN,
  LADDER,
  SUBSTRATE,
} from './model';

// Preview surface (ENG-026 N4 / ENG-029 C1). noindex for the same stealth
// reason as /consumption: reachable by URL for demos, not discoverable.
export const metadata: Metadata = {
  title: 'Coordination',
  robots: { index: false, follow: false },
};

const SUBSTRATE_ICONS = {
  blackboard: FileText,
  bus: RadioTower,
  viewer: Eye,
} as const;

function relative(minutes: number): string {
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

export default function CoordinationPage() {
  const board = demoCoordinationBoard();

  return (
    <PreviewSurfaceShell
      surfaceId="coordination"
      width="wide"
      owner="ENG-029"
      today="Today Agents coordinate through worktrees, the roadmap, and git. The board shown is Voltaic demo content."
    >
      {/* The substrate: blackboard, bus, audit. */}
      <section
        aria-label="Coordination substrate"
        className="grid gap-3 sm:grid-cols-3"
      >
        {SUBSTRATE.map(part => {
          const Icon = SUBSTRATE_ICONS[part.id];
          return (
            <div
              key={part.id}
              className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-center gap-2">
                <Icon
                  aria-hidden
                  className="h-3.5 w-3.5 text-muted-foreground"
                />
                <span className="text-sm font-semibold">{part.title}</span>
              </div>
              <p className="text-chrome-meta leading-4 text-muted-foreground">
                {part.detail}
              </p>
              <p className="mt-auto pt-1 font-mono text-chrome-micro text-muted-foreground">
                {part.meta}
              </p>
            </div>
          );
        })}
      </section>

      {/* One Project's board — real lens truth over demo data. */}
      <section aria-label="Assignments" className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">Assignments</h2>
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
            <span
              aria-hidden
              className="h-3.5 w-[3px] shrink-0 rounded-full"
              style={{ background: board.project.color }}
            />
            <span className="text-sm font-semibold">{board.project.name}</span>
            <span className="font-mono text-chrome-micro tabular-nums text-muted-foreground">
              {board.rows.length} Agents on roadmap items
            </span>
          </div>
          <table className="w-full min-w-[560px] text-left">
            <thead>
              <tr className="border-b border-border">
                {['Agent', 'Working', 'Link', 'Last activity'].map(
                  heading => (
                    <th
                      key={heading}
                      scope="col"
                      className="px-4 py-2 font-mono text-chrome-micro font-medium uppercase tracking-[0.12em] text-muted-foreground"
                    >
                      {heading}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {board.rows.map(row => (
                <tr key={row.agent.id}>
                  <td className="px-4 py-2.5 text-sm">{row.agent.name}</td>
                  <td className="px-4 py-2.5 font-mono text-chrome-label text-muted-foreground">
                    {row.itemId}
                  </td>
                  <td className="px-4 py-2.5 text-chrome-meta text-muted-foreground">
                    {row.how}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-chrome-label tabular-nums text-muted-foreground">
                    {relative(row.minutesSinceActivity)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-chrome-meta text-muted-foreground">
          Declared links outrank inferred ones.
        </p>
      </section>

      {/* The levels: least chatty first, later levels gated. */}
      <section aria-label="Coordination levels" className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">
          Coordination levels
        </h2>
        <div className="rounded-lg border border-border bg-card px-4">
          <ol className="divide-y divide-border">
            {LADDER.map(rung => (
              <li key={rung.name} className="flex gap-4 py-3">
                <span className="w-5 shrink-0 pt-0.5 font-mono text-chrome-label tabular-nums text-muted-foreground">
                  {rung.rung}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <span className="text-sm font-medium">{rung.name}</span>
                    <span className="font-mono text-chrome-micro text-muted-foreground">
                      {rung.state}
                    </span>
                  </div>
                  <p className="mt-0.5 text-chrome-meta leading-4 text-muted-foreground">
                    {rung.detail}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Handoff record specimen — ENG-019's crystallization as a repo file. */}
      <section aria-label="Handoff record" className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">Handoff record</h2>
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-2.5 font-mono text-chrome-label text-muted-foreground">
            {HANDOFF_SPECIMEN.path}
          </div>
          <div className="space-y-3 px-4 py-3 font-mono text-chrome-label leading-5">
            {HANDOFF_SPECIMEN.sections.map(section => (
              <div key={section.heading}>
                <p className="text-muted-foreground"># {section.heading}</p>
                {section.lines.map(line => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            ))}
          </div>
        </div>
        <p className="text-chrome-meta text-muted-foreground">
          Written by the departing Agent on graceful quit; read by the next
          Agent before starting.
        </p>
      </section>
    </PreviewSurfaceShell>
  );
}

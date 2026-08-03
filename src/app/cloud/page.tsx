import type { Metadata } from 'next';
import { ArrowRight, CloudUpload } from 'lucide-react';
import {
  AnnouncedChip,
  PreviewSurfaceShell,
  READINESS_NEUTRAL,
} from '@/components/readiness';
import { withAlpha } from '@/components/hud/tokens';
import { HarnessGlyph } from '@/components/workspace/harness-icons';
import { demoCloudHero } from './model';

// Preview surface (ENG-026 N3, previewing ENG-033). noindex for the same
// stealth reason as /consumption: reachable by URL for demos, not
// discoverable.
export const metadata: Metadata = {
  title: 'Cloud',
  robots: { index: false, follow: false },
};

function HeroCard({
  where,
  detail,
  hosted = false,
}: {
  where: string;
  detail: string;
  hosted?: boolean;
}) {
  const { agent, project } = demoCloudHero();
  return (
    <div
      className={`flex w-full min-w-0 flex-col gap-2 rounded-lg bg-card p-4 sm:max-w-[320px] ${
        hosted ? '' : 'border border-border'
      }`}
      style={
        // The hosted card is the drawing of the thing, not the thing: it
        // carries the readiness family's dashed stroke (design kernel —
        // dashes mean designed, not built). The local card is solid truth.
        hosted
          ? { border: `1px dashed ${withAlpha(READINESS_NEUTRAL, 0.55)}` }
          : undefined
      }
      data-readiness={hosted ? 'announced' : undefined}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="h-3.5 w-[3px] shrink-0 rounded-full"
          style={{ background: project.color }}
        />
        <span className="truncate text-sm font-medium">{agent.name}</span>
      </div>
      <div className="flex items-center gap-2 font-mono text-chrome-micro text-muted-foreground">
        <HarnessGlyph harness="claude" size={10} />
        <span>
          {agent.model}
          {agent.effort ? ` · ${agent.effort} effort` : ''}
        </span>
      </div>
      <div className="mt-1 border-t border-border pt-2">
        <span
          className="block font-mono text-chrome-micro"
          style={hosted ? { color: READINESS_NEUTRAL } : undefined}
        >
          {where}
        </span>
        <span className="mt-0.5 block text-chrome-meta text-muted-foreground">
          {detail}
        </span>
      </div>
    </div>
  );
}

const ROWS = [
  {
    title: 'Hosted beside local',
    detail:
      'Cloud Agents appear in the same Team and Fleet views as local ones, source and assurance visibly different, never blended.',
  },
  {
    title: 'Any source',
    detail:
      'Hosted OpenClaw first, but the seam is the Agent Source boundary — the harness is an engine choice, not the product boundary.',
  },
  {
    title: 'Plan-aware capacity',
    detail:
      'Hosted plan windows join the Consumption capacity view with reported assurance, the same way Codex plan windows do today.',
  },
] as const;

export default function CloudPage() {
  return (
    <PreviewSurfaceShell
      surfaceId="cloud"
      width="wide"
      intent="Push an Agent to an Exawatt-hosted plan with one action, and keep commanding it from the same tab."
      owner="ENG-033 · cloud-hosted agents"
      today="Every Agent runs locally. The Push to cloud control sits in each Agent tab's menu — marked and inert. The Session shown is Voltaic demo content."
    >
      {/* The one action, before and after. */}
      <section
        aria-label="Push to cloud, before and after"
        className="rounded-lg border border-border bg-card/50 p-4"
      >
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center">
          <HeroCard
            where="Local · this machine"
            detail="Stops when the laptop lid closes."
          />
          <div className="flex shrink-0 flex-col items-center gap-1.5 self-center px-1">
            <AnnouncedChip coming="one-click hosted agents (ENG-033)">
              <CloudUpload aria-hidden className="h-3.5 w-3.5" />
              Push to cloud
            </AnnouncedChip>
            <ArrowRight
              aria-hidden
              className="hidden h-3.5 w-3.5 text-muted-foreground sm:block"
            />
          </div>
          <HeroCard
            hosted
            where="Exawatt-hosted plan"
            detail="Keeps running when your machine does not."
          />
        </div>
        <p className="mt-3 text-chrome-meta text-muted-foreground">
          Session identity, Project, and context carry across the push.
          Nothing else changes — same tab, same command surfaces.
        </p>
      </section>

      {/* What hosted means, in three facts. */}
      <section
        aria-label="What Cloud will show"
        className="rounded-lg border border-border bg-card p-4"
      >
        <ul className="divide-y divide-border">
          {ROWS.map(row => (
            <li
              key={row.title}
              className="flex flex-col gap-0.5 py-3 first:pt-1 last:pb-1"
            >
              <span className="text-sm font-medium">{row.title}</span>
              <span className="text-chrome-meta text-muted-foreground">
                {row.detail}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </PreviewSurfaceShell>
  );
}

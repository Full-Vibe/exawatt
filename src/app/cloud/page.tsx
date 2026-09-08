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
// stealth reason as /usage: reachable by URL for demos, not
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
    title: 'Existing fleet control',
    detail:
      'Customer-hosted Agents use the same Agent, Team, and Fleet surfaces as local ones.',
  },
  {
    title: 'Managed placement',
    detail: 'Not active. Provisioning and paid plans are not implemented.',
  },
  {
    title: 'Move or clone',
    detail:
      'Not active. A future transfer manifest must state exactly what moves.',
  },
] as const;

export default function CloudPage() {
  return (
    <PreviewSurfaceShell
      surfaceId="cloud"
      width="wide"
      owner="ENG-033"
      today="Connect to Agents on servers you run. Managed placement, transfer, and billing are not active. The Session shown is Voltaic demo content."
    >
      {/* A future placement specimen; neither side is an active transition. */}
      <section
        aria-label="Future managed placement concept"
        className="rounded-lg border border-border bg-card/50 p-4"
      >
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center">
          <HeroCard
            where="Local · this machine"
            detail="Runs while this machine is awake."
          />
          <div className="flex shrink-0 flex-col items-center gap-1.5 self-center px-1">
            <AnnouncedChip coming="managed placement and explicit transfer (ENG-033 H3/H4)">
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
            where="Managed placement"
            detail="Provisioning is not active."
          />
        </div>
        <p className="mt-3 text-chrome-meta text-muted-foreground">
          Session, Project, identity, and tab continuity are not promised.
        </p>
      </section>

      {/* Hosted capabilities, as feature rows. */}
      <section
        aria-label="Cloud capabilities"
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

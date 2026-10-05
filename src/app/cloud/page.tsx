import type { Metadata } from 'next';
import { ArrowRight, CloudUpload } from 'lucide-react';
import {
  AnnouncedChip,
  PreviewSurfaceShell,
  READINESS_NEUTRAL,
} from '@/components/readiness';
import { withAlpha } from '@/components/hud/tokens';
import { HarnessGlyph } from '@/components/workspace/harness-icons';
import {
  CLOUD_DESTINATIONS,
  demoCloudHero,
  type CloudDestination,
} from './model';

// Preview surface (ENG-026 N3, previewing ENG-033). noindex for the same
// stealth reason as /usage: reachable by URL for demos, not
// discoverable.
export const metadata: Metadata = {
  title: 'Cloud',
  robots: { index: false, follow: false },
};

/** The local card is solid truth: the Agent as it runs today. */
function LocalCard() {
  const { agent, project } = demoCloudHero();
  return (
    <div className="flex w-full min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-4 sm:max-w-[300px]">
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
        <span className="block font-mono text-chrome-micro">
          Local · this machine
        </span>
        <span className="mt-0.5 block text-chrome-meta text-muted-foreground">
          Runs while this machine is awake.
        </span>
      </div>
    </div>
  );
}

/**
 * A destination card is the drawing of the thing, not the thing: it carries
 * the readiness family's dashed stroke (design kernel: dashes mean designed,
 * not built) and its state word, and nothing on it operates.
 */
function DestinationCard({ destination }: { destination: CloudDestination }) {
  return (
    <div
      className="flex w-full min-w-0 flex-col gap-1.5 rounded-lg bg-card p-4"
      style={{ border: `1px dashed ${withAlpha(READINESS_NEUTRAL, 0.55)}` }}
      data-readiness="announced"
      data-cloud-destination={destination.id}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span
          className="font-mono text-chrome-micro"
          style={{ color: READINESS_NEUTRAL }}
        >
          {destination.name}
        </span>
        <span className="shrink-0 font-mono text-chrome-micro text-muted-foreground">
          {destination.state}
        </span>
      </div>
      <span className="text-chrome-meta text-muted-foreground">
        {destination.runs}
      </span>
      <span className="text-chrome-meta text-muted-foreground">
        {destination.then}
      </span>
      {destination.reference && (
        <span className="mt-0.5 font-mono text-chrome-micro text-muted-foreground">
          {destination.reference}
        </span>
      )}
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
      {/* A future placement specimen; no side of it is an active transition. */}
      <section
        aria-label="Future managed placement concept"
        className="rounded-lg border border-border bg-card/50 p-4"
      >
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center">
          <LocalCard />
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
          <ul
            aria-label="Destinations"
            className="flex w-full flex-col gap-3 sm:max-w-[400px]"
          >
            {CLOUD_DESTINATIONS.map(destination => (
              <li key={destination.id}>
                <DestinationCard destination={destination} />
              </li>
            ))}
          </ul>
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

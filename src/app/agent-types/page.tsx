import type { Metadata } from 'next';
import { Shapes } from 'lucide-react';
import { PreviewSurfaceShell } from '@/components/readiness';
import { HarnessGlyph } from '@/components/workspace/harness-icons';
import { demoAgentTypeRoster, type AgentTypeProfile } from './model';

// Preview surface (ENG-026 N5 / ENG-028 T1). noindex for the same stealth
// reason as /consumption: reachable by URL for demos, not discoverable.
export const metadata: Metadata = {
  title: 'Agent Types',
  robots: { index: false, follow: false },
};

const SOURCE_LABEL = { 'claude-code': 'Claude Code', codex: 'Codex' } as const;
const SOURCE_GLYPH = { 'claude-code': 'claude', codex: 'codex' } as const;

function EngineChip({ source }: { source: 'claude-code' | 'codex' }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded border border-border px-1.5 py-0.5 font-mono text-chrome-micro text-muted-foreground">
      <HarnessGlyph harness={SOURCE_GLYPH[source]} size={10} />
      {SOURCE_LABEL[source]}
    </span>
  );
}

function SpecRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 py-3 first:pt-2 last:pb-2 sm:flex-row sm:gap-4">
      <span className="w-28 shrink-0 pt-0.5 font-mono text-chrome-micro uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <div className="min-w-0 flex-1 text-sm">{children}</div>
    </div>
  );
}

function TypeCard({ profile }: { profile: AgentTypeProfile }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <Shapes aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-sm font-semibold">{profile.name}</span>
        {profile.capability === 'preview' && (
          <span className="ml-auto font-mono text-chrome-micro text-muted-foreground">
            preview desk
          </span>
        )}
      </div>
      <p className="text-chrome-meta leading-4 text-muted-foreground">
        {profile.identity}
      </p>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <span className="font-mono text-chrome-micro tabular-nums text-muted-foreground">
          {profile.projects.length}{' '}
          {profile.projects.length === 1 ? 'Project' : 'Projects'} ·{' '}
          {profile.agents.length}{' '}
          {profile.agents.length === 1 ? 'Agent' : 'Agents'}
        </span>
        <span className="ml-auto inline-flex items-center gap-1">
          {profile.sources.map(source => (
            <EngineChip key={source} source={source} />
          ))}
        </span>
      </div>
    </div>
  );
}

export default function AgentTypesPage() {
  const roster = demoAgentTypeRoster();
  const engineer = roster.find(profile => profile.name === 'Engineer')!;

  return (
    <PreviewSurfaceShell
      surfaceId="agent-types"
      width="wide"
      owner="ENG-028"
      today="No Type is stored or reused yet. The roster shown is Voltaic demo content."
    >
      {/* The claim, shown not told: one worker, two engines. */}
      <section
        aria-label="One worker, interchangeable engines"
        className="rounded-lg border border-border bg-card p-4"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="inline-flex items-center gap-2 text-base font-semibold">
            <Shapes aria-hidden className="h-4 w-4 text-muted-foreground" />
            {engineer.name}
          </span>
          <span className="text-sm text-muted-foreground">running on</span>
          <span className="inline-flex items-center gap-1.5">
            {engineer.sources.map(source => (
              <EngineChip key={source} source={source} />
            ))}
          </span>
        </div>
        <p className="mt-2 max-w-[64ch] text-chrome-meta text-muted-foreground">
          A Type declares the tools it requires; a launch on an under-capable
          source shows what is missing.
        </p>
      </section>

      {/* Inside a Type: the portable bundle, as a spec sheet. */}
      <section aria-label="Inside a Type" className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">Inside a Type</h2>
        <div className="rounded-lg border border-border bg-card px-4 py-2">
          <div className="divide-y divide-border">
            <SpecRow label="Identity">
              <span className="text-muted-foreground">
                &ldquo;{engineer.identity}&rdquo;
              </span>
            </SpecRow>
            <SpecRow label="Instructions">
              <ul className="space-y-1 text-muted-foreground">
                {engineer.responsibilities.map(line => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </SpecRow>
            <SpecRow label="Tools">
              <span className="flex flex-wrap gap-1.5">
                {engineer.tools.map(tool => (
                  <span
                    key={tool}
                    className="rounded border border-border px-1.5 py-0.5 font-mono text-chrome-micro text-muted-foreground"
                  >
                    {tool}
                  </span>
                ))}
              </span>
            </SpecRow>
            <SpecRow label="Defaults">
              {engineer.defaults ? (
                <span className="font-mono text-chrome-label text-muted-foreground">
                  {engineer.defaults.model} · {engineer.defaults.effort} effort
                </span>
              ) : null}
            </SpecRow>
          </div>
        </div>
        <p className="text-chrome-meta text-muted-foreground">
          Applied at launch, merged with your own config — never mutating it.
        </p>
      </section>

      {/* The library: Voltaic's authored roster, counts from fixture truth. */}
      <section aria-label="Voltaic's Type library" className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">
          Voltaic&rsquo;s library
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {roster.map(profile => (
            <TypeCard key={profile.name} profile={profile} />
          ))}
        </div>
      </section>
    </PreviewSurfaceShell>
  );
}

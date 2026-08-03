import type { Metadata } from 'next';
import { Building2, Laptop, MonitorPlay, Share2 } from 'lucide-react';
import { AnnouncedChip, PreviewSurfaceShell, Unbuilt } from '@/components/readiness';
import { DEMO_WORKSPACE } from '@exawatt/core';
import { demoOrgMembers, ORG_ROLES, type OrgRole } from './model';

// Preview surface (ENG-026 N3). noindex for the same stealth reason as
// /usage: reachable by URL for demos, not discoverable.
export const metadata: Metadata = {
  title: 'Organization',
  robots: { index: false, follow: false },
};

function formatTokens(raw: number): string {
  if (raw >= 1_000_000_000)
    return `${(raw / 1_000_000_000).toFixed(1)}B tokens`;
  return `${Math.round(raw / 1_000_000)}M tokens`;
}

function RoleChip({ role }: { role: OrgRole }) {
  return (
    <span
      title={ORG_ROLES[role]}
      className="rounded border border-border px-1.5 py-0.5 font-mono text-chrome-micro text-muted-foreground"
    >
      {role}
    </span>
  );
}

export default function OrganizationPage() {
  const members = demoOrgMembers();

  return (
    <PreviewSurfaceShell
      surfaceId="organization"
      width="wide"
      owner="ENG-012 · ENG-034"
      today="Workspace switching is live on this machine. Sharing is not; the members shown are Voltaic demo content."
    >
      {/* Workspaces: the real tenancy seam, plus the designed shared tenant. */}
      <section aria-label="Workspaces" className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">Workspaces</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <Laptop aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-sm font-semibold">Personal</span>
            </div>
            <p className="text-chrome-meta text-muted-foreground">
              This machine only. Not shared.
            </p>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <MonitorPlay
                aria-hidden
                className="h-3.5 w-3.5 text-muted-foreground"
              />
              <span className="text-sm font-semibold">
                {DEMO_WORKSPACE.name}
              </span>
            </div>
            <p className="text-chrome-meta text-muted-foreground">
              Demo content. Kept separate from Personal totals.
            </p>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <Building2
                aria-hidden
                className="h-3.5 w-3.5 text-muted-foreground"
              />
              <span className="text-sm font-semibold">
                {DEMO_WORKSPACE.company}
              </span>
              <AnnouncedChip
                size="micro"
                coming="shared Organization Workspaces (ENG-012)"
                className="ml-auto"
              >
                Shared
              </AnnouncedChip>
            </div>
            <p className="text-chrome-meta text-muted-foreground">
              {members.length} members · one fleet · visibility by role.
            </p>
          </div>
        </div>
      </section>

      {/* Members, roles, and spend cut by person. */}
      <section aria-label="Members and roles" className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">
          Members and roles
        </h2>
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[620px] text-left">
            <thead>
              <tr className="border-b border-border">
                {['Member', 'Role', 'Commands', 'Usage · raw tokens'].map(
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
              {members.map(member => (
                <tr key={member.name}>
                  <td className="px-4 py-2.5">
                    <span className="flex flex-col">
                      <span className="text-sm font-medium">{member.name}</span>
                      <span className="text-chrome-meta text-muted-foreground">
                        {member.title}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <RoleChip role={member.role} />
                  </td>
                  <td className="px-4 py-2.5 text-chrome-meta text-muted-foreground">
                    {member.projectKeys.length}{' '}
                    {member.projectKeys.length === 1 ? 'Project' : 'Projects'} ·{' '}
                    {member.sessionCount} Sessions
                  </td>
                  <td className="px-4 py-2.5 font-mono text-chrome-label tabular-nums text-muted-foreground">
                    {formatTokens(member.rawTokens)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-chrome-meta text-muted-foreground">
          Usage is raw tokens across each member&rsquo;s Sessions, delegated
          runs included. Not a bill.
        </p>
      </section>

      {/* Sharing and ceilings: announced control + designed policy region. */}
      <section aria-label="Sharing and ceilings" className="space-y-5">
        <h2 className="text-lg font-semibold tracking-tight">
          Sharing and ceilings
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <AnnouncedChip coming="Workspace sharing (ENG-034)">
            <Share2 aria-hidden className="h-3.5 w-3.5" />
            Share Workspace
          </AnnouncedChip>
          <span className="text-chrome-meta text-muted-foreground">
            Sharing grants visibility only. Shared members cannot run your
            local Agents.
          </span>
        </div>
        <Unbuilt
          owner="ENG-012 · managed ceilings"
          note="Applies to every member. Personal limits can be lower, never higher."
        >
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-sm">Organization ceiling</span>
            <span className="h-2 w-48 rounded-[2px] bg-muted" />
            <span className="rounded border border-border px-3 py-1.5 text-chrome-label text-muted-foreground">
              Apply
            </span>
          </div>
        </Unbuilt>
      </section>
    </PreviewSurfaceShell>
  );
}

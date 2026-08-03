import type { Metadata } from 'next';
import { PreviewSurfaceShell } from '@/components/readiness';

// Preview surface (ENG-026 N1). noindex for the same stealth reason as
// /consumption: reachable by URL for demos, not discoverable.
export const metadata: Metadata = {
  title: 'Organization',
  robots: { index: false, follow: false },
};

export default function OrganizationPage() {
  return (
    <PreviewSurfaceShell
      surfaceId="organization"
      question="What does multiplayer look like in Exawatt?"
      intent="Exawatt's tenancy scope is the Workspace; Organization is where people, permissions, and spend meet it."
      rows={[
        {
          title: 'Members and roles',
          detail:
            'Who is in the Organization, and what each person can see and command — Docs-like permissions over Workspaces, not repo ACLs.',
        },
        {
          title: 'Shared Workspaces',
          detail:
            'A Workspace shared with teammates keeps every live local Session exactly where it is; sharing changes visibility, never execution.',
        },
        {
          title: 'Spend by person and team',
          detail:
            'The same consumption rollups you have today, cut by member — raw units first, assurance stated, never a fabricated bill.',
        },
        {
          title: 'Managed ceilings',
          detail:
            'Organization policy as an absolute ceiling that personal preferences can narrow but never bypass.',
        },
      ]}
      owner="ENG-012 and ENG-034 · hosted control plane, multiplayer and sharing"
      today="Workspace tenancy is real and switchable on this machine (ENG-027); nothing is shared beyond it."
    />
  );
}

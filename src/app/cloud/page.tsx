import type { Metadata } from 'next';
import { PreviewSurfaceShell } from '@/components/readiness';

// Preview surface (ENG-026 N1). noindex for the same stealth reason as
// /consumption: reachable by URL for demos, not discoverable.
export const metadata: Metadata = {
  title: 'Cloud',
  robots: { index: false, follow: false },
};

export default function CloudPage() {
  return (
    <PreviewSurfaceShell
      surfaceId="cloud"
      intent="Push an Agent to an Exawatt-hosted plan with one action, keep commanding it from the same tab."
      rows={[
        {
          title: 'Push to cloud',
          detail:
            'A running local Agent moves to a hosted runtime without losing its Session identity, Project, or context.',
        },
        {
          title: 'Hosted beside local',
          detail:
            'Cloud Agents appear in the same Team and Fleet views as local ones, with their source and assurance visibly different, never blended.',
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
      ]}
      owner="ENG-033 · cloud-hosted agents"
      today="Every Agent runs locally; the Push to cloud affordance appears where it will live, marked and inert."
    />
  );
}

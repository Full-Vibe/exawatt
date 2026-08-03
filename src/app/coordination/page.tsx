import type { Metadata } from 'next';
import { PreviewSurfaceShell } from '@/components/readiness';

// Preview surface (ENG-026 N1). noindex for the same stealth reason as
// /consumption: reachable by URL for demos, not discoverable.
export const metadata: Metadata = {
  title: 'Coordination',
  robots: { index: false, follow: false },
};

export default function CoordinationPage() {
  return (
    <PreviewSurfaceShell
      surfaceId="coordination"
      question="How do you think about handoff between agents?"
      intent="The repo is the blackboard and the harness event channel is the bus; coordination is auditable state, not chat between agents."
      rows={[
        {
          title: 'Shared Project context',
          detail:
            "What every Agent on a Project can see: the roadmap, claims on work in flight, and the durable decisions that bound them.",
        },
        {
          title: 'Claims before work',
          detail:
            'An Agent states what it is taking before it takes it, so two Agents cannot silently land on the same file.',
        },
        {
          title: 'Handoff records',
          detail:
            'On graceful quit an Agent writes a versioned per-Session handoff — what it did, what is unfinished, what the next Agent must know (ENG-019).',
        },
        {
          title: 'The honest current answer',
          detail:
            'Handoff today is the operator. This surface exists to replace that sentence with a record you can open.',
        },
      ]}
      owner="ENG-029 · project blackboard and agent bus"
      today="Agents coordinate through worktrees, the roadmap, and the operator; no shared blackboard surface exists yet."
    />
  );
}

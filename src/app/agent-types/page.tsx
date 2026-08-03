import type { Metadata } from 'next';
import { PreviewSurfaceShell } from '@/components/readiness';

// Preview surface (ENG-026 N1). noindex for the same stealth reason as
// /consumption: reachable by URL for demos, not discoverable.
export const metadata: Metadata = {
  title: 'Agent Types',
  robots: { index: false, follow: false },
};

export default function AgentTypesPage() {
  return (
    <PreviewSurfaceShell
      surfaceId="agent-types"
      intent="The Type — identity, instructions, tools, defaults — is the worker; the harness is only the engine it runs on."
      rows={[
        {
          title: 'A portable worker identity',
          detail:
            'One Type launches on Claude Code today and Codex tomorrow without losing what it is or how it works.',
        },
        {
          title: 'Types on every Agent',
          detail:
            'Tabs and Team cards carry a Type chip, so the product says what kind of worker this is, not only which harness runs it.',
        },
        {
          title: 'A library, not a config file',
          detail:
            'Reviewer, researcher, designer, release engineer — Types you refine and reuse, with defaults that travel.',
        },
        {
          title: 'Typed review gates',
          detail:
            'A Designer Type as the automated reviewer on UI changes is the first planned consumer (ENG-036 G3).',
        },
      ]}
      owner="ENG-028 · agent types"
      today="Agents are launched per-harness with per-launch instructions; no Type is stored or reused yet."
    />
  );
}

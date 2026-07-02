import type { Metadata } from 'next';
import { WorkspaceClient } from '@/components/workspace/workspace-client';

export const metadata: Metadata = {
  title: 'Workspace — Exawatt',
  description: 'Agent terminal workspace',
};

export default function WorkspacePage() {
  return (
    <div className="h-[calc(100svh-3rem)] overflow-hidden">
      <WorkspaceClient />
    </div>
  );
}

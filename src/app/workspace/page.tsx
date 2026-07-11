import type { Metadata } from 'next';
import { Suspense } from 'react';
import { WorkspaceClient } from '@/components/workspace/workspace-client';
import { TestAuthBridge } from '@/components/workspace/test-auth-bridge';

export const metadata: Metadata = {
  title: 'Workspace — Exawatt',
  description: 'Agent terminal workspace',
};

export default function WorkspacePage() {
  return (
    <div className="h-[calc(100svh-3rem)] overflow-hidden">
      <TestAuthBridge />
      <Suspense
        fallback={
          <div
            className="h-full bg-[#04060b]"
            aria-label="Loading terminal workspace"
          />
        }
      >
        <WorkspaceClient />
      </Suspense>
    </div>
  );
}

import type { Metadata } from 'next';
import { Suspense } from 'react';
import { WorkspaceClient } from '@/components/workspace/workspace-client';
import { TestAuthBridge } from '@/components/workspace/test-auth-bridge';
import { WorkspaceScopeGate } from '@/lib/tenancy/workspace-scope-gate';
import { DemoWorkspaceClient } from '@/lib/demo-workspace/demo-workspace-client';

// noindex: the workspace is the app itself. It sits outside the auth gate so
// the Electron renderer works with the network down (ENG-016 D18), which also
// leaves it crawlable, so indexability is refused in metadata rather than by
// routing. Same posture as `/hud-gallery` and `/usage`.
export const metadata: Metadata = {
  title: 'Agent',
  description: 'Agent terminal workspace',
  robots: { index: false, follow: false },
};

export default function WorkspacePage() {
  return (
    <div className="h-[calc(100svh-3rem)] overflow-hidden">
      <TestAuthBridge />
      <Suspense
        fallback={
          <div
            className="flex h-full items-center justify-center bg-[#04060b]"
            role="status"
            aria-label="Loading terminal workspace"
          >
            <p className="animate-pulse font-mono text-xs text-zinc-500">
              Loading workspace…
            </p>
          </div>
        }
      >
        <WorkspaceScopeGate demo={<DemoWorkspaceClient />}>
          <WorkspaceClient />
        </WorkspaceScopeGate>
      </Suspense>
    </div>
  );
}

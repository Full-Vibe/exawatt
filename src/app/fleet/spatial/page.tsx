import { Suspense } from 'react';
import { SpatialFleetClient } from '@/components/fleet/spatial/spatial-fleet-client';
import { WorkspaceScopeGate } from '@/lib/tenancy/workspace-scope-gate';

export default function SpatialFleetPage() {
  return (
    <Suspense
      fallback={
        <div className="fleet-shell flex h-[calc(100svh-3rem)] items-center justify-center text-zinc-400">
          Loading the fleet…
        </div>
      }
    >
      {/* the Fleet altitude is Personal live truth (window.electron.pty via
          the fleet transport) — a non-personal tenant gets its scoped view,
          never this machine's fleet under another identity (ENG-027) */}
      <WorkspaceScopeGate className="min-h-[calc(100svh-3rem)]">
        <SpatialFleetClient />
      </WorkspaceScopeGate>
    </Suspense>
  );
}

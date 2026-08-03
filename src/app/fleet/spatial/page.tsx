import { Suspense } from 'react';
import { SpatialFleetClient } from '@/components/fleet/spatial/spatial-fleet-client';
import { WorkspaceScopeGate } from '@/lib/tenancy/workspace-scope-gate';

export default function SpatialFleetPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[calc(100svh-3rem)] items-center justify-center bg-background text-muted-foreground">
          Loading the fleet…
        </div>
      }
    >
      {/* the Fleet altitude is Personal live truth (window.electron.pty via
          the fleet transport) — a non-personal tenant gets its scoped view,
          never this machine's fleet under another identity (ENG-027). The
          Demo tenant renders the SAME client: the tenant-aware FleetProvider
          swaps the transport underneath, so Demo shows the Voltaic board. */}
      <WorkspaceScopeGate
        className="min-h-[calc(100svh-3rem)]"
        demo={<SpatialFleetClient />}
      >
        <SpatialFleetClient />
      </WorkspaceScopeGate>
    </Suspense>
  );
}

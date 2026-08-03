import { Suspense } from 'react';
import { SpatialFleetClient } from '@/components/fleet/spatial/spatial-fleet-client';

export default function SpatialFleetPage() {
  return (
    <Suspense
      fallback={
        <div className="fleet-shell flex h-[calc(100svh-3rem)] items-center justify-center text-zinc-400">
          Loading the fleet…
        </div>
      }
    >
      <SpatialFleetClient />
    </Suspense>
  );
}

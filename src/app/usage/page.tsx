import { UsageClient } from './usage-client';
import { WorkspaceScopeGate } from '@/lib/tenancy/workspace-scope-gate';

// No server-side auth gate: like Settings, this is an Electron-reachable
// surface that must render offline and signed out. It reads only in-process
// demo sources.
//
// Tenant-scope gated since ENG-027 W2: the surface has a per-tenant source
// (Personal → the demo week; Demo → the Voltaic corpus), so it joins
// TENANT_SCOPE_GATED_SURFACE_PATHS — the W1 decision note made this an exit
// criterion, not an option. The client itself picks the corpus by tenant;
// the gate keeps other non-personal tenants on the scoped view.
export default function UsagePage() {
  return (
    <WorkspaceScopeGate
      className="min-h-svh"
      demo={<UsageClient />}
    >
      <UsageClient />
    </WorkspaceScopeGate>
  );
}

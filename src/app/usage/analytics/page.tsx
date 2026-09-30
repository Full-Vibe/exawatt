import type { Metadata } from 'next';
import { WorkspaceScopeGate } from '@/lib/tenancy/workspace-scope-gate';
import { AnalyticsClient } from './analytics-client';

// The segment title rides the parent layout's template; this names the tab.
export const metadata: Metadata = { title: 'Usage analytics' };

// Tenant-scope gated like the Overview tab: the same per-tenant corpus.
export default function UsageAnalyticsPage() {
  return (
    <WorkspaceScopeGate className="min-h-svh" demo={<AnalyticsClient />}>
      <AnalyticsClient />
    </WorkspaceScopeGate>
  );
}

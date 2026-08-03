'use client';

/**
 * Workspace scope gate (ENG-027 W1).
 *
 * The command surfaces render PERSONAL truth — live PTY-bound Sessions on
 * this machine (the Agent/Team shell on /workspace, the live fleet on
 * /fleet/spatial). When the active Workspace is any other tenant, this gate
 * swaps the personal surface for that Workspace's scoped view instead. Every
 * route listed in `TENANT_SCOPE_GATED_SURFACE_PATHS`
 * (command-surface-memory.ts) MUST mount this gate — that list is what lets
 * tenant view-state restore fail closed. Unmounting the personal shell
 * disposes only renderer widgets (xterm instances); the PTYs live in the
 * Electron main process and keep running untouched — returning to Personal
 * re-adopts them exactly where they were (the reload-adoption path).
 *
 * In W1 non-personal Workspaces have no content source yet, so the scoped view
 * is an honest empty state carrying the Workspace's identity. ENG-027 W2
 * replaces the empty state with the demo source behind the same gate.
 */
import type { ReactNode } from 'react';
import { Layers } from 'lucide-react';
import { useOptionalWorkspaceTenancy } from './tenancy-provider';

export function WorkspaceScopeGate({
  children,
  className,
}: {
  children: ReactNode;
  /** sizing for the scoped view on routes without a fixed-height parent */
  className?: string;
}) {
  const tenancy = useOptionalWorkspaceTenancy();
  const active = tenancy?.activeWorkspace;
  if (!active || active.kind === 'personal') return <>{children}</>;

  return (
    <div
      data-tenant-workspace-scope={active.id}
      className={`flex h-full flex-col items-center justify-center gap-3 bg-[#04060b] px-6 text-center ${className ?? ''}`}
    >
      <Layers aria-hidden="true" className="h-6 w-6 text-teal-200/70" />
      <p className="font-mono text-sm font-medium text-zinc-100">
        {active.name} Workspace
      </p>
      <p className="max-w-md font-mono text-xs leading-relaxed text-zinc-500">
        {active.kind === 'demo'
          ? 'This Workspace has no content source yet — its populated fleet arrives with the demo data source (ENG-027 W2).'
          : 'This Workspace has no local content yet.'}
      </p>
      <p className="font-mono text-[10px] text-zinc-600">
        Your live local Sessions keep running in the Personal Workspace.
      </p>
    </div>
  );
}

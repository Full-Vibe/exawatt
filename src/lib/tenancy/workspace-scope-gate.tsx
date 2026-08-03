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
 * Since W2 the builtin Demo tenant has a real content source: routes pass it
 * as `demo`, and the gate renders it under the Demo identity. Any non-personal
 * tenant WITHOUT content (Organization previews, test benches, a gated route
 * that passed no `demo`) still gets the honest identity-carrying empty state —
 * the gate fails closed to "no content", never open to Personal truth.
 */
import type { ReactNode } from 'react';
import { Layers } from 'lucide-react';
import { useOptionalWorkspaceTenancy } from './tenancy-provider';
import { DEMO_WORKSPACE_ID } from './workspace-scope';

export function WorkspaceScopeGate({
  children,
  demo,
  className,
}: {
  children: ReactNode;
  /** What the builtin Demo tenant renders on this route (ENG-027 W2) — the
   *  demo-sourced version of the surface. Omit it and Demo gets the scoped
   *  empty state: fail closed, never Personal truth. */
  demo?: ReactNode;
  /** sizing for the scoped view on routes without a fixed-height parent */
  className?: string;
}) {
  const tenancy = useOptionalWorkspaceTenancy();
  const active = tenancy?.activeWorkspace;
  if (!active || active.kind === 'personal') return <>{children}</>;

  if (active.id === DEMO_WORKSPACE_ID && demo !== undefined) {
    return (
      <div data-tenant-workspace-scope={active.id} className="contents">
        {demo}
      </div>
    );
  }

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
          ? 'This surface has no demo content source in this Workspace.'
          : 'This Workspace has no local content yet.'}
      </p>
      <p className="font-mono text-[10px] text-zinc-600">
        Your live local Sessions keep running in the Personal Workspace.
      </p>
    </div>
  );
}

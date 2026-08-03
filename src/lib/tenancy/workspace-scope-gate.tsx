'use client';

/**
 * Workspace scope gate (ENG-027 W1).
 *
 * The Terminal surface renders PERSONAL truth — live PTY-bound Sessions on
 * this machine. When the active Workspace is any other tenant, this gate swaps
 * the shell for that Workspace's scoped view instead. Unmounting the personal
 * shell disposes only renderer widgets (xterm instances); the PTYs live in the
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

export function WorkspaceScopeGate({ children }: { children: ReactNode }) {
  const tenancy = useOptionalWorkspaceTenancy();
  const active = tenancy?.activeWorkspace;
  if (!active || active.kind === 'personal') return <>{children}</>;

  return (
    <div
      data-tenant-workspace-scope={active.id}
      className="flex h-full flex-col items-center justify-center gap-3 bg-[#04060b] px-6 text-center"
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

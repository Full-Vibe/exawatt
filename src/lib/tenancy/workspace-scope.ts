/**
 * Workspace tenancy (ENG-027 W1) — the pure model.
 *
 * `Workspace` is the canonical top-level tenancy scope (concepts.md): the
 * boundary everything the operator sees is scoped to. This module is
 * deliberately named "tenant workspace" in code because the word "workspace"
 * is already taken by the terminal shell surface (`src/components/workspace`,
 * `electron/main/workspace-store.ts`); the tenancy scope is a different, higher
 * concept and the two must not be confused at an import site.
 *
 * Design decisions (operator brief + design pass, 2026-08-02):
 * - the account-menu switcher is the REAL tenancy seam, not a demo toggle
 * - Personal is local truth and the default; Demo is the first non-personal
 *   tenant and stays `coming-soon` until ENG-027 W2 authors its source
 * - switching Workspaces is a view-scope change with ZERO lifecycle side
 *   effects — nothing in this module (or its provider) may reach the PTY or
 *   session-persistence APIs
 */

import { DEMO_ORGANIZATION } from '@exawatt/core';

export type TenantWorkspaceId = string;

export type TenantWorkspaceKind = 'personal' | 'demo' | 'organization';

/** `preview` navigates to an honest ENG-026 preview; `coming-soon` is inert.
 *  Neither can become the active Workspace until its source is available. */
export type TenantWorkspaceAvailability =
  | 'available'
  | 'preview'
  | 'coming-soon';

export interface TenantWorkspace {
  id: TenantWorkspaceId;
  name: string;
  kind: TenantWorkspaceKind;
  availability: TenantWorkspaceAvailability;
  /** one-line identity shown under the name in the switcher */
  tagline?: string;
  /** Required for `preview`: the real preview surface this row opens. */
  href?: string;
}

export const PERSONAL_WORKSPACE_ID: TenantWorkspaceId = 'personal';
export const DEMO_WORKSPACE_ID: TenantWorkspaceId = 'demo';
export const ORGANIZATION_WORKSPACE_PREVIEW_ID: TenantWorkspaceId =
  'organization-preview';

export const PERSONAL_WORKSPACE: TenantWorkspace = {
  id: PERSONAL_WORKSPACE_ID,
  name: 'Personal',
  kind: 'personal',
  availability: 'available',
  tagline: 'Local truth — this machine',
};

/** Live since ENG-027 W2: the Voltaic demo source feeds the gated surfaces,
 *  so the switcher entry is real. */
export const DEMO_WORKSPACE: TenantWorkspace = {
  id: DEMO_WORKSPACE_ID,
  name: 'Demo',
  kind: 'demo',
  availability: 'available',
  tagline: `${DEMO_ORGANIZATION.name} — representative fleet`,
};

/** ENG-027 W5: the future shared tenant is a first-class Workspace row, not a
 *  menu exception. It opens the honest Organization preview and can never be
 *  persisted or activated until a real shared source makes it `available`. */
export const ORGANIZATION_WORKSPACE_PREVIEW: TenantWorkspace = {
  id: ORGANIZATION_WORKSPACE_PREVIEW_ID,
  name: DEMO_ORGANIZATION.name,
  kind: 'organization',
  availability: 'preview',
  tagline: 'Shared fleet preview',
  href: '/organization',
};

export const BUILTIN_WORKSPACES: readonly TenantWorkspace[] = [
  PERSONAL_WORKSPACE,
  DEMO_WORKSPACE,
  ORGANIZATION_WORKSPACE_PREVIEW,
];

export const ACTIVE_WORKSPACE_STORAGE_KEY = 'exawatt:active-workspace:v1';

/**
 * Resolve a persisted active-Workspace id against the known list. Unknown ids
 * and non-`available` Workspaces fall back to Personal — the app must never
 * wake up inside a tenant that cannot render.
 */
export function resolveActiveWorkspace(
  storedId: string | null | undefined,
  workspaces: readonly TenantWorkspace[]
): TenantWorkspace {
  const match = workspaces.find(
    workspace =>
      workspace.id === storedId && workspace.availability === 'available'
  );
  if (match) return match;
  return (
    workspaces.find(workspace => workspace.id === PERSONAL_WORKSPACE_ID) ??
    PERSONAL_WORKSPACE
  );
}

/**
 * Namespace a renderer view-state storage key per Workspace.
 *
 * Personal maps to the UNSCOPED legacy key on purpose: the operator's existing
 * view memory (last command surface, rail modes) predates tenancy and IS
 * Personal's state — migrating it would lose it.
 */
export function workspaceScopedStorageKey(
  workspaceId: TenantWorkspaceId,
  baseKey: string
): string {
  if (workspaceId === PERSONAL_WORKSPACE_ID) return baseKey;
  const suffix = baseKey.startsWith('exawatt:')
    ? baseKey.slice('exawatt:'.length)
    : baseKey;
  return `exawatt:ws:${workspaceId}:${suffix}`;
}

/** Shape guard for Workspaces injected by dev/test tooling. */
export function isTenantWorkspace(value: unknown): value is TenantWorkspace {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.name === 'string' &&
    candidate.name.length > 0 &&
    (candidate.kind === 'personal' ||
      candidate.kind === 'demo' ||
      candidate.kind === 'organization') &&
    (candidate.availability === 'available' ||
      candidate.availability === 'preview' ||
      candidate.availability === 'coming-soon') &&
    (candidate.availability !== 'preview' ||
      (typeof candidate.href === 'string' && candidate.href.startsWith('/')))
  );
}

/**
 * Merge additional Workspaces (test fixtures now; Organization tenants and the
 * live Demo source later) into the builtin list. Builtins win id collisions —
 * nothing may redefine Personal.
 */
export function mergeWorkspaces(
  base: readonly TenantWorkspace[],
  additions: readonly unknown[]
): TenantWorkspace[] {
  const merged = [...base];
  for (const addition of additions) {
    if (!isTenantWorkspace(addition)) continue;
    if (merged.some(workspace => workspace.id === addition.id)) continue;
    merged.push(addition);
  }
  return merged;
}

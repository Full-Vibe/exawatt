/**
 * Module-level mirror of the ACTIVE tenant Workspace kind (ENG-027).
 *
 * `WorkspaceTenancyProvider` publishes here so non-React modules that carry
 * cross-surface request state (`session-jump.ts` pending-launch slots) can
 * fail closed against the tenant scope: a verb invoked while a non-personal
 * Workspace is on screen must not store a slot that fires against Personal
 * local truth minutes later. React consumers keep using the provider context;
 * this mirror exists ONLY for module-scope guards and never drives rendering.
 */
import { PERSONAL_WORKSPACE, type TenantWorkspaceKind } from './workspace-scope';

let activeKind: TenantWorkspaceKind = PERSONAL_WORKSPACE.kind;

export function publishActiveTenantKind(kind: TenantWorkspaceKind): void {
  activeKind = kind;
}

/** Live-workspace verbs (PTY launches, the Agent composer, pending-launch
 *  slots) are only meaningful against Personal local truth. */
export function personalTenantActive(): boolean {
  return activeKind === 'personal';
}

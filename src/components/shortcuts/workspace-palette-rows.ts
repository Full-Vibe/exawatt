import type {
  TenantWorkspace,
  TenantWorkspaceId,
} from '@/lib/tenancy/workspace-scope';
import { paletteValue } from './palette-filter';

export type WorkspacePaletteAction =
  | 'current'
  | 'switch'
  | 'open-preview'
  | 'unavailable';

export interface WorkspacePaletteRow {
  id: string;
  workspace: TenantWorkspace;
  action: WorkspacePaletteAction;
  /** cmdk value: workspace name + unique suffix (`paletteValue`) */
  value: string;
  /** auxiliary search terms for cmdk's `keywords` prop */
  keywords: string[];
  note?: string;
}

/** Pure command projection of the tenancy model. The palette does not invent
 * availability or navigation semantics: available tenants switch through the
 * provider, previews open their typed destination, and coming-soon tenants are
 * searchable but inert. */
export function buildWorkspacePaletteRows(
  workspaces: readonly TenantWorkspace[],
  activeWorkspaceId: TenantWorkspaceId
): WorkspacePaletteRow[] {
  return workspaces.map(workspace => {
    const current = workspace.id === activeWorkspaceId;
    const action: WorkspacePaletteAction = current
      ? 'current'
      : workspace.availability === 'available'
        ? 'switch'
        : workspace.availability === 'preview'
          ? 'open-preview'
          : 'unavailable';

    return {
      id: `workspace:${workspace.id}`,
      workspace,
      action,
      value: paletteValue(workspace.name, `workspace:${workspace.id}`),
      keywords: [
        workspace.kind,
        ...(workspace.tagline ? [workspace.tagline] : []),
        'workspace',
        'tenant',
        'organization',
        'account',
        'switch',
        'open',
      ],
      note: current
        ? 'Current'
        : workspace.availability === 'preview' ||
            workspace.availability === 'coming-soon'
          ? 'Coming soon'
          : undefined,
    };
  });
}

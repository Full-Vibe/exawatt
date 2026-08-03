import { describe, expect, it } from 'vitest';
import {
  DEMO_WORKSPACE,
  ORGANIZATION_WORKSPACE_PREVIEW,
  PERSONAL_WORKSPACE,
  type TenantWorkspace,
} from '@/lib/tenancy/workspace-scope';
import { buildWorkspacePaletteRows } from './workspace-palette-rows';

describe('Workspace command-palette rows', () => {
  it('maps active, switchable, and preview tenants without changing truth', () => {
    const rows = buildWorkspacePaletteRows(
      [PERSONAL_WORKSPACE, DEMO_WORKSPACE, ORGANIZATION_WORKSPACE_PREVIEW],
      PERSONAL_WORKSPACE.id
    );

    expect(rows.map(row => [row.workspace.id, row.action, row.note])).toEqual([
      ['personal', 'current', 'Current'],
      ['demo', 'switch', undefined],
      ['organization-preview', 'open-preview', 'Coming soon'],
    ]);
    expect(rows[1].value).toContain('Demo');
    expect(rows[2].value).toContain('Voltaic Grid Systems');
    expect(rows[2].workspace.href).toBe('/organization');
  });

  it('keeps a coming-soon tenant searchable but inert', () => {
    const future: TenantWorkspace = {
      id: 'future-org',
      name: 'Future Organization',
      kind: 'organization',
      availability: 'coming-soon',
    };

    expect(buildWorkspacePaletteRows([future], 'personal')[0]).toMatchObject({
      action: 'unavailable',
      note: 'Coming soon',
      value: expect.stringContaining('Future Organization'),
    });
  });
});

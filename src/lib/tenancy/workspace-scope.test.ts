import { describe, expect, it } from 'vitest';
import {
  BUILTIN_WORKSPACES,
  DEMO_WORKSPACE,
  DEMO_WORKSPACE_ID,
  ORGANIZATION_WORKSPACE_PREVIEW,
  ORGANIZATION_WORKSPACE_PREVIEW_ID,
  PERSONAL_WORKSPACE,
  PERSONAL_WORKSPACE_ID,
  isTenantWorkspace,
  mergeWorkspaces,
  resolveActiveWorkspace,
  workspaceScopedStorageKey,
} from './workspace-scope';

describe('resolveActiveWorkspace', () => {
  it('defaults to Personal with no stored id', () => {
    expect(resolveActiveWorkspace(null, BUILTIN_WORKSPACES).id).toBe(
      PERSONAL_WORKSPACE_ID
    );
    expect(resolveActiveWorkspace(undefined, BUILTIN_WORKSPACES).id).toBe(
      PERSONAL_WORKSPACE_ID
    );
  });

  it('falls back to Personal for unknown ids', () => {
    expect(resolveActiveWorkspace('acme-org', BUILTIN_WORKSPACES).id).toBe(
      PERSONAL_WORKSPACE_ID
    );
  });

  it('never wakes up inside a coming-soon Workspace', () => {
    const teaser = {
      id: 'org-preview',
      name: 'Organization',
      kind: 'organization',
      availability: 'coming-soon',
    } as const;
    expect(
      resolveActiveWorkspace('org-preview', [...BUILTIN_WORKSPACES, teaser]).id
    ).toBe(PERSONAL_WORKSPACE_ID);
  });

  it('never wakes up inside a preview Workspace', () => {
    expect(
      resolveActiveWorkspace(
        ORGANIZATION_WORKSPACE_PREVIEW_ID,
        BUILTIN_WORKSPACES
      ).id
    ).toBe(PERSONAL_WORKSPACE_ID);
  });

  it('resolves Demo — available since ENG-027 W2', () => {
    expect(
      resolveActiveWorkspace(DEMO_WORKSPACE_ID, BUILTIN_WORKSPACES).id
    ).toBe(DEMO_WORKSPACE_ID);
  });

  it('resolves an available non-personal Workspace', () => {
    const bench = {
      id: 'bench',
      name: 'Bench',
      kind: 'demo',
      availability: 'available',
    } as const;
    expect(
      resolveActiveWorkspace('bench', [...BUILTIN_WORKSPACES, bench]).id
    ).toBe('bench');
  });
});

describe('workspaceScopedStorageKey', () => {
  it('keeps Personal on the legacy unscoped key so operator memory survives', () => {
    expect(
      workspaceScopedStorageKey(
        PERSONAL_WORKSPACE_ID,
        'exawatt:last-command-surface:v1'
      )
    ).toBe('exawatt:last-command-surface:v1');
  });

  it('namespaces every other Workspace', () => {
    expect(
      workspaceScopedStorageKey(
        DEMO_WORKSPACE_ID,
        'exawatt:last-command-surface:v1'
      )
    ).toBe('exawatt:ws:demo:last-command-surface:v1');
  });

  it('prefixes keys without the exawatt namespace', () => {
    expect(workspaceScopedStorageKey('demo', 'rail-mode')).toBe(
      'exawatt:ws:demo:rail-mode'
    );
  });
});

describe('mergeWorkspaces', () => {
  it('rejects malformed additions', () => {
    const merged = mergeWorkspaces(BUILTIN_WORKSPACES, [
      null,
      42,
      { id: '', name: 'x', kind: 'demo', availability: 'available' },
      { id: 'ok', name: 'OK', kind: 'demo', availability: 'available' },
      { id: 'bad-kind', name: 'x', kind: 'team', availability: 'available' },
    ]);
    expect(merged.map(workspace => workspace.id)).toEqual([
      PERSONAL_WORKSPACE_ID,
      DEMO_WORKSPACE_ID,
      ORGANIZATION_WORKSPACE_PREVIEW_ID,
      'ok',
    ]);
  });

  it('never lets an addition redefine a builtin', () => {
    const merged = mergeWorkspaces(BUILTIN_WORKSPACES, [
      {
        id: PERSONAL_WORKSPACE_ID,
        name: 'Impostor',
        kind: 'demo',
        availability: 'available',
      },
    ]);
    expect(merged).toHaveLength(3);
    expect(merged[0]).toEqual(PERSONAL_WORKSPACE);
    expect(merged[1]).toEqual(DEMO_WORKSPACE);
    expect(merged[2]).toEqual(ORGANIZATION_WORKSPACE_PREVIEW);
  });
});

describe('isTenantWorkspace', () => {
  it('accepts the builtins', () => {
    expect(BUILTIN_WORKSPACES.every(isTenantWorkspace)).toBe(true);
  });

  it('requires preview Workspaces to name a local destination', () => {
    expect(
      isTenantWorkspace({
        id: 'preview-without-route',
        name: 'Preview',
        kind: 'organization',
        availability: 'preview',
      })
    ).toBe(false);
  });
});

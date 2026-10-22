'use client';

import {
  PERMISSIONS,
  PERMISSION_STATE_LABELS,
  permissionAction,
  type PermissionDeclaration,
  type PermissionKind,
  type PermissionState,
} from '@exawatt/core';
import { Button } from '@/components/ui/button';
import { usePermissions } from '@/components/permissions/permissions-provider';
import { SettingsGroup, SettingRow } from './settings-controls';

/**
 * ENG-045: every grant Exawatt asks for, in one place. Rows are rendered from
 * `PERMISSIONS`, the same declaration main reads statuses and raises prompts
 * from, so a grant cannot appear here without main owning it or be asked for
 * without appearing here. The Settings shell draws the page's header.
 */

const GROUPS: Array<{
  kind: PermissionKind;
  title: string;
  description: string;
  dataAttribute: string;
}> = [
  {
    kind: 'os',
    title: 'On this Mac',
    description:
      'Exawatt asks when it first needs each one, or you can allow it here.',
    dataAttribute: 'data-permissions-os',
  },
  {
    kind: 'in-app',
    title: 'In Exawatt',
    description: 'What you have let your Agents and teammates do.',
    dataAttribute: 'data-permissions-in-app',
  },
];

function StateDot({ state }: { state: PermissionState }) {
  const color =
    state === 'granted'
      ? 'var(--settings-teal)'
      : state === 'denied' || state === 'restricted'
        ? 'var(--settings-amber)'
        : 'var(--settings-faint)';
  return (
    <span
      aria-hidden="true"
      className="size-2 shrink-0 rounded-full"
      style={{ background: color }}
    />
  );
}

function PermissionControls({
  declaration,
  state,
}: {
  declaration: PermissionDeclaration;
  state: PermissionState | null;
}) {
  const { ensure, openSettings } = usePermissions();
  if (state === null) {
    return (
      <p className="shrink-0 font-ui text-chrome-meta text-[var(--settings-faint)]">
        Checking
      </p>
    );
  }
  const action = permissionAction(state);
  return (
    <div className="flex shrink-0 items-center gap-3 max-[520px]:justify-between">
      <p
        role="status"
        className="flex items-center gap-2 font-ui text-chrome-meta text-[var(--settings-dim)]"
      >
        <StateDot state={state} />
        {PERMISSION_STATE_LABELS[state]}
      </p>
      {action === 'allow' && (
        <Button
          type="button"
          size="sm"
          onClick={() => void ensure(declaration.id, declaration.why)}
        >
          Allow
        </Button>
      )}
      {action === 'open-settings' && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => openSettings(declaration.id)}
        >
          Open System Settings
        </Button>
      )}
    </div>
  );
}

/**
 * Why macOS names Exawatt when an Agent touches a protected folder (ENG-016
 * D18): Agent processes run as children of Exawatt, so macOS privacy
 * protection attributes their file access to the app. Desktop only.
 */
function FilesAndFoldersRow() {
  return (
    <div data-permissions-explainer>
      <SettingRow
        title="Files and folders"
        description="macOS asks on Exawatt's behalf when an Agent works in Desktop, Documents, Downloads or an external drive. Allow it, or the Agent hits permission errors there. Change it in System Settings → Privacy & Security → Files and Folders."
      />
    </div>
  );
}

export function PermissionsSettings() {
  const { available, stateOf } = usePermissions();
  const groups = GROUPS.map(group => ({
    ...group,
    rows: PERMISSIONS.filter(item => item.kind === group.kind),
  })).filter(group => group.rows.length > 0 || group.kind === 'os');
  // A page with one group lets the page header name it.
  const titled = groups.length > 1;
  return (
    <>
      {groups.map(group => (
        <SettingsGroup
          key={group.kind}
          title={titled ? group.title : undefined}
          description={titled ? group.description : undefined}
          dataAttribute={group.dataAttribute}
        >
          {group.rows.map(declaration => (
            <div key={declaration.id} data-permission={declaration.id}>
              <SettingRow
                title={declaration.label}
                description={declaration.why}
              >
                {available ? (
                  <PermissionControls
                    declaration={declaration}
                    state={stateOf(declaration.id)}
                  />
                ) : (
                  <p className="shrink-0 font-ui text-chrome-meta text-[var(--settings-faint)]">
                    In the desktop app
                  </p>
                )}
              </SettingRow>
            </div>
          ))}
          {group.kind === 'os' && available && <FilesAndFoldersRow />}
        </SettingsGroup>
      ))}
    </>
  );
}

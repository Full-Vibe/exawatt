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
 * without appearing here. Where this page lives in Settings is one entry in
 * `SettingsNavigation`; the component stands on its own.
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
      'What macOS lets Exawatt do. Exawatt asks at the moment it needs one, and you can allow it here first.',
    dataAttribute: 'data-permissions-os',
  },
  {
    kind: 'in-app',
    title: 'In Exawatt',
    description: 'What you have let your agents and teammates do.',
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

export function PermissionsSettings() {
  const { available, stateOf } = usePermissions();
  return (
    <section
      aria-labelledby="permissions-heading"
      className="min-w-0 bg-[var(--settings-page)] px-4 py-6 sm:px-7 lg:px-9"
    >
      <div className="mx-auto max-w-4xl">
        <div className="mb-7 border-b border-[var(--settings-line)] pb-5">
          <h2
            id="permissions-heading"
            className="font-display text-display font-semibold tracking-[-0.02em]"
          >
            Permissions
          </h2>
          <p className="mt-1 font-ui text-chrome-title text-[var(--settings-dim)]">
            What Exawatt has been allowed to do, and where you change it.
          </p>
        </div>

        {GROUPS.map(group => {
          const rows = PERMISSIONS.filter(item => item.kind === group.kind);
          if (rows.length === 0) return null;
          return (
            <SettingsGroup
              key={group.kind}
              title={group.title}
              description={group.description}
              dataAttribute={group.dataAttribute}
            >
              {rows.map(declaration => (
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
            </SettingsGroup>
          );
        })}
      </div>
    </section>
  );
}

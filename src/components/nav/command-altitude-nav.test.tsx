/**
 * ENG-027 W1 review fixes — regression tests for Workspace-scoped command
 * surface memory:
 *
 * 1. Boot-restore race: the one-shot surface restore must wait for the
 *    tenancy provider to resolve the PERSISTED tenant (child effects run
 *    before parent effects), so a relaunch inside a non-personal tenant
 *    restores that tenant's memory and never reads/pollutes Personal's key.
 * 2. Scope hardening: a non-personal tenant's remembered surface is only
 *    honored when the route sits behind WorkspaceScopeGate.
 * 3. Transient cross-tenant write: when a Workspace switch changes the
 *    memory key before navigation lands, the OLD tenant's surface must not
 *    be written under the NEW tenant's key.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CommandAltitudeNav,
  resetInitialCommandSurfaceRestoreForTests,
} from './command-altitude-nav';
import {
  LAST_COMMAND_SURFACE_KEY,
  validStoredCommandSurfaceForWorkspace,
} from './command-surface-memory';
import {
  useWorkspaceTenancy,
  WorkspaceTenancyProvider,
} from '@/lib/tenancy/tenancy-provider';
import {
  ACTIVE_WORKSPACE_STORAGE_KEY,
  workspaceScopedStorageKey,
  type TenantWorkspace,
} from '@/lib/tenancy/workspace-scope';
import { WorkspaceScopeGate } from '@/lib/tenancy/workspace-scope-gate';

const nav = vi.hoisted(() => ({
  pathname: '/workspace',
  search: '',
  replace: vi.fn(),
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
}));

vi.mock('@/components/shortcuts', () => ({
  useEffectiveShortcut: () => null,
}));

vi.mock('@/components/nav/command-navigation-provider', () => ({
  useCommandNavigation: () => ({ activateCommandAltitude: vi.fn() }),
}));

const BENCH: TenantWorkspace = {
  id: 'bench',
  name: 'Bench',
  kind: 'demo',
  availability: 'available',
};

const PERSONAL_KEY = LAST_COMMAND_SURFACE_KEY;
const BENCH_KEY = workspaceScopedStorageKey('bench', LAST_COMMAND_SURFACE_KEY);

function SwitchButton({ to }: { to: string }) {
  const tenancy = useWorkspaceTenancy();
  return (
    <button type="button" onClick={() => tenancy.switchWorkspace(to)}>
      switch-{to}
    </button>
  );
}

function renderNav(extra?: React.ReactNode) {
  return render(
    <WorkspaceTenancyProvider initialWorkspaces={[BENCH]}>
      <CommandAltitudeNav />
      {extra}
    </WorkspaceTenancyProvider>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  nav.pathname = '/workspace';
  nav.search = '';
  nav.replace.mockClear();
  nav.push.mockClear();
  resetInitialCommandSurfaceRestoreForTests();
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: { isElectron: true },
  });
});

afterEach(() => {
  cleanup();
});

describe('boot restore under a persisted non-personal tenant (finding 1)', () => {
  it('restores the resolved tenant memory, not Personal, and leaves Personal key untouched', () => {
    window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, 'bench');
    window.localStorage.setItem(PERSONAL_KEY, '/workspace?view=sessions');
    window.localStorage.setItem(BENCH_KEY, '/fleet/spatial');

    renderNav();

    // the one-shot restore ran exactly once, against bench's memory
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith('/fleet/spatial');
    // Personal's pre-tenancy memory survived the relaunch untouched
    expect(window.localStorage.getItem(PERSONAL_KEY)).toBe(
      '/workspace?view=sessions'
    );
  });

  it('does not fall back to Personal memory when the boot tenant has none', () => {
    window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, 'bench');
    window.localStorage.setItem(PERSONAL_KEY, '/fleet/spatial');

    renderNav();

    // no restore: bench never remembered a surface — Personal's memory is
    // not bench's, and the one-shot must not be consumed against it
    expect(nav.replace).not.toHaveBeenCalled();
    // the current surface was recorded under bench's key only
    expect(window.localStorage.getItem(BENCH_KEY)).toBe('/workspace');
    expect(window.localStorage.getItem(PERSONAL_KEY)).toBe('/fleet/spatial');
  });

  it('restores Personal memory normally when no tenant is persisted', () => {
    window.localStorage.setItem(PERSONAL_KEY, '/workspace?view=sessions');

    renderNav();

    expect(nav.replace).toHaveBeenCalledWith('/workspace?view=sessions');
  });
});

describe('scope-aware restore validation (finding 2 hardening)', () => {
  it('honors gated surfaces for any tenant kind', () => {
    expect(
      validStoredCommandSurfaceForWorkspace('/fleet/spatial', {
        kind: 'demo',
      })
    ).toBe('/fleet/spatial');
    expect(
      validStoredCommandSurfaceForWorkspace('/workspace?view=sessions', {
        kind: 'organization',
      })
    ).toBe('/workspace?view=sessions');
    expect(
      validStoredCommandSurfaceForWorkspace('/fleet/spatial', {
        kind: 'personal',
      })
    ).toBe('/fleet/spatial');
  });

  it('rejects invalid or foreign addresses for every tenant kind', () => {
    for (const kind of ['personal', 'demo', 'organization'] as const) {
      expect(
        validStoredCommandSurfaceForWorkspace('/settings', { kind })
      ).toBeNull();
      expect(
        validStoredCommandSurfaceForWorkspace('https://evil.example/x', {
          kind,
        })
      ).toBeNull();
      expect(validStoredCommandSurfaceForWorkspace(null, { kind })).toBeNull();
    }
  });

  it('switchWorkspace lands on the remembered gated surface of the target', () => {
    window.localStorage.setItem(BENCH_KEY, '/fleet/spatial');
    renderNav(<SwitchButton to="bench" />);

    fireEvent.click(screen.getByText('switch-bench'));

    expect(nav.push).toHaveBeenCalledWith('/fleet/spatial');
  });

  it('the scope gate swaps children for the tenant identity view', () => {
    window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, 'bench');
    render(
      <WorkspaceTenancyProvider initialWorkspaces={[BENCH]}>
        <WorkspaceScopeGate>
          <div data-testid="personal-truth" />
        </WorkspaceScopeGate>
      </WorkspaceTenancyProvider>
    );

    expect(screen.queryByTestId('personal-truth')).not.toBeInTheDocument();
    expect(
      document.querySelector('[data-tenant-workspace-scope="bench"]')
    ).not.toBeNull();
  });
});

describe('transient cross-tenant write (finding 3)', () => {
  it('does not write the old tenant surface under the new tenant key before navigation lands', () => {
    // Personal, sitting on the Fleet altitude
    nav.pathname = '/fleet/spatial';
    const view = renderNav(<SwitchButton to="bench" />);
    expect(window.localStorage.getItem(PERSONAL_KEY)).toBe('/fleet/spatial');

    // switch: the memory key flips to bench while the pathname is still
    // Personal's surface (navigation has not landed yet)
    fireEvent.click(screen.getByText('switch-bench'));
    expect(nav.push).toHaveBeenCalledWith('/workspace');
    expect(window.localStorage.getItem(BENCH_KEY)).toBeNull();

    // navigation lands — NOW the surface is bench's and gets recorded
    nav.pathname = '/workspace';
    view.rerender(
      <WorkspaceTenancyProvider initialWorkspaces={[BENCH]}>
        <CommandAltitudeNav />
        <SwitchButton to="bench" />
      </WorkspaceTenancyProvider>
    );
    expect(window.localStorage.getItem(BENCH_KEY)).toBe('/workspace');
    expect(window.localStorage.getItem(PERSONAL_KEY)).toBe('/fleet/spatial');
  });
});

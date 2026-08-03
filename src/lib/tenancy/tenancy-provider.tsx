'use client';

/**
 * Workspace tenancy provider (ENG-027 W1).
 *
 * Owns WHICH Workspace the app is looking at — nothing else. Switching is a
 * view-scope change with zero lifecycle side effects: this file must never
 * import or call `window.electron.pty` / `window.electron.workspace`. Live
 * local Sessions belong to the Electron main process and keep running no
 * matter which Workspace the renderer is showing; returning to Personal
 * re-adopts them through the existing reload-adoption path.
 *
 * View-state scoping: `CommandAltitudeNav` continuously records the current
 * command surface under the ACTIVE Workspace's scoped key; on switch this
 * provider restores the TARGET Workspace's remembered surface, so each tenant
 * returns exactly where it was left.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  ACTIVE_WORKSPACE_STORAGE_KEY,
  BUILTIN_WORKSPACES,
  mergeWorkspaces,
  resolveActiveWorkspace,
  workspaceScopedStorageKey,
  type TenantWorkspace,
  type TenantWorkspaceId,
} from './workspace-scope';
import {
  LAST_COMMAND_SURFACE_KEY,
  validStoredCommandSurface,
} from '@/components/nav/command-surface-memory';

/** DEV/TEST ONLY: lets the Electron eval register an `available` non-personal
 *  Workspace so the switch guarantee is demonstrable before W2 makes Demo
 *  real. Same registration shape W2/W5 will use for real tenants. */
export const REGISTER_TEST_WORKSPACES_EVENT =
  'exawatt:register-test-workspaces';

interface WorkspaceTenancyContextValue {
  workspaces: readonly TenantWorkspace[];
  activeWorkspace: TenantWorkspace;
  /** No-op for unknown or `coming-soon` targets. Zero lifecycle side effects. */
  switchWorkspace: (id: TenantWorkspaceId) => void;
}

const WorkspaceTenancyContext =
  createContext<WorkspaceTenancyContextValue | null>(null);

export function useWorkspaceTenancy(): WorkspaceTenancyContextValue {
  const context = useContext(WorkspaceTenancyContext);
  if (!context) {
    throw new Error(
      'useWorkspaceTenancy must be used within WorkspaceTenancyProvider'
    );
  }
  return context;
}

/** Null-tolerant variant for components that render outside the app shell. */
export function useOptionalWorkspaceTenancy() {
  return useContext(WorkspaceTenancyContext);
}

export function WorkspaceTenancyProvider({
  children,
}: {
  children: ReactNode;
}) {
  const router = useRouter();
  const [extraWorkspaces, setExtraWorkspaces] = useState<TenantWorkspace[]>([]);
  const workspaces = useMemo(
    () => mergeWorkspaces(BUILTIN_WORKSPACES, extraWorkspaces),
    [extraWorkspaces]
  );

  // Hydration safety: the server render always sees Personal; the persisted
  // choice applies post-mount (same pattern as the header's inElectron flag).
  const [activeId, setActiveId] = useState<TenantWorkspaceId>(
    BUILTIN_WORKSPACES[0].id
  );
  useEffect(() => {
    setActiveId(
      resolveActiveWorkspace(
        window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY),
        workspaces
      ).id
    );
    // resolve once on mount; later registrations must not yank the operator
    // out of the Workspace they are looking at
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    const onRegister = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!Array.isArray(detail)) return;
      setExtraWorkspaces(current =>
        mergeWorkspaces(current, detail).filter(
          workspace =>
            !BUILTIN_WORKSPACES.some(builtin => builtin.id === workspace.id)
        )
      );
    };
    window.addEventListener(REGISTER_TEST_WORKSPACES_EVENT, onRegister);
    return () =>
      window.removeEventListener(REGISTER_TEST_WORKSPACES_EVENT, onRegister);
  }, []);

  const activeWorkspace = useMemo(
    () => resolveActiveWorkspace(activeId, workspaces),
    [activeId, workspaces]
  );

  const switchWorkspace = useCallback(
    (id: TenantWorkspaceId) => {
      if (id === activeWorkspace.id) return;
      const target = workspaces.find(
        workspace =>
          workspace.id === id && workspace.availability === 'available'
      );
      if (!target) return;
      setActiveId(target.id);
      window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, target.id);
      // land on the target Workspace's remembered command surface — its own
      // "exactly where it was", recorded by CommandAltitudeNav under the
      // target's scoped key
      const remembered = validStoredCommandSurface(
        window.localStorage.getItem(
          workspaceScopedStorageKey(target.id, LAST_COMMAND_SURFACE_KEY)
        )
      );
      router.push(remembered ?? '/workspace');
    },
    [activeWorkspace.id, router, workspaces]
  );

  const value = useMemo(
    () => ({ workspaces, activeWorkspace, switchWorkspace }),
    [workspaces, activeWorkspace, switchWorkspace]
  );

  return (
    <WorkspaceTenancyContext.Provider value={value}>
      {children}
    </WorkspaceTenancyContext.Provider>
  );
}

import {
  PERMISSIONS,
  ensureOutcome,
  stateFromRead,
  type PermissionDeclaration,
  type PermissionEnsureRequest,
  type PermissionEnsureResult,
  type PermissionId,
  type PermissionPrimerRequest,
  type PermissionRead,
  type PermissionState,
  type PermissionsSnapshot,
} from '@exawatt/core';

/**
 * Main's owner of every grant in the registry (`@exawatt/core`'s
 * `PERMISSIONS`, ENG-045): it reads each status without prompting, raises a
 * system prompt only for a user who pressed Continue on the first-party
 * primer, and tells the renderer what changed. The renderer gets a read-only
 * snapshot and one door, `ensure`. The service declares and asks; it enforces
 * nothing, because macOS (or, later, the Exawatt system a grant names) is
 * what enforces a grant.
 */

/** What a grant needs from the platform, one set per registry entry. */
export interface PermissionProvider {
  /** Reads the status without prompting. A read that failed says so with
   *  `{ ok: false }`; it never invents `denied`. */
  read(): Promise<PermissionRead>;
  /** Raises the system prompt and resolves once the user has answered it.
   *  Called only after the user pressed Continue on the primer. */
  request(): Promise<void>;
  /** Opens the pane where the user changes the grant by hand. */
  openSettings(): Promise<void>;
}

/** Every declared grant has a provider, and nothing else does. */
export type PermissionProviders = {
  readonly [K in PermissionId]: PermissionProvider;
};

export interface PermissionServiceDependencies {
  providers: PermissionProviders;
  /** The declarations to serve; the registry unless a test supplies its own. */
  declarations?: readonly PermissionDeclaration[];
  now?: () => number;
  /** Tells every renderer the snapshot changed. */
  publish: (snapshot: PermissionsSnapshot) => void;
  /** Asks a renderer to show the primer; true when a window took it. */
  offerPrimer: (request: PermissionPrimerRequest) => boolean;
}

export interface PermissionService {
  snapshot(): PermissionsSnapshot;
  /** Re-reads every grant now. Never prompts. */
  refresh(): Promise<PermissionsSnapshot>;
  /** The renderer's door: what to do next to get this grant. */
  ensure(
    id: PermissionId,
    request: PermissionEnsureRequest
  ): Promise<PermissionEnsureResult>;
  /**
   * The door for main's own code, at the moment of need: may it proceed to do
   * the thing that needs this grant right now? When the answer is no because
   * the user was never asked, the primer is offered (once per launch) and the
   * caller drops the work; the system prompt is never raised from here.
   */
  require(id: PermissionId, reason: string): Promise<boolean>;
  openSettings(id: PermissionId): Promise<void>;
}

export function createPermissionService(
  dependencies: PermissionServiceDependencies
): PermissionService {
  const declarations = dependencies.declarations ?? PERMISSIONS;
  const now = dependencies.now ?? Date.now;
  const known = new Map<
    PermissionId,
    { state: PermissionState; checkedAt: number | null }
  >(
    declarations.map(declaration => [
      declaration.id,
      { state: 'unknown', checkedAt: null },
    ])
  );
  /** Requests whose system prompt has not been answered yet. */
  const asking = new Map<PermissionId, Promise<void>>();
  /** Grants the user was asked for in this launch. */
  const requested = new Set<PermissionId>();
  const primerOffered = new Set<PermissionId>();

  const declarationOf = (id: PermissionId) => {
    const declaration = declarations.find(candidate => candidate.id === id);
    if (!declaration) throw new Error(`Undeclared permission: ${id}`);
    return declaration;
  };

  function snapshot(): PermissionsSnapshot {
    return declarations.map(declaration => {
      const entry = known.get(declaration.id)!;
      return {
        id: declaration.id,
        state: entry.state,
        checkedAt: entry.checkedAt,
      };
    });
  }

  async function readState(id: PermissionId): Promise<PermissionState> {
    let read: PermissionRead;
    try {
      read = await dependencies.providers[id].read();
    } catch {
      read = { ok: false };
    }
    let state = stateFromRead(read);
    // While the system prompt is up, macOS can already report the grant as
    // denied. That is a prompt nobody has answered yet, not a refusal.
    if (state === 'denied' && asking.has(id)) state = 'not-determined';
    // A grant given in this launch that only takes effect after a restart.
    if (
      state === 'granted' &&
      declarationOf(id).needsRelaunch &&
      requested.has(id)
    ) {
      state = 'needs-relaunch';
    }
    const previous = known.get(id)!;
    known.set(id, { state, checkedAt: now() });
    if (previous.state !== state) dependencies.publish(snapshot());
    return state;
  }

  function raisePrompt(id: PermissionId): void {
    requested.add(id);
    if (asking.has(id)) return;
    const answered = dependencies.providers[id]
      .request()
      .catch(() => undefined)
      .then(() => {
        asking.delete(id);
        return readState(id);
      })
      .then(() => undefined);
    asking.set(id, answered);
  }

  return {
    snapshot,

    async refresh() {
      await Promise.all(
        declarations.map(declaration => readState(declaration.id))
      );
      return snapshot();
    },

    async ensure(id, request) {
      const state = await readState(id);
      const next = ensureOutcome(state, request.primed === true);
      if (next !== 'request') return { id, state, outcome: next };
      raisePrompt(id);
      const after = await readState(id);
      const outcome =
        after === 'granted'
          ? 'ready'
          : after === 'needs-relaunch'
            ? 'relaunch'
            : after === 'denied' || after === 'restricted'
              ? 'settings'
              : 'requested';
      return { id, state: after, outcome };
    },

    async require(id, reason) {
      const state = await readState(id);
      if (state === 'granted') return true;
      // A status that cannot be read is not a refusal. Once the user has been
      // asked, the thing is attempted and macOS decides.
      if (state === 'unknown' && requested.has(id)) return true;
      if (
        (state === 'not-determined' || state === 'unknown') &&
        !primerOffered.has(id) &&
        dependencies.offerPrimer({ id, reason })
      ) {
        primerOffered.add(id);
      }
      return false;
    },

    openSettings: id => dependencies.providers[id].openSettings(),
  };
}

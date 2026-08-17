/**
 * The one owner of main-process state keyed by a durable Session id.
 *
 * Main has two identity spaces. A **PTY id** names one live process and dies
 * with it; a **durable Session id** names the Session itself and outlives many
 * PTYs. Until this module there was only one lifecycle hook —
 * `PtySessionManager`'s `exit` event — and it belongs to the PTY space. So
 * every Session-keyed store in `context-summarizer.ts` (labels, label sources,
 * instructions, retry state, goal visuals) had an add site and NO delete site:
 * a closed, archived, or reaped Session's goal-visual JPEG stayed resident for
 * the rest of the process lifetime, unreachable from any surface, surviving the
 * deletion of its own on-disk record.
 *
 * The fix is not a delete call per map. `PtySessionManager` now emits
 * `session-forgotten` at the one boundary where main stops knowing a durable
 * Session, and Session-keyed storage is created HERE, through an owner bound to
 * that event. A store is released because it exists, not because its author
 * remembered to unsubscribe — an eighth Session-keyed map added tomorrow is
 * freed on the day it is written, and `context-summarizer.test.ts` fails if one
 * is added outside this owner.
 *
 * Pure data structures, no Electron and no I/O, so it unit-tests directly.
 */

/** Anything that can release one Session's slice of itself. */
export interface SessionScopedStore {
  releaseSession(durableSessionId: string): void;
}

/**
 * A `Map` keyed by durable Session id. Deliberately a `Map` subclass: every
 * existing call site keeps working unchanged, so adopting the owner is not a
 * rewrite of the code that reads the state.
 */
export class SessionScopedMap<V>
  extends Map<string, V>
  implements SessionScopedStore
{
  /** `dispose` exists for values that own a resource, e.g. a retry timer. */
  constructor(private readonly dispose?: (value: V) => void) {
    super();
  }

  releaseSession(durableSessionId: string): void {
    const value = this.get(durableSessionId);
    if (value !== undefined) this.dispose?.(value);
    this.delete(durableSessionId);
  }
}

/** A `Set` of durable Session ids — in-flight and pending markers. */
export class SessionScopedSet
  extends Set<string>
  implements SessionScopedStore
{
  releaseSession(durableSessionId: string): void {
    this.delete(durableSessionId);
  }
}

/** The event any Session-keyed owner must hear to stay bounded. */
export interface SessionForgetSource {
  on(
    event: 'session-forgotten',
    listener: (durableSessionId: string) => void
  ): unknown;
}

export class SessionScopedState {
  private readonly stores = new Set<SessionScopedStore>();

  /** Create a Session-keyed map that is already wired for release. */
  map<V>(dispose?: (value: V) => void): SessionScopedMap<V> {
    return this.register(new SessionScopedMap<V>(dispose));
  }

  /** Create a Session-keyed set that is already wired for release. */
  set(): SessionScopedSet {
    return this.register(new SessionScopedSet());
  }

  /** Adopt a store that owns its own representation. */
  register<T extends SessionScopedStore>(store: T): T {
    this.stores.add(store);
    return store;
  }

  /**
   * Subscribe to the authority that decides a Session is forgotten. One call
   * covers every store this owner holds, including ones added later, which is
   * the whole point: a subscriber cannot silently opt out for one map.
   */
  bind(source: SessionForgetSource): void {
    source.on('session-forgotten', durableSessionId =>
      this.release(durableSessionId)
    );
  }

  release(durableSessionId: string): void {
    for (const store of this.stores) store.releaseSession(durableSessionId);
  }
}

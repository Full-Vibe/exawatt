'use client';

/**
 * The one owner of RENDERER state keyed by a Session identity (BUG-037).
 *
 * The renderer mirrors main's defect (BUG-025) and its cause: there was no
 * "this Session is forgotten" moment here either. `closeTab` and
 * `removeTabFromLayout` are LAYOUT operations — several code paths perform
 * them and none of them owned Session-scoped memory — so every store keyed by
 * a Session identity had an add site and no delete site. The operator runs
 * 8-10 concurrent Sessions for days, so every Session he ever opened stayed
 * resident for the life of the window, unreachable from any surface,
 * surviving the deletion of its own on-disk record.
 *
 * Main's answer was `Map`/`Set` subclasses bound to a `session-forgotten`
 * event. That does not transfer: renderer stores are `Record`s inside
 * `useState`, where a render is driven by IDENTITY CHANGE, so a mutable
 * subclass mutated by an event listener would free bytes and repaint nothing.
 * The owner therefore keeps every store as ordinary immutable React state and
 * moves the LIFECYCLE — declaration and release — into one place.
 *
 * The release moment is derived, not announced. In the renderer the LAYOUT is
 * the authority on which Sessions exist: every reader of every store here
 * dereferences through a tab (`store[tab.durableSessionId]`,
 * `store[tab.sessionId]`), so an identity the layout no longer names is
 * unreachable by construction. `useSessionScopeRelease` watches the layout and
 * releases what it stopped naming. That beats a per-call-site
 * `forgetSession(id)` twice over:
 *
 *   - it is TOTAL. Close, discard-a-draft, archive, launch-into-a-draft and
 *     any removal path written tomorrow release, because the rule is about the
 *     layout rather than about the call site.
 *   - it covers BOTH identity spaces. `summaries`, `goalVisuals` and the
 *     observed identities are keyed by durable Session id; `attention`,
 *     `activity`, `engaged` and `delegation` are keyed by the PTY incarnation
 *     id, which changes on every resume. An event keyed on the durable id
 *     could never reach a superseded PTY id; the layout stops naming it the
 *     moment `pty:exit` nulls `tab.sessionId`.
 *
 * It releases only identities the layout NAMED and then LOST, never every
 * unnamed key, because state legitimately arrives before React commits the tab
 * it belongs to (that race is the entire reason `observedIdentities` exists).
 * A late event that re-adds an already-released identity is swept on the
 * following layout commit.
 *
 * Pure React and pure data — no Electron, no IPC — so it unit-tests directly.
 */
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';

/** Anything that can answer for, and release, one Session's slice of itself. */
export interface SessionScopedStore {
  /** does this store still hold anything for that Session identity? */
  holds(id: string): boolean;
  /** drop every listed identity; a no-op for identities it never held */
  release(ids: ReadonlySet<string>): void;
}

/**
 * The registry every Session-keyed renderer store is declared through.
 *
 * A store is released because it EXISTS, not because its author remembered to
 * add a delete call: `useSessionScopedRecord` is how you get the state at all,
 * and registration happens there.
 */
export class SessionScope {
  private readonly stores = new Map<object, SessionScopedStore>();

  /** `slot` is the declaring hook's stable identity, so this is idempotent. */
  register(slot: object, store: SessionScopedStore): () => void {
    this.stores.set(slot, store);
    return () => {
      this.stores.delete(slot);
    };
  }

  /** true while ANY registered store still holds that Session identity */
  holds(id: string): boolean {
    for (const store of this.stores.values()) if (store.holds(id)) return true;
    return false;
  }

  release(ids: ReadonlySet<string>): void {
    if (ids.size === 0) return;
    for (const store of this.stores.values()) store.release(ids);
  }
}

/** Create the scope this workspace's Session-keyed state is declared through. */
export function useSessionScope(): SessionScope {
  const scope = useRef<SessionScope | null>(null);
  scope.current ??= new SessionScope();
  return scope.current;
}

/**
 * A `Record` keyed by a Session identity, held as ordinary React state.
 *
 * Returns the value, its setter, and a ref mirror, because every one of these
 * stores is read both in render and from a callback. Getting all three from
 * one declaration is what makes "declare it through the owner" the cheapest
 * path rather than an extra chore.
 */
export function useSessionScopedRecord<V>(
  scope: SessionScope,
  initial: Record<string, V> = {}
): [
  Record<string, V>,
  Dispatch<SetStateAction<Record<string, V>>>,
  MutableRefObject<Record<string, V>>,
] {
  const [value, setValue] = useState<Record<string, V>>(initial);
  const ref = useRef(value);
  ref.current = value;
  const slot = useRef<object>({});
  useLayoutEffect(
    () =>
      scope.register(slot.current, {
        holds: id => id in ref.current,
        release: ids =>
          setValue(previous => {
            let next: Record<string, V> | null = null;
            for (const id of ids) {
              if (!(id in previous)) continue;
              next ??= { ...previous };
              delete next[id];
            }
            return next ?? previous;
          }),
      }),
    [scope]
  );
  return [value, setValue, ref];
}

/**
 * A `Map` keyed by a Session identity, held in a ref.
 *
 * Some Session-scoped facts are not rendered — they exist to survive a race
 * with React's own commit — and turning them into state would only add
 * renders. They still leak exactly the same way, so they are declared here too.
 */
export function useSessionScopedMap<V>(
  scope: SessionScope
): MutableRefObject<Map<string, V>> {
  const ref = useRef<Map<string, V>>(new Map());
  const slot = useRef<object>({});
  useLayoutEffect(
    () =>
      scope.register(slot.current, {
        holds: id => ref.current.has(id),
        release: ids => {
          for (const id of ids) ref.current.delete(id);
        },
      }),
    [scope]
  );
  return ref;
}

/** A `Set` of Session identities, held in a ref. */
export function useSessionScopedIdSet(
  scope: SessionScope
): MutableRefObject<Set<string>> {
  const ref = useRef<Set<string>>(new Set());
  const slot = useRef<object>({});
  useLayoutEffect(
    () =>
      scope.register(slot.current, {
        holds: id => ref.current.has(id),
        release: ids => {
          for (const id of ids) ref.current.delete(id);
        },
      }),
    [scope]
  );
  return ref;
}

/** The shape of the layout this owner reads. Deliberately structural: the
 *  release rule depends on tab IDENTITIES and nothing else about a tab. */
export interface SessionScopeLayout {
  tabs: ReadonlyArray<{
    durableSessionId: string;
    sessionId: string | null;
  }>;
}

/** Every Session identity the layout currently names, across both spaces. */
export function namedSessionIdentities(
  layout: ReadonlyArray<SessionScopeLayout>
): Set<string> {
  const named = new Set<string>();
  for (const project of layout) {
    for (const tab of project.tabs) {
      named.add(tab.durableSessionId);
      if (tab.sessionId) named.add(tab.sessionId);
    }
  }
  return named;
}

/**
 * The one moment renderer Session-scoped state is released.
 *
 * Runs on every layout commit and releases the identities the layout has
 * stopped naming. `pending` re-sweeps an identity that a late main-process
 * event re-added after its release — bounded, because an identity leaves
 * `pending` as soon as no store holds it any more.
 */
export function useSessionScopeRelease(
  scope: SessionScope,
  layout: ReadonlyArray<SessionScopeLayout>
): void {
  const namedRef = useRef<Set<string>>(new Set());
  const pendingRef = useRef<Set<string>>(new Set());
  const sweep = useCallback(() => {
    const named = namedSessionIdentities(layout);
    const forgotten = new Set<string>();
    for (const id of namedRef.current) if (!named.has(id)) forgotten.add(id);
    for (const id of pendingRef.current) {
      if (!named.has(id) && scope.holds(id)) forgotten.add(id);
    }
    namedRef.current = named;
    pendingRef.current = forgotten;
    scope.release(forgotten);
  }, [scope, layout]);
  // A layout effect, so the released state and the layout that forgot it land
  // in the same visual frame rather than one paint apart.
  useLayoutEffect(sweep, [sweep]);
}

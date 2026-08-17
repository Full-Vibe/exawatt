import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  goalVisualStore,
  migrateInlineGoalVisuals,
  referencedGoalVisualKeys,
} from './goal-visual-store';

/**
 * Workspace layout persistence. The renderer owns the versioned shape; main
 * serializes atomic replacements so debounce and shutdown checkpoints cannot
 * race or reorder on disk.
 *
 * The layout is a SMALL-OBJECT record: ids, titles, cwds, lifecycle, and the
 * draft the operator is typing. Every field on it rides an all-or-nothing
 * write that fires 400 ms after a keystroke burst and on every tab switch, so
 * nothing large may live here. Large per-Session artifacts belong in a
 * content-addressed side store, referenced by id (BUG-031, `./content-store`).
 */
export class WorkspaceStore {
  private saveTail: Promise<void> = Promise.resolve();
  private temporarySequence = 0;

  constructor(private readonly file: string) {}

  /**
   * Read the layout, optionally rewriting it on the way through.
   *
   * `migrate` runs INSIDE the same serialized chain as `save`, and its rewrite
   * lands before the chain is released. That ordering is the whole point: a
   * migration that read, awaited disk writes for a quarter of a second, and
   * then saved would silently clobber any save that arrived while it was
   * awaiting. Nothing may observe the file between the read this returns and
   * the rewrite that migration implies.
   *
   * `migrate` returns whether it changed `state` in place.
   */
  async load(
    migrate?: (state: unknown) => Promise<boolean>
  ): Promise<unknown | null> {
    const operation = this.saveTail.then(async () => {
      let state: unknown;
      try {
        state = JSON.parse(await fs.promises.readFile(this.file, 'utf8'));
      } catch {
        return null;
      }
      if (migrate && (await migrate(state))) {
        await this.replace(JSON.stringify(state));
      }
      return state;
    });
    this.saveTail = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  async save(state: unknown): Promise<void> {
    const serialized = JSON.stringify(state);
    const operation = this.saveTail.then(() => this.replace(serialized));
    this.saveTail = operation.catch(() => undefined);
    await operation;
  }

  private async replace(serialized: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp-${process.pid}-${++this.temporarySequence}`;
    try {
      await fs.promises.writeFile(temporary, serialized, { mode: 0o600 });
      await fs.promises.chmod(temporary, 0o600);
      await fs.promises.rename(temporary, this.file);
      await fs.promises.chmod(this.file, 0o600);
    } finally {
      await fs.promises.rm(temporary, { force: true });
    }
  }
}

/**
 * Merge live harness identities into a persisted workspace state, keyed by
 * durable session id. Mutates `state` in place; returns whether anything
 * changed.
 *
 * Why main does this at all: the renderer owns the workspace shape and
 * normally performs this merge in its shutdown checkpoint. But the checkpoint
 * only reaches a renderer that has the workspace hook MOUNTED — quitting from
 * /settings, from the Fleet altitude, or while a non-personal tenant
 * Workspace has the shell unmounted (ENG-027 scope gate) would otherwise
 * persist harness session ids as of the last unmount, losing identities
 * settled later (settleProviderIdentities at pre-stop). Main owns both the
 * live sessions and the store, so it walks only the stable identity fields
 * (`projects[].tabs[].durableSessionId/harnessSessionId`) defensively and
 * touches nothing else of the renderer-owned shape.
 */
export function mergeHarnessIdentities(
  state: unknown,
  harnessIdsByDurableSession: ReadonlyMap<string, string>
): boolean {
  if (typeof state !== 'object' || state === null) return false;
  const projects = (state as { projects?: unknown }).projects;
  if (!Array.isArray(projects)) return false;
  let changed = false;
  for (const project of projects) {
    if (typeof project !== 'object' || project === null) continue;
    const tabs = (project as { tabs?: unknown }).tabs;
    if (!Array.isArray(tabs)) continue;
    for (const tab of tabs) {
      if (typeof tab !== 'object' || tab === null) continue;
      const record = tab as {
        durableSessionId?: unknown;
        harnessSessionId?: unknown;
      };
      if (typeof record.durableSessionId !== 'string') continue;
      const live = harnessIdsByDurableSession.get(record.durableSessionId);
      if (live && record.harnessSessionId !== live) {
        record.harnessSessionId = live;
        changed = true;
      }
    }
  }
  return changed;
}

let defaultStore: WorkspaceStore | null = null;

function store(): WorkspaceStore {
  defaultStore ??= new WorkspaceStore(
    path.join(app.getPath('userData'), 'workspace.json')
  );
  return defaultStore;
}

/**
 * Load the layout, moving any inline goal-visual pixels into the side store
 * on the way through.
 *
 * The migration runs HERE, not in the renderer, for two reasons: the renderer
 * would have to receive the 4.84 MB it exists to avoid, and a layout written
 * by an older build must shrink even if the operator never opens the composer
 * again. Migrating rewrites the file immediately, so the cost is paid once.
 */
export function loadWorkspace(): Promise<unknown | null> {
  return store().load(async state => {
    try {
      const { migrated, bytesReclaimed } =
        await migrateInlineGoalVisuals(state);
      if (migrated > 0) {
        console.log(
          `[workspace] moved ${migrated} inline goal visual(s) ` +
            `(${bytesReclaimed} bytes) into the content store`
        );
      }
      return migrated > 0;
    } catch (error) {
      // A failed migration keeps the inline copies. The layout stays large and
      // correct, which is strictly better than a layout that lost its visuals.
      console.error('Goal visual migration failed', error);
      return false;
    }
  });
}

export async function saveWorkspace(state: unknown): Promise<void> {
  await store().save(state);
  // The save path is the eviction owner: it is the only place that knows the
  // complete set of identity keys the layout still refers to.
  void goalVisualStore()
    .sweep(referencedGoalVisualKeys(state))
    .catch(() => undefined);
}

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Workspace layout persistence. The renderer owns the versioned shape; main
 * serializes atomic replacements so debounce and shutdown checkpoints cannot
 * race or reorder on disk.
 */
export class WorkspaceStore {
  private saveTail: Promise<void> = Promise.resolve();
  private temporarySequence = 0;

  constructor(private readonly file: string) {}

  async load(): Promise<unknown | null> {
    await this.saveTail;
    try {
      return JSON.parse(await fs.promises.readFile(this.file, 'utf8'));
    } catch {
      return null;
    }
  }

  async save(state: unknown): Promise<void> {
    const serialized = JSON.stringify(state);
    const operation = this.saveTail.then(async () => {
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
    });
    this.saveTail = operation.catch(() => undefined);
    await operation;
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

export function loadWorkspace(): Promise<unknown | null> {
  return store().load();
}

export function saveWorkspace(state: unknown): Promise<void> {
  return store().save(state);
}

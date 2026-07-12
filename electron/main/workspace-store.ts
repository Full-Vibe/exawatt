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

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Workspace layout persistence (ENG-002 W0.2): initiative groups, tabs,
 * working dirs, last-used dir. The RENDERER owns the shape (versioned JSON);
 * main just stores it durably in userData so it survives app restarts.
 * Live processes are not persisted — tabs auto-revive on launch (decision:
 * operator 2026-07-02, claude --continue / codex resume --last).
 */
const FILE = 'workspace.json';

function filePath(): string {
  return path.join(app.getPath('userData'), FILE);
}

export async function loadWorkspace(): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.promises.readFile(filePath(), 'utf8'));
  } catch {
    return null; // first run / unreadable — renderer starts fresh
  }
}

export async function saveWorkspace(state: unknown): Promise<void> {
  const p = filePath();
  await fs.promises.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(state));
  await fs.promises.rename(tmp, p); // atomic-ish: no torn files on crash
}

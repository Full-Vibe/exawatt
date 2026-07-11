import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow } from 'electron';
import { discoverRoadmapPath, ROADMAP_DISCOVERY_ORDER } from './roadmap-reader';

/**
 * Live roadmap watching (ENG-017 S5). Watches the PARENT DIRECTORY of the
 * discovered roadmap file — editors save via atomic rename and git rewrites
 * files on checkout/commit, both of which kill a file-level watch — and
 * broadcasts a debounced `roadmap:file-changed` so the renderer reparses.
 * When no roadmap exists yet, the project root is watched so adopting the
 * convention lights the lens up without a restart.
 */
const DEBOUNCE_MS = 250;
const MAX_WATCHERS = 32;

interface WatchEntry {
  watcher: fs.FSWatcher;
  timer: NodeJS.Timeout | null;
}

const watchers = new Map<string, WatchEntry>();

const ROOT_BASENAMES = new Set(
  ROADMAP_DISCOVERY_ORDER.map(candidate => path.basename(candidate).toLowerCase())
);

function broadcast(projectDir: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('roadmap:file-changed', { projectDir });
  }
}

export async function watchRoadmap(projectDir: string): Promise<void> {
  const key = path.resolve(projectDir);
  if (watchers.has(key)) return;
  if (watchers.size >= MAX_WATCHERS) return; // focus-refresh still covers it
  const file = await discoverRoadmapPath(key);
  const dir = file ? path.dirname(file) : key;
  const relevant = file
    ? new Set([path.basename(file).toLowerCase()])
    : ROOT_BASENAMES;
  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(dir, { persistent: false });
  } catch {
    return; // directory vanished; focus-refresh remains the fallback
  }
  const entry: WatchEntry = { watcher, timer: null };
  watcher.on('change', (_event, filename) => {
    const name = filename?.toString().toLowerCase();
    if (name && !relevant.has(name)) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      broadcast(key);
      // the discovered file may have appeared/disappeared — re-anchor
      if (!file || !fs.existsSync(file)) {
        unwatchRoadmap(key);
        void watchRoadmap(key);
      }
    }, DEBOUNCE_MS);
  });
  watcher.on('error', () => unwatchRoadmap(key));
  watchers.set(key, entry);
}

export function unwatchRoadmap(projectDir: string): void {
  const key = path.resolve(projectDir);
  const entry = watchers.get(key);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  entry.watcher.close();
  watchers.delete(key);
}

export function disposeRoadmapWatchers(): void {
  for (const key of [...watchers.keys()]) unwatchRoadmap(key);
}

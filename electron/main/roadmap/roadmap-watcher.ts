import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow } from 'electron';
import { discoverRoadmapPath, ROADMAP_DISCOVERY_ORDER } from './roadmap-reader';
import { broadcastToWindows } from '../window-broadcast';

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
  /** Null while the roadmap is still being discovered. */
  watcher: fs.FSWatcher | null;
  timer: NodeJS.Timeout | null;
}

const watchers = new Map<string, WatchEntry>();

const ROOT_BASENAMES = new Set(
  ROADMAP_DISCOVERY_ORDER.map(candidate =>
    path.basename(candidate).toLowerCase()
  )
);

function broadcast(projectDir: string): void {
  broadcastToWindows(BrowserWindow.getAllWindows(), 'roadmap:file-changed', {
    projectDir,
  });
}

export async function watchRoadmap(projectDir: string): Promise<void> {
  const key = path.resolve(projectDir);
  if (watchers.has(key)) return;
  if (watchers.size >= MAX_WATCHERS) return; // focus-refresh still covers it
  // The key is claimed BEFORE discovery awaits. Claimed after, two watches of
  // one Project (or watch, unwatch, watch) each opened an `fs.watch` and the
  // map kept only the last, so the others leaked open for the app's life.
  const entry: WatchEntry = { watcher: null, timer: null };
  watchers.set(key, entry);
  const current = () => watchers.get(key) === entry;
  let file: string | null;
  try {
    file = await discoverRoadmapPath(key);
  } catch {
    if (current()) watchers.delete(key);
    return;
  }
  // Unwatched (and perhaps watched again) while discovering: not ours now.
  if (!current()) return;
  const dir = file ? path.dirname(file) : key;
  const relevant = file
    ? new Set([path.basename(file).toLowerCase()])
    : ROOT_BASENAMES;
  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(dir, { persistent: false });
  } catch {
    watchers.delete(key);
    return; // directory vanished; focus-refresh remains the fallback
  }
  entry.watcher = watcher;
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
  watcher.on('error', () => {
    if (current()) unwatchRoadmap(key);
  });
}

export function unwatchRoadmap(projectDir: string): void {
  const key = path.resolve(projectDir);
  const entry = watchers.get(key);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  entry.watcher?.close();
  watchers.delete(key);
}

export function disposeRoadmapWatchers(): void {
  for (const key of [...watchers.keys()]) unwatchRoadmap(key);
}

import { app } from 'electron';
import * as path from 'path';
import { ContentStore } from './content-store';
import type { GoalVisual } from './pty/context-summarizer';

/**
 * Goal visuals as a content-addressed side store (BUG-031).
 *
 * `GoalVisual.identityKey` was already a content address: it is the hosted
 * provider's id for the image generated from (project key, accepted context
 * label), so two Sessions pursuing the same goal share one. It was simply
 * never used as one — the 265 KB `dataUrl` rode inline in the persisted tab.
 *
 * The layout now persists a REFERENCE (`identityKey`, `revision`, `state`) and
 * the pixels live here, written once per identity and read on demand. A
 * layout save therefore no longer scales with the number of goal visuals.
 *
 * Size class: at most `MAX_GOAL_VISUALS` entries and `MAX_GOAL_VISUAL_BYTES`,
 * evicted oldest-first, with `sweep()` retaining exactly what a persisted
 * layout references (plus a grace window for a visual generated between two
 * saves). The eviction owner is the workspace save path, which is the only
 * place that knows the full referenced set.
 */

/** Twenty Sessions' worth at the 2 MB per-visual cap, with headroom. */
export const MAX_GOAL_VISUALS = 64;
export const MAX_GOAL_VISUAL_BYTES = 48 * 1024 * 1024;

let store: ContentStore | null = null;

export function goalVisualStore(): ContentStore {
  store ??= new ContentStore({
    directory: () => path.join(app.getPath('userData'), 'goal-visuals'),
    maxEntries: MAX_GOAL_VISUALS,
    maxBytes: MAX_GOAL_VISUAL_BYTES,
  });
  return store;
}

/** Test seam: replace the process-wide store. */
export function setGoalVisualStore(replacement: ContentStore | null): void {
  store = replacement;
}

/** Persist a ready visual's pixels. A non-ready visual has none to persist. */
export async function retainGoalVisual(visual: GoalVisual): Promise<void> {
  if (visual.state !== 'ready' || !visual.dataUrl) return;
  await goalVisualStore().write(visual.identityKey, visual.dataUrl);
}

/**
 * Rebuild a full `GoalVisual` from a persisted reference.
 *
 * A reference whose pixels are gone (evicted, or a fresh machine restoring a
 * synced layout) degrades to `fallback` rather than claiming `ready` with no
 * image — `validGoalVisual` in the context summarizer would refuse the latter
 * outright, which would silently drop the Session's identity.
 */
export async function hydrateGoalVisual(
  candidate: unknown
): Promise<GoalVisual | null> {
  if (!candidate || typeof candidate !== 'object') return null;
  const reference = candidate as Partial<GoalVisual>;
  if (typeof reference.identityKey !== 'string' || !reference.identityKey) {
    return null;
  }
  if (!Number.isInteger(reference.revision)) return null;
  // A layout written before this change still carries its pixels inline.
  // Accept them, and let the migration on load be what removes them.
  if (reference.state === 'ready' && typeof reference.dataUrl === 'string') {
    return reference as GoalVisual;
  }
  if (reference.state !== 'ready') {
    return {
      identityKey: reference.identityKey,
      revision: reference.revision as number,
      state: reference.state ?? 'fallback',
      dataUrl: null,
    };
  }
  const dataUrl = await goalVisualStore().read(reference.identityKey);
  return {
    identityKey: reference.identityKey,
    revision: reference.revision as number,
    state: dataUrl ? 'ready' : 'fallback',
    dataUrl: dataUrl ?? null,
  };
}

interface LayoutTab {
  goalVisual?: unknown;
}

function tabsOf(state: unknown): LayoutTab[] {
  if (typeof state !== 'object' || state === null) return [];
  const projects = (state as { projects?: unknown }).projects;
  if (!Array.isArray(projects)) return [];
  const out: LayoutTab[] = [];
  for (const project of projects) {
    if (typeof project !== 'object' || project === null) continue;
    const tabs = (project as { tabs?: unknown }).tabs;
    if (!Array.isArray(tabs)) continue;
    for (const tab of tabs) {
      if (typeof tab === 'object' && tab !== null) out.push(tab as LayoutTab);
    }
  }
  return out;
}

/** Every `identityKey` a persisted layout still refers to. */
export function referencedGoalVisualKeys(state: unknown): string[] {
  const keys: string[] = [];
  for (const tab of tabsOf(state)) {
    const visual = tab.goalVisual as { identityKey?: unknown } | null;
    if (visual && typeof visual.identityKey === 'string') {
      keys.push(visual.identityKey);
    }
  }
  return keys;
}

/**
 * Move inline `dataUrl`s out of a loaded layout and into the side store,
 * mutating `state` in place. Returns whether anything moved, so the caller can
 * rewrite the (now small) layout immediately.
 *
 * This is the operator's 4.84 MB `workspace.json`. His visuals survive: each
 * one is written under its identity key BEFORE the field is dropped, and a
 * write that fails leaves the inline copy in place rather than losing it.
 */
export async function migrateInlineGoalVisuals(
  state: unknown
): Promise<{ migrated: number; bytesReclaimed: number }> {
  let migrated = 0;
  let bytesReclaimed = 0;
  for (const tab of tabsOf(state)) {
    const visual = tab.goalVisual as Partial<GoalVisual> | null | undefined;
    if (!visual || typeof visual !== 'object') continue;
    if (typeof visual.dataUrl !== 'string' || !visual.dataUrl) continue;
    if (typeof visual.identityKey !== 'string' || !visual.identityKey) continue;
    const dataUrl = visual.dataUrl;
    await goalVisualStore().write(visual.identityKey, dataUrl);
    const stored = await goalVisualStore().read(visual.identityKey);
    if (stored !== dataUrl) continue; // keep the inline copy; nothing is lost
    delete (visual as { dataUrl?: unknown }).dataUrl;
    migrated += 1;
    bytesReclaimed += dataUrl.length;
  }
  return { migrated, bytesReclaimed };
}

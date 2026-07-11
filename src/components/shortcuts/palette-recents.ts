/**
 * Palette recents (ENG-016 D9): a small frecency record of ⌘K selections so
 * an empty palette leads with what the operator actually uses. Stored in
 * localStorage under stable ids — manifest surfaces (`nav-terminal`),
 * Projects by directory (`project:/path`), launch and workspace verbs.
 * Volatile rows (live sessions) are deliberately not tracked: the Sessions
 * group already ranks needs-you-first.
 */

const STORAGE_KEY = 'exawatt:palette-recents';
const MAX_TRACKED = 30;
/** frecency half-life: a use loses half its weight per week */
const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

export interface PaletteUse {
  id: string;
  at: number;
  count: number;
}

/** Pure frecency ranking: use-count decayed by recency. */
export function rankRecents(
  entries: PaletteUse[],
  now: number,
  limit = 5
): string[] {
  return entries
    .map(e => ({
      id: e.id,
      score: e.count * Math.pow(0.5, Math.max(0, now - e.at) / HALF_LIFE_MS),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(e => e.id);
}

/** Tolerant read — a corrupt or missing record is just an empty history. */
export function readPaletteUses(): PaletteUse[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is PaletteUse =>
        !!e &&
        typeof e === 'object' &&
        typeof e.id === 'string' &&
        typeof e.at === 'number' &&
        typeof e.count === 'number'
    );
  } catch {
    return [];
  }
}

export function recordPaletteUse(id: string, now = Date.now()): void {
  if (typeof window === 'undefined') return;
  try {
    const entries = readPaletteUses();
    const existing = entries.find(e => e.id === id);
    const next = existing
      ? entries.map(e => (e.id === id ? { ...e, at: now, count: e.count + 1 } : e))
      : [...entries, { id, at: now, count: 1 }];
    next.sort((a, b) => b.at - a.at);
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(next.slice(0, MAX_TRACKED))
    );
  } catch {
    // storage full / denied — recents are a nicety, never an error
  }
}

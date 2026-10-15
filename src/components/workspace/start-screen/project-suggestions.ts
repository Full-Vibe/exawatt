/**
 * What the renderer derives from the harness project suggestions (ENG-046
 * O2): which rows are recent, which engine a row recommends, and the one line
 * that says where the rows came from. Pure, so the Start screen and the ⌘N
 * chooser cannot disagree.
 */
import type {
  AgentSourceRegistrySnapshot,
  AgentSourceSnapshot,
} from '@exawatt/core';
import type {
  HarnessProjectSuggestion,
  HarnessStoreRead,
  ProjectSuggestionHarness,
} from '@exawatt/core/desktop-bridge';
import type { AgentSourceId } from '../agent-sources';
import { describeUnreadableStore, harnessStoreName } from './store-names';

export { harnessStoreName };

/** The rows the section shows by default, and the ones behind "Show older". */
export function splitByRecency(
  suggestions: readonly HarnessProjectSuggestion[]
): {
  recent: HarnessProjectSuggestion[];
  older: HarnessProjectSuggestion[];
} {
  const recent: HarnessProjectSuggestion[] = [];
  const older: HarnessProjectSuggestion[] = [];
  for (const suggestion of suggestions) {
    (suggestion.recent ? recent : older).push(suggestion);
  }
  return { recent, older };
}

/** A source this machine can start an Agent with right now. */
function launchable(source: AgentSourceSnapshot): boolean {
  return (
    source.harness !== null &&
    source.capabilities.interactiveLaunch &&
    source.state !== 'not-installed' &&
    source.launchable
  );
}

/**
 * The engine an opened suggestion recommends: the most recent harness that
 * knows the folder and can launch here. A harness that is not installed is
 * never recommended; with none, the composer keeps its own recommendation.
 */
export function suggestedSource(
  suggestion: Pick<HarnessProjectSuggestion, 'harnesses'>,
  registry: AgentSourceRegistrySnapshot
): AgentSourceId | undefined {
  for (const harness of suggestion.harnesses) {
    const snapshot = registry.sources.find(
      source => source.harness === harness
    );
    if (snapshot && launchable(snapshot)) return harness;
  }
  return undefined;
}

/** The harnesses that contributed at least one row, in a stable order. */
export function contributingHarnesses(
  suggestions: readonly HarnessProjectSuggestion[]
): ProjectSuggestionHarness[] {
  const seen = new Set<ProjectSuggestionHarness>();
  for (const suggestion of suggestions) {
    for (const harness of suggestion.harnesses) seen.add(harness);
  }
  return (['claude', 'codex', 'antigravity'] as const).filter(harness =>
    seen.has(harness)
  );
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: readonly string[], conjunction: string) {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} ${conjunction} ${names.at(-1)}`;
}

/**
 * The one line under "Your projects" (operator, 2026-10-15: "make sure it's
 * very clear what's happening to the user"): where the rows come from, and
 * that opening one changes nothing in the apps that listed it.
 */
export function provenanceLine(
  suggestions: readonly HarnessProjectSuggestion[]
): string | null {
  const names = contributingHarnesses(suggestions).map(harnessStoreName);
  if (names.length === 0) return null;
  return `Found in ${joinNames(names, 'and')} on this Mac. Opening one adds it to Exawatt and changes nothing in ${joinNames(names, 'or')}.`;
}

/** Each store that exists and could not be read, as one short line. A
 *  missing store is a fact (the harness never ran) and says nothing. */
export function unreadableStoreLines(
  stores: readonly HarnessStoreRead[]
): string[] {
  return stores
    .filter(store => store.status === 'unreadable')
    .map(describeUnreadableStore);
}

/** `/Users/<name>/x` reads as `~/x`; anything else is shown as stored. */
export function displayPath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, '~');
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Relative activity in the chooser's register: short, lower case. */
export function relativeActivity(timestamp: number, now: number): string {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < HOUR)
    return `${Math.max(1, Math.round(elapsed / MINUTE))}m ago`;
  if (elapsed < DAY) return `${Math.round(elapsed / HOUR)}h ago`;
  if (elapsed < 2 * DAY) return 'yesterday';
  if (elapsed < 14 * DAY) return `${Math.round(elapsed / DAY)}d ago`;
  if (elapsed < 120 * DAY) return `${Math.round(elapsed / (7 * DAY))}w ago`;
  return `${Math.round(elapsed / (30 * DAY))}mo ago`;
}

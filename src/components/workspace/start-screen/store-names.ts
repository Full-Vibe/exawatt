import type {
  HarnessProjectStore,
  HarnessStoreRead,
  ProjectSuggestionHarness,
} from '@exawatt/core/desktop-bridge';

/**
 * The app each store belongs to, by its product name. Antigravity keeps its
 * name here even where the source reads "Gemini": the store is Antigravity
 * CLI's own files, and that is the app the user would look in.
 */
const HARNESS_STORE_NAMES: Record<ProjectSuggestionHarness, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  antigravity: 'Antigravity',
};

export function harnessStoreName(harness: ProjectSuggestionHarness): string {
  return HARNESS_STORE_NAMES[harness];
}

const STORE_NOUNS: Record<HarnessProjectStore, string> = {
  'claude-code-config': 'project list',
  'claude-code-transcripts': 'conversation history',
  'codex-config': 'trusted projects',
  'codex-sessions': 'session history',
  'antigravity-projects': 'project files',
  'antigravity-conversations': 'conversation index',
};

/** "Claude Code's project list could not be read (permission denied)." */
export function describeUnreadableStore(store: HarnessStoreRead): string {
  const reason = store.reason ? ` (${store.reason})` : '';
  return `${harnessStoreName(store.harness)}’s ${STORE_NOUNS[store.store]} could not be read${reason}.`;
}

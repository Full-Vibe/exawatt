/** Known layout versions can contain source fields introduced by a newer
 * build. Keep their JSON without interpreting it as runtime configuration.
 * Canonical fields and prototype keys can never enter this extension bag. */
const SESSION_FIELDS = new Set<string>([
  'kind',
  'id',
  'durableSessionId',
  'harness',
  'title',
  'titleKind',
  'cwd',
  'sessionId',
  'harnessSessionId',
  'roadmapItemId',
  'lifecycle',
  'exitCode',
  'exitSignal',
  'initialTask',
  'startedAt',
  'contextSummary',
  'goalVisual',
  'attention',
  'resumeAfterRestart',
  'draftTask',
  'draftSource',
  'launchModel',
  'launchEffort',
  'draftModel',
  'draftEffort',
  'draftTouched',
  'draftWorktree',
  'draftBranch',
  'draftRoadmapItemId',
  'sourceRecordExtensions',
]);
const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);

export function safeSourceExtensions(
  extensions: Readonly<Record<string, unknown>> | undefined
): Record<string, unknown> {
  const retained: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extensions ?? {})) {
    if (SESSION_FIELDS.has(key) || RESERVED.has(key)) continue;
    // Disk/IPC records contain JSON, never live objects or executable values.
    // Clone at the boundary so opaque extensions cannot alias mutable UI state.
    const json = JSON.stringify(value);
    if (json === undefined)
      throw new Error('Saved Session extension is not JSON');
    retained[key] = JSON.parse(json) as unknown;
  }
  return retained;
}

/** Canonical fields are interpreted by the supported workspace decoder. */
export function isCanonicalSessionRecordField(key: string): boolean {
  return SESSION_FIELDS.has(key);
}

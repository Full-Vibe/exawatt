import type {
  AgentModelCatalog,
  PtyCreateOptions,
  PtySessionRecord,
  SessionModelChange,
} from '@exawatt/core/desktop-bridge';

interface ModelChangePorts {
  session(id: string): PtySessionRecord | undefined;
  available(id: string): boolean;
  catalog(session: PtySessionRecord): Promise<AgentModelCatalog>;
  restart(id: string, choice: SessionModelChange): Promise<PtySessionRecord>;
}

/** Validate before stopping anything, then recheck live truth after discovery.
 * One flight per runtime prevents two controls from resuming the same identity. */
export function createSessionModelChanger(ports: ModelChangePorts) {
  const pending = new Set<string>();
  return async (id: string, choice: SessionModelChange) => {
    if (pending.has(id))
      throw new Error('A model change is already in progress.');
    const session = ports.session(id);
    if (!session || session.exited || !session.harnessSessionId)
      throw new Error(
        'An active Session with a saved conversation is required.'
      );
    if (session.harness !== 'claude' && session.harness !== 'codex')
      throw new Error('Change the model inside this Agent Source.');
    if (!ports.available(id))
      throw new Error('Wait until the Agent and its delegated work finish.');
    if (
      !choice ||
      typeof choice.model !== 'string' ||
      (choice.effort !== undefined && typeof choice.effort !== 'string')
    )
      throw new Error('Invalid model selection.');
    pending.add(id);
    try {
      const catalog = await ports.catalog(session);
      const model = catalog.models.find(item => item.id === choice.model);
      if (!model || catalog.selectionAction === 'choose-in-source')
        throw new Error(
          'That model is no longer available. Reopen the model selector.'
        );
      if (
        choice.effort &&
        (catalog.effortLocked ||
          !model.efforts.some(item => item.id === choice.effort))
      )
        throw new Error('That effort level cannot be applied to this model.');
      const current = ports.session(id);
      if (
        !current ||
        current.exited ||
        current.harnessSessionId !== session.harnessSessionId ||
        !ports.available(id)
      )
        throw new Error(
          'The Session changed. Wait for it to finish and try again.'
        );
      return await ports.restart(id, choice);
    } finally {
      pending.delete(id);
    }
  };
}

/** Resume carries the launch policy, but never resends the initial task. */
export function modelChangeResumeOptions(
  session: PtySessionRecord,
  original: PtyCreateOptions,
  choice: SessionModelChange
): PtyCreateOptions {
  if (!session.harnessSessionId) throw new Error('Missing saved conversation.');
  return {
    harness: session.harness,
    cwd: session.cwd,
    cols: session.cols,
    rows: session.rows,
    title: session.title,
    durableSessionId: session.durableSessionId,
    resumeSessionId: session.harnessSessionId,
    permissionMode: original.permissionMode,
    statedTask: original.initialPrompt ?? original.statedTask,
    restoredSubtitle: original.restoredSubtitle,
    model: choice.model,
    effort: choice.effort,
  };
}

import { app, BrowserWindow, shell } from 'electron';
import { broadcastToWindows } from './window-broadcast';
import { delegationObservations } from './harness-events/delegation-observation';
import { isAgentSourceAdapterId, type AgentSourceAction } from '@exawatt/core';
import { handleTrusted } from './ipc-security';
import {
  inspectAgentSources,
  launchSourceOwnedAction,
  rememberedAgentSources,
  setAgentSourceObservationStore,
} from './pty/agent-source-registry';
import { AgentSourceObservationStore } from './pty/agent-source-observation-store';
import { defaultShell } from './pty/session-manager';
import { agentSourceDeclaration } from './pty/generated-agent-source-declarations';

// The last complete observation of every source outlives the process, so a
// ⌘T after a restart (or five seconds after the last one) paints from memory
// and revalidates behind it (BUG-062). Installed at module load for the same
// reason the model-catalog cache is: main.ts overrides userData before
// importing any IPC module.
setAgentSourceObservationStore(
  new AgentSourceObservationStore(() => app.getPath('userData'))
);

function validScope(scope: unknown): 'all' | 'launch' {
  if (scope !== 'all' && scope !== 'launch') {
    throw new Error('Invalid Agent Source scope');
  }
  return scope;
}

/**
 * Renderer-safe Agent Source control plane (ENG-003 S1).
 *
 * Discovery, credentials, CLI output, and source-specific commands remain in
 * Electron main. The renderer receives only normalized facts and invokes a
 * small source-owned action vocabulary.
 */
export function registerAgentSourcesIPC(): void {
  delegationObservations.on('changed', (adapterId, fact) => {
    broadcastToWindows(
      BrowserWindow.getAllWindows(),
      'agent-sources:delegation',
      { adapterId, fact }
    );
  });
  handleTrusted(
    'agent-sources:list',
    async (_event, scope: 'all' | 'launch' = 'all', refresh = false) => {
      if (typeof refresh !== 'boolean') {
        throw new Error('Invalid Agent Source refresh request');
      }
      return inspectAgentSources(
        await defaultShell(),
        validScope(scope),
        refresh
      );
    }
  );

  // No probe, no login shell: what this machine last observed, for the
  // surface to paint immediately while `agent-sources:list` revalidates.
  handleTrusted(
    'agent-sources:remembered',
    async (_event, scope: 'all' | 'launch' = 'all') =>
      rememberedAgentSources(await defaultShell(), validScope(scope))
  );

  handleTrusted(
    'agent-sources:act',
    async (_event, adapterId: unknown, action: AgentSourceAction) => {
      if (!isAgentSourceAdapterId(adapterId)) {
        throw new Error('Unsupported Agent Source');
      }
      if (
        action !== 'authenticate' &&
        action !== 'choose-model' &&
        action !== 'install-guide'
      ) {
        throw new Error('Unsupported Agent Source action');
      }
      const declaration = agentSourceDeclaration(adapterId);
      if (action === 'install-guide') {
        if (!declaration.installationGuideUrl) {
          throw new Error('This Agent Source has no installation guide');
        }
        await shell.openExternal(declaration.installationGuideUrl);
        return {
          ok: true,
          message: `${declaration.label} installation guide opened.`,
        };
      }
      // Sign-in and model choice run the source's own CLI, so only a source
      // with a local harness has them.
      const harness = declaration.harness;
      if (harness === null) {
        throw new Error('This Agent Source does not expose that action');
      }
      if (action === 'choose-model' && harness !== 'claude') {
        throw new Error('This source exposes its model catalog in Exawatt');
      }
      return launchSourceOwnedAction(harness, action);
    }
  );
}

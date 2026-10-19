import { app, BrowserWindow, shell } from 'electron';
import { broadcastToWindows } from './window-broadcast';
import { delegationObservations } from './harness-events/delegation-observation';
import { handleBounded } from './ipc-arguments';
import {
  inspectAgentSources,
  rememberedAgentSources,
  setAgentSourceObservationStore,
} from './pty/agent-source-registry';
import { AgentSourceObservationStore } from './pty/agent-source-observation-store';
import { defaultShell } from './pty/login-shell';
import { agentSourceDeclaration } from './pty/generated-agent-source-declarations';

// The last complete observation of every source outlives the process, so a
// ⌘T after a restart (or five seconds after the last one) paints from memory
// and revalidates behind it (BUG-062). Installed at module load for the same
// reason the model-catalog cache is: main.ts overrides userData before
// importing any IPC module.
setAgentSourceObservationStore(
  new AgentSourceObservationStore(() => app.getPath('userData'))
);

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
  handleBounded('agent-sources:list', async (_event, scope, refresh) =>
    inspectAgentSources(await defaultShell(), scope, refresh)
  );

  // No probe, no login shell: what this machine last observed, for the
  // surface to paint immediately while `agent-sources:list` revalidates.
  handleBounded('agent-sources:remembered', async (_event, scope) =>
    rememberedAgentSources(await defaultShell(), scope)
  );

  // The one action main performs for a source. Sign-in and model choice
  // are declared shell actions the renderer opens in an Exawatt Shell
  // (BUG-275): nothing here drives another app.
  handleBounded('agent-sources:act', async (_event, adapterId, action) => {
    const declaration = agentSourceDeclaration(adapterId);
    if (action !== 'install-guide' || !declaration.installationGuideUrl) {
      throw new Error('This Agent Source has no installation guide');
    }
    await shell.openExternal(declaration.installationGuideUrl);
    return {
      ok: true,
      message: `${declaration.label} installation guide opened.`,
    };
  });
}

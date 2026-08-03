import { handleTrusted } from './ipc-security';
import {
  inspectAgentSources,
  launchSourceOwnedAction,
} from './pty/agent-source-registry';
import { defaultShell } from './pty/session-manager';
import type { AgentHarness } from './pty/harness-types';

/**
 * Renderer-safe Agent Source control plane (ENG-003 S1).
 *
 * Discovery, credentials, CLI output, and source-specific commands remain in
 * Electron main. The renderer receives only normalized facts and invokes a
 * small source-owned action vocabulary.
 */
export function registerAgentSourcesIPC(): void {
  handleTrusted(
    'agent-sources:list',
    async (_event, scope: 'all' | 'launch' = 'all', refresh = false) => {
      if (scope !== 'all' && scope !== 'launch') {
        throw new Error('Invalid Agent Source scope');
      }
      if (typeof refresh !== 'boolean') {
        throw new Error('Invalid Agent Source refresh request');
      }
      return inspectAgentSources(await defaultShell(), scope, refresh);
    }
  );

  handleTrusted(
    'agent-sources:act',
    async (
      _event,
      harness: AgentHarness,
      action: 'authenticate' | 'choose-model'
    ) => {
      if (harness !== 'claude' && harness !== 'codex') {
        throw new Error('Unsupported Agent Source');
      }
      if (action !== 'authenticate' && action !== 'choose-model') {
        throw new Error('Unsupported Agent Source action');
      }
      if (action === 'choose-model' && harness !== 'claude') {
        throw new Error('This source exposes its model catalog in Exawatt');
      }
      return launchSourceOwnedAction(harness, action);
    }
  );
}

import { shell } from 'electron';
import type { AgentSourceAction, AgentSourceAdapterId } from '@exawatt/core';
import { handleTrusted } from './ipc-security';
import {
  inspectAgentSources,
  launchSourceOwnedAction,
} from './pty/agent-source-registry';
import { defaultShell } from './pty/session-manager';
import type { AgentHarness } from './pty/harness-types';
import { agentSourceDeclaration } from './pty/generated-agent-source-declarations';

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
      adapterId: AgentSourceAdapterId,
      action: AgentSourceAction
    ) => {
      if (
        adapterId !== 'claude' &&
        adapterId !== 'codex' &&
        adapterId !== 'openclaw' &&
        adapterId !== 'demo'
      ) {
        throw new Error('Unsupported Agent Source');
      }
      if (
        action !== 'authenticate' &&
        action !== 'choose-model' &&
        action !== 'install-guide'
      ) {
        throw new Error('Unsupported Agent Source action');
      }
      if (action === 'install-guide') {
        const declaration = agentSourceDeclaration(adapterId);
        if (!declaration.installationGuideUrl) {
          throw new Error('This Agent Source has no installation guide');
        }
        await shell.openExternal(declaration.installationGuideUrl);
        return {
          ok: true,
          message: `${declaration.label} installation guide opened.`,
        };
      }
      if (adapterId !== 'claude' && adapterId !== 'codex') {
        throw new Error('This Agent Source does not expose that action');
      }
      if (action === 'choose-model' && adapterId !== 'claude') {
        throw new Error('This source exposes its model catalog in Exawatt');
      }
      return launchSourceOwnedAction(adapterId as AgentHarness, action);
    }
  );
}

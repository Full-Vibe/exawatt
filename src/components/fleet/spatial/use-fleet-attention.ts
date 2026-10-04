'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import {
  nextAttentionTarget,
  orderedAttentionTargets,
  type ExawattAgent,
  type SessionAttentionSignal,
} from '@exawatt/core';
import { shortcutRegistry } from '@/lib/shortcuts';
import { eventToBinding } from '@/lib/shortcuts/format';
import { isOpenModalShortcutTarget } from '@/lib/shortcuts/chord-engine';
import { bindingsMatch, isChord } from '@/types/shortcuts';
import { JUMP_ATTENTION_EVENT } from '@/components/workspace/session-jump';
import {
  EMPTY_WORKSPACE_COMMAND_AVAILABILITY,
  publishWorkspaceCommandAvailability,
  resetWorkspaceCommandAvailability,
} from '@/components/workspace/workspace-command-availability';

/** Source records select work; geometry budgets and work-state glyphs do not.
 * The caller supplies the filtered corpus, so a hidden filter match is never
 * selected behind the operator's back. */
export function fleetAttentionSignals(
  agents: Readonly<Record<string, ExawattAgent>>
): Record<string, SessionAttentionSignal> {
  return Object.fromEntries(
    Object.values(agents)
      .filter(agent => agent.sessionKey && agent.attention)
      .map(agent => [agent.id, agent.attention!])
  );
}

/** Fleet owns the same registered attention command while its route is mounted.
 * Selection enters the existing Agent follow view. Focus goes to its existing
 * Open Session control, making Enter the usual accessible activation path. */
export function useFleetAttention({
  agents,
  selectedAgentId,
  onSelectAgent,
}: {
  agents: Readonly<Record<string, ExawattAgent>>;
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
}): void {
  const signals = useMemo(() => fleetAttentionSignals(agents), [agents]);
  const targets = useMemo(
    () => orderedAttentionTargets(signals, null),
    [signals]
  );
  const pass = useRef<ReadonlyMap<string, string>>(new Map());
  const pendingFocus = useRef<string | null>(null);
  const jump = useCallback(() => {
    const next = nextAttentionTarget(
      targets,
      selectedAgentId,
      pass.current,
      signals
    );
    pass.current = next.visited;
    if (!next.target) return false;
    pendingFocus.current = next.target;
    onSelectAgent(next.target);
    return true;
  }, [onSelectAgent, selectedAgentId, signals, targets]);

  useLayoutEffect(() => {
    const id = pendingFocus.current;
    if (!id || id !== selectedAgentId) return;
    // Agent ids are opaque source data, never interpolated into a CSS selector.
    const button = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[data-open-agent]')
    ).find(element => element.dataset.openAgent === id);
    if (button) {
      button.focus({ preventScroll: true });
      pendingFocus.current = null;
    }
  }, [selectedAgentId]);

  const available = targets.some(id => id !== selectedAgentId);
  useEffect(() => {
    publishWorkspaceCommandAvailability({
      ...EMPTY_WORKSPACE_COMMAND_AVAILABILITY,
      commands: {
        ...EMPTY_WORKSPACE_COMMAND_AVAILABILITY.commands,
        'jump-attention': {
          available,
          reason: available ? null : 'No other visible Sessions need attention',
        },
      },
    });
  }, [available]);
  useEffect(() => resetWorkspaceCommandAvailability, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        shortcutRegistry.getActiveContexts().includes('modal-open') ||
        isOpenModalShortcutTarget(event.target)
      )
        return;
      const element = event.target instanceof Element ? event.target : null;
      if (
        element?.closest(
          'input, textarea, select, [contenteditable="true"], [cmdk-input]'
        )
      )
        return;
      const keys = shortcutRegistry.getEffectiveKeys(
        'workspace-jump-attention'
      );
      if (!keys || isChord(keys) || !bindingsMatch(keys, eventToBinding(event)))
        return;
      if (jump()) event.preventDefault();
    };
    const onCommand = () => {
      if (
        !shortcutRegistry.getActiveContexts().includes('modal-open') &&
        !isOpenModalShortcutTarget(document.activeElement)
      )
        jump();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener(JUMP_ATTENTION_EVENT, onCommand);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(JUMP_ATTENTION_EVENT, onCommand);
    };
  }, [jump]);
}

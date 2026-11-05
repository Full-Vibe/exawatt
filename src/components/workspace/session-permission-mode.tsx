'use client';

import type { AgentPermissionMode } from '@exawatt/core';
import {
  AGENT_PERMISSION_MODE_META,
  DEFAULT_AGENT_PERMISSION_MODE,
} from './agent-sources';
import { cn } from '@/lib/utils';

/**
 * The permission mode a running Agent was started in, as Exawatt state
 * (BUG-331). Exawatt starts Agents in YOLO by default, and a harness names
 * that mode in its own words in the terminal below ("bypass permissions
 * on"); a new user read that line as an outdated harness. Beside the
 * Agent's model, this says which mode it is and that it is Exawatt's
 * default, so the terminal's line reads as the choice it is.
 */
export function SessionPermissionMode({
  mode,
}: {
  /** From the live Session record; absent before main reports it. */
  mode: AgentPermissionMode | undefined;
}) {
  if (!mode) return null;
  const meta = AGENT_PERMISSION_MODE_META[mode];
  const isDefault = mode === DEFAULT_AGENT_PERMISSION_MODE;
  const statement = `Started in ${meta.label}${
    isDefault ? ', the Exawatt default' : ''
  }. ${meta.description}`;
  return (
    <span
      role="note"
      data-session-permission-mode={mode}
      data-default={isDefault || undefined}
      aria-label={statement}
      title={statement}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 font-mono text-chrome-micro leading-none',
        mode === 'unrestricted'
          ? 'border-hud-amber/35'
          : 'border-hud-stroke-faint'
      )}
    >
      <span className="text-hud-text">{meta.label}</span>
      {isDefault ? <span className="text-hud-text-dim">default</span> : null}
    </span>
  );
}

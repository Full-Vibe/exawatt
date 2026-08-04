// Named as a DOM suite because launch verbs dispatch browser events.
/**
 * Tenant gate on the launch verb family (ENG-027 closing fixes).
 *
 * A verb invoked while a non-personal Workspace is on screen must be inert:
 * no live event, and — the dangerous half — no pending slot that fires a
 * shell/composer/reopen against Personal local truth after the next tenant
 * switch. The gate lives in the request functions themselves so every
 * dispatch path (native menu, ⌘K palette, future callers) fails closed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishActiveTenantKind } from '@/lib/tenancy/active-tenant';
import {
  FOCUS_AGENT_COMPOSER_EVENT,
  LAUNCH_EVENT,
  OPEN_PROJECT_EVENT,
  OPEN_PROJECT_PICKER_EVENT,
  REOPEN_LAST_CLOSED_EVENT,
  SESSION_JUMP_EVENT,
  consumePendingAgentComposer,
  consumePendingLaunch,
  consumePendingOpenProject,
  consumePendingProjectPicker,
  consumePendingReopenLastClosed,
  consumePendingSessionJump,
  requestAgentComposer,
  requestLaunch,
  requestOpenProject,
  requestProjectPicker,
  requestReopenLastClosed,
  requestSessionJump,
} from './session-jump';

function drainAllSlots() {
  consumePendingLaunch();
  consumePendingAgentComposer();
  consumePendingOpenProject();
  consumePendingProjectPicker();
  consumePendingReopenLastClosed();
  consumePendingSessionJump();
}

const LAUNCH_EVENTS = [
  LAUNCH_EVENT,
  FOCUS_AGENT_COMPOSER_EVENT,
  OPEN_PROJECT_EVENT,
  OPEN_PROJECT_PICKER_EVENT,
  REOPEN_LAST_CLOSED_EVENT,
];

describe('session-jump launch verbs under tenant scope', () => {
  const seen: string[] = [];
  const listeners = new Map<string, () => void>();

  beforeEach(() => {
    drainAllSlots();
    seen.length = 0;
    for (const event of [...LAUNCH_EVENTS, SESSION_JUMP_EVENT]) {
      const listener = () => seen.push(event);
      listeners.set(event, listener);
      window.addEventListener(event, listener);
    }
  });

  afterEach(() => {
    for (const [event, listener] of listeners) {
      window.removeEventListener(event, listener);
    }
    listeners.clear();
    publishActiveTenantKind('personal');
    drainAllSlots();
    vi.useRealTimers();
  });

  function invokeLaunchFamily() {
    requestLaunch('shell');
    requestAgentComposer('claude');
    requestOpenProject('/tmp/project');
    requestProjectPicker();
    requestReopenLastClosed();
  }

  it('works normally in the Personal tenant', () => {
    publishActiveTenantKind('personal');
    invokeLaunchFamily();

    expect(seen).toEqual(LAUNCH_EVENTS);
    expect(consumePendingLaunch()).toBe('shell');
    expect(consumePendingAgentComposer()).toBe('claude');
    expect(consumePendingOpenProject()).toBe('/tmp/project');
    expect(consumePendingProjectPicker()).toBe(true);
    expect(consumePendingReopenLastClosed()).toBe(true);
  });

  it('stores no pending slot and fires no event from the Demo tenant', () => {
    publishActiveTenantKind('demo');
    invokeLaunchFamily();

    expect(seen).toEqual([]);
    expect(consumePendingLaunch()).toBeNull();
    expect(consumePendingAgentComposer()).toBeUndefined();
    expect(consumePendingOpenProject()).toBeNull();
    expect(consumePendingProjectPicker()).toBe(false);
    expect(consumePendingReopenLastClosed()).toBe(false);
  });

  it('a slot cannot survive a Demo-tenant invocation into Personal (the switch-back leak)', () => {
    publishActiveTenantKind('demo');
    requestLaunch('shell');
    requestAgentComposer('codex');

    // Switch back to Personal: nothing may replay.
    publishActiveTenantKind('personal');
    expect(consumePendingLaunch()).toBeNull();
    expect(consumePendingAgentComposer()).toBeUndefined();
  });

  it('session jumps stay live in every tenant (the Demo board depends on them)', () => {
    publishActiveTenantKind('demo');
    requestSessionJump('vgs-dispatch-fanout-3');

    expect(seen).toEqual([SESSION_JUMP_EVENT]);
    expect(consumePendingSessionJump()).toBe('vgs-dispatch-fanout-3');
  });
});

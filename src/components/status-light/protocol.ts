/**
 * The compact, source-agnostic signal shown when an Agent needs to be read at
 * a glance. This is deliberately derived UI state, not a replacement for the
 * Agent lifecycle, Session turn state, blocker detail, or Attention record.
 *
 * These five are the LIT vocabulary: each one is something a source said. The
 * array is the vocabulary and the union is read off it, so a sixth signal is
 * one edit here that then fails to compile at every consumer.
 */
export const STATUS_LIGHT_STATES = [
  'off',
  'active',
  'result',
  'needs-you',
  'fault',
] as const;

export type StatusLightState = (typeof STATUS_LIGHT_STATES)[number];

/**
 * What the operator can read off the light, which is the five signals plus
 * the one thing none of them can say: nothing was reported (ENG-010).
 *
 * `unreported` is not a sixth light. It is the reading of an Agent whose
 * source evidenced no work state at all, and it exists because `off` was
 * carrying two meanings — an Agent quietly waiting, and an Agent nobody has
 * heard from. Those are opposite claims: one is a report of rest, the other
 * is the absence of a report. Collapsing them is the thing D40 is for.
 *
 * It stays out of `STATUS_LIGHT_STATES` on purpose. Filters, legends, and
 * counts that enumerate the protocol are enumerating what a source can SAY,
 * and silence is not one of the things it can say.
 */
export const STATUS_LIGHT_READINGS = [
  ...STATUS_LIGHT_STATES,
  'unreported',
] as const;

export type StatusLightReading = (typeof STATUS_LIGHT_READINGS)[number];

export interface StatusLightSignals {
  active?: boolean;
  hasResult?: boolean;
  needsOperator?: boolean;
  fault?: boolean;
}

/** One measured revolution for the Active half-fill in every rendering regime. */
export const STATUS_LIGHT_ACTIVE_ROTATION_SECONDS = 2.4;

export const AGENT_STATUS_LIGHT_STATE = {
  idle: 'off',
  working: 'active',
  reviewing: 'active',
  complete: 'result',
  blocked: 'needs-you',
  error: 'fault',
} as const satisfies Record<AgentStatus, StatusLightState>;

export function statusLightStateForAgentStatus(
  status: AgentStatus
): StatusLightState {
  return AGENT_STATUS_LIGHT_STATE[status];
}

/**
 * The reading for a work state that the source may never have reported.
 *
 * This is the door every surface goes through once an `ExawattAgent.status`
 * can be `null`. It is deliberately the ONLY way an absent work state becomes
 * something drawable, so the alternative — quietly defaulting to `idle` and
 * telling the operator an Agent is resting on no evidence at all — has
 * nowhere to be written.
 */
export function workStateReading(
  status: AgentStatus | null | undefined
): StatusLightReading {
  return status == null ? 'unreported' : AGENT_STATUS_LIGHT_STATE[status];
}

/** True for the one reading that is an absence rather than a signal. */
export function isUnreported(reading: StatusLightReading): boolean {
  return reading === 'unreported';
}

export const STATUS_LIGHT_META = {
  off: {
    label: 'Idle',
    protocolLabel: 'Off',
    color: '#DCE5ED',
    sourceColor: '#FFFFFF',
    description: 'Available, new, or quietly waiting.',
    priority: 0,
  },
  active: {
    label: 'Working',
    protocolLabel: 'Active',
    color: '#9CD5FE',
    sourceColor: '#9CD5FE',
    description: 'Reasoning, streaming, or using tools.',
    priority: 1,
  },
  result: {
    label: 'Result ready',
    protocolLabel: 'Result',
    color: '#9BF396',
    sourceColor: '#9BF396',
    description: 'The turn finished and a result is waiting.',
    priority: 2,
  },
  'needs-you': {
    label: 'Needs you',
    protocolLabel: 'Human gate',
    color: '#FFD0B8',
    sourceColor: '#FFD0B8',
    description:
      'Approval, a question, a credential, or a Decision is required.',
    priority: 3,
  },
  fault: {
    label: 'Error',
    protocolLabel: 'Fault',
    color: '#FF7373',
    sourceColor: '#FF7373',
    description: 'Execution failed or intervention is required.',
    priority: 4,
  },
  /**
   * Shares the unlit register's colour on purpose: hue is not where this
   * distinction lives, because an unlit lamp is already the honest paint for
   * a lamp with no reading. The mark and the word carry it instead, so it
   * survives colour being switched off. Priority stays at the floor —
   * silence never outranks something a source actually said.
   */
  unreported: {
    label: 'Not reported',
    protocolLabel: 'Unreported',
    color: '#DCE5ED',
    sourceColor: '#FFFFFF',
    description: 'The source has not reported a work state for this Agent.',
    priority: 0,
  },
} as const satisfies Record<
  StatusLightReading,
  {
    label: string;
    protocolLabel: string;
    color: string;
    sourceColor: string;
    description: string;
    priority: number;
  }
>;

/**
 * The one operator-facing WORD for a D40 signal (ENG-033 H2).
 *
 * The roster has to be readable with the colour switched off. That was always
 * the accessibility requirement, and remote Agents sharpened it: a remote
 * Agent's state cannot be guessed from context the way a local one you just
 * started can, so the mark alone is an assertion of legibility rather than a
 * proof of it. The word is the proof.
 *
 * `STATUS_LIGHT_META` already owns the words the operator reviewed in
 * `/hud-gallery/connected-source`; this is the named door onto them so no
 * surface has to reach into the meta record — or worse, keep its own copy —
 * to write one. `AGENT_STATUS_LIGHT_STATE` projects every `AgentStatus` here,
 * so local and remote Agents get the same six-into-five vocabulary, and
 * `workStateReading` adds the one word for an Agent whose source reported no
 * state at all.
 */
export function statusLightWord(state: StatusLightReading): string {
  return STATUS_LIGHT_META[state].label;
}

/**
 * A single-light priority encoder, matching the physical status-light model.
 * Durable truth stays in its owning models; compact surfaces consume only this
 * deterministic projection.
 */
export function deriveStatusLightState(
  signals: StatusLightSignals
): StatusLightState {
  if (signals.fault) return 'fault';
  if (signals.needsOperator) return 'needs-you';
  if (signals.hasResult) return 'result';
  if (signals.active) return 'active';
  return 'off';
}
import type { AgentStatus } from '@exawatt/core';

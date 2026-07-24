/**
 * The compact, source-agnostic signal shown when an Agent needs to be read at
 * a glance. This is deliberately derived UI state, not a replacement for the
 * Agent lifecycle, Session turn state, blocker detail, or Attention record.
 */
export type StatusLightState =
  | 'off'
  | 'active'
  | 'result'
  | 'needs-you'
  | 'fault';

export interface StatusLightSignals {
  active?: boolean;
  hasResult?: boolean;
  needsOperator?: boolean;
  fault?: boolean;
}

export const STATUS_LIGHT_STATES = [
  'off',
  'active',
  'result',
  'needs-you',
  'fault',
] as const satisfies readonly StatusLightState[];

/** One measured revolution for the Active half-fill in every rendering regime. */
export const STATUS_LIGHT_ACTIVE_ROTATION_SECONDS = 1.6;

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
} as const satisfies Record<
  StatusLightState,
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

import type { StatusLightState } from '@/components/status-light/protocol';

export interface AgentLifePose {
  lift: number;
  yaw: number;
  lean: number;
  pulse: number;
}

/** Local activity, never a new layout: each agent keeps its territory anchor. */
export function sampleAgentLife(
  id: number,
  state: StatusLightState,
  time: number,
  hover: number,
  reduced: boolean,
  out: AgentLifePose
) {
  const phase = id * 2.399963229728653;
  const active = state === 'active',
    attention = state === 'needs-you';
  const moving = !reduced && state !== 'off';
  const breath = moving
    ? Math.sin(time * (active ? 1.8 : attention ? 1.15 : 0.7) + phase)
    : 0;
  out.lift =
    (moving ? (active ? 0.065 : attention ? 0.035 : 0.012) * (1 + breath) : 0) +
    hover * 0.11;
  out.yaw = moving ? Math.sin(time * 0.6 + phase) * (active ? 0.16 : 0.04) : 0;
  out.lean = (moving ? Math.sin(time * 0.9 + phase) * 0.035 : 0) + hover * 0.06;
  out.pulse = moving
    ? 1 + (attention ? 0.28 : active ? 0.15 : 0.08) * breath
    : 1;
}

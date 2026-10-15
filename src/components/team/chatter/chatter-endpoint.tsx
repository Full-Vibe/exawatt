import { UserRound } from 'lucide-react';
import { HarnessGlyph } from '@/components/workspace/harness-icons';
import { WORKSPACE_HUD as HUD } from '@/components/workspace/workspace-theme';
import { BUS_OPERATOR } from '@/lib/bus/operator';
import type { BusEndpoint } from '@/lib/bus/types';

/** How Team names a Session: its tile's label, and its tab when open. */
export interface ChatterParticipant {
  label: string;
  tabId: string | null;
}

export type ChatterParticipants = ReadonlyMap<string, ChatterParticipant>;

export function isOperator(endpoint: BusEndpoint): boolean {
  return endpoint.sessionId === BUS_OPERATOR.sessionId;
}

export function endpointLabel(
  endpoint: BusEndpoint,
  participants: ChatterParticipants
): string {
  if (isOperator(endpoint)) return BUS_OPERATOR.name;
  return participants.get(endpoint.sessionId)?.label ?? endpoint.name;
}

/** A sender or recipient: harness mark (or the operator's) and name. */
export function ChatterEndpoint({
  endpoint,
  participants,
  strong = false,
}: {
  endpoint: BusEndpoint;
  participants: ChatterParticipants;
  strong?: boolean;
}) {
  const operator = isOperator(endpoint);
  return (
    <span
      data-chatter-endpoint={operator ? 'operator' : endpoint.harness}
      className="inline-flex min-w-0 items-center gap-1"
    >
      <span className="shrink-0" aria-hidden>
        {operator ? (
          <UserRound size={11} style={{ color: HUD.cyan }} />
        ) : (
          <HarnessGlyph harness={endpoint.harness} size={11} />
        )}
      </span>
      <span
        className={`min-w-0 truncate ${strong ? 'font-semibold' : 'font-medium'}`}
        style={{ color: operator ? HUD.cyan : HUD.text }}
      >
        {endpointLabel(endpoint, participants)}
      </span>
    </span>
  );
}

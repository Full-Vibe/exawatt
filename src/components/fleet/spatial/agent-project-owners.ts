import type { SpatialProjectZone } from '@exawatt/ui-model';

type ProjectMembership = Pick<SpatialProjectZone, 'clusterId' | 'agentIds'>;

/** Routing depends on membership, not a Project's changing status or usage.
 * Keep the immutable result across equivalent inputs so source ticks do not
 * replace every Agent command callback. Each call still derives current truth. */
export function createAgentProjectOwnersSelector() {
  let previous: ReadonlyMap<string, string> = new Map();
  return (zones: readonly ProjectMembership[]): ReadonlyMap<string, string> => {
    const next = new Map<string, string>();
    for (const zone of zones) {
      for (const agentId of zone.agentIds) {
        // Preserve the existing find-first ownership rule for ambiguous input.
        if (!next.has(agentId)) next.set(agentId, zone.clusterId);
      }
    }
    if (
      previous.size === next.size &&
      [...next].every(
        ([agentId, projectId]) => previous.get(agentId) === projectId
      )
    )
      return previous;
    previous = next;
    return next;
  };
}

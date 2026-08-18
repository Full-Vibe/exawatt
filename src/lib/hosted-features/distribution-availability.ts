import { distributionCapabilities } from '@/lib/distribution/capabilities';
import { resolvedDistribution } from '@/lib/distribution/resolved';
import type { OutboundControl } from './contract';

export type DistributionCapabilityProjection = ReturnType<
  typeof distributionCapabilities
>;

/**
 * Does THIS build carry the capability an outbound control needs?
 *
 * The Privacy surface is the manifest of what Exawatt sends, so a switch on it
 * has to mean something. A control whose capability the distribution never
 * configured has nothing to turn off, and rendering it as an ordinary live
 * toggle is the failure incident `0017` recorded one level up: an absent
 * capability presenting as ordinary product state.
 *
 * The switch is exhaustive on purpose. A new capability in the control
 * contract fails type-check here until its author says what "configured"
 * means for it.
 */
export function isOutboundControlConfigured(
  control: OutboundControl,
  capabilities: DistributionCapabilityProjection = distributionCapabilities(
    resolvedDistribution()
  )
): boolean {
  const required = control.requiresDistributionCapability;
  switch (required) {
    case null:
      return true;
    case 'analytics':
      return capabilities.analytics;
    case 'enrichment.contextLabels':
      return capabilities.enrichment.contextLabels;
    case 'enrichment.conversationSummaries':
      return capabilities.enrichment.conversationSummaries;
    case 'enrichment.goalVisuals':
      return capabilities.enrichment.goalVisuals;
    case 'services.operatorStats':
      return capabilities.services.operatorStats;
    case 'ownAccount.claudePlanUsage':
      return capabilities.ownAccount.claudePlanUsage;
    default: {
      const unreachable: never = required;
      throw new Error(`Unhandled distribution capability: ${unreachable}`);
    }
  }
}

/**
 * Does THIS distribution serve its own `/privacy` and `/terms`?
 *
 * Those pages are legal statements about ONE operator's hosted service: its
 * processors, its contact addresses, its retention. A fork must not inherit
 * them and silently claim that operator runs the fork, so the public tree
 * ships neither page and the company overlay adds them for the official web
 * build (2026-08-18).
 *
 * `brand` is the signal because it is the same declaration that says "this
 * build is somebody's named distribution rather than an unbranded community
 * build". A distributor who brands a build is expected to supply its legal
 * pages; an unbranded build has no operator to write them about, so the link
 * to them does not render. The Privacy surface still states the full outbound
 * behaviour inline, which is the part a user actually needs.
 */
export function servesOwnLegalPages(
  distribution = resolvedDistribution()
): boolean {
  return distribution.brand !== null;
}

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

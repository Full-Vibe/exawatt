import {
  resolveDistributionIdentity,
  type DistributionContractV2,
} from '@exawatt/core/distribution';

export function distributionCapabilities(contract: DistributionContractV2) {
  const identity = resolveDistributionIdentity(contract);
  return {
    analytics: contract.analytics !== null,
    account: contract.account !== null,
    hostedAuth: contract.account?.recoveryOrigin !== undefined,
    updates: contract.updates !== null,
    protocolScheme: identity.protocolScheme,
    enrichment: {
      contextLabels: contract.enrichment.contextLabels !== null,
      conversationSummaries: contract.enrichment.conversationSummaries !== null,
      goalVisuals: contract.enrichment.goalVisuals !== null,
    },
    services: {
      productFeedback: contract.services.productFeedback !== null,
      operatorStats: contract.services.operatorStats !== null,
      projects: contract.services.projects !== null,
      preferences: contract.services.preferences !== null,
      accountData: contract.services.accountData !== null,
    },
  } as const;
}

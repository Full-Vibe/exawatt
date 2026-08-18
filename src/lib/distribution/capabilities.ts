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
    // Not an Exawatt service: this family is traffic to the operator's OWN
    // vendor account, and the contract only declares whether this
    // distribution has the stable signed identity that may carry it
    // automatically (decision `0036` §6).
    ownAccount: {
      claudePlanUsage: contract.ownAccount?.claudePlanUsage === 'stable-signed',
    },
  } as const;
}

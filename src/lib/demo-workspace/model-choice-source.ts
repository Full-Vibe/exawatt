import type { AgentModelCatalog } from '@/types/electron';

/** Demo data only: no provider availability claims and no live commands. */
export async function demoModelCatalog(): Promise<AgentModelCatalog> {
  return {
    harness: 'claude',
    effectiveModel: null,
    effectiveModelLabel: 'Demo',
    effectiveModelSource: 'account-default',
    effectiveEffort: null,
    effectiveEffortLabel: 'Default',
    effectiveEffortSource: 'model-default',
    effortLocked: false,
    catalogMode: 'live-catalog',
    catalogProvenance: 'Demo Mode',
    observedAt: 0,
    selectionAction: null,
    models: ['Fast', 'Balanced', 'Deep'].map(label => ({
      id: `demo-${label.toLowerCase()}`,
      label: `${label} · Demo`,
      description: 'Demo model',
      defaultEffort: 'medium',
      efforts: ['low', 'medium', 'high'].map(id => ({
        id,
        label: id[0].toUpperCase() + id.slice(1),
        description: '',
      })),
    })),
  };
}

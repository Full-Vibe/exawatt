import { describe, expect, it } from 'vitest';
import type { AgentModelCatalog } from '@exawatt/core/desktop-bridge';
import { effortForModel, modelEfforts } from './launch-axes';

const effort = (id: string) => ({ id, label: id, description: '' });

function catalog(
  overrides: Partial<AgentModelCatalog> = {}
): AgentModelCatalog {
  return {
    harness: 'codex',
    effectiveModel: 'astra',
    effectiveModelLabel: 'Astra',
    effectiveModelSource: 'config',
    effectiveEffort: 'medium',
    effectiveEffortLabel: 'Medium',
    effectiveEffortSource: 'config',
    effortLocked: false,
    models: [
      {
        id: 'astra',
        label: 'Astra',
        description: '',
        defaultEffort: 'high',
        efforts: ['low', 'medium', 'high', 'xhigh'].map(effort),
      },
      {
        id: 'sol',
        label: 'Sol',
        description: '',
        defaultEffort: 'medium',
        efforts: ['low', 'medium', 'high', 'max'].map(effort),
      },
      {
        id: 'mini',
        label: 'Mini',
        description: '',
        defaultEffort: null,
        efforts: [],
      },
    ],
    ...overrides,
  } as AgentModelCatalog;
}

describe('launch axes', () => {
  it('offers only the efforts the chosen model declares', () => {
    expect(modelEfforts(catalog(), 'sol').map(option => option.id)).toEqual([
      'low',
      'medium',
      'high',
      'max',
    ]);
    expect(modelEfforts(catalog(), 'mini')).toEqual([]);
    expect(modelEfforts(catalog({ effortLocked: true }), 'sol')).toEqual([]);
  });

  it('keeps the chosen effort across a model change when the new model offers it', () => {
    expect(
      effortForModel({ catalog: catalog(), modelId: 'sol', current: 'high' })
    ).toBe('high');
  });

  it('falls back to the model default when the new model does not offer the effort', () => {
    expect(
      effortForModel({ catalog: catalog(), modelId: 'sol', current: 'xhigh' })
    ).toBe('medium');
    expect(
      effortForModel({ catalog: catalog(), modelId: 'mini', current: 'high' })
    ).toBeNull();
  });

  it('lets a chosen effort outrank the one remembered for the new model', () => {
    expect(
      effortForModel({
        catalog: catalog(),
        modelId: 'sol',
        current: 'high',
        remembered: 'max',
      })
    ).toBe('high');
  });

  it('gives an unchosen effort the new model default, or its remembered one', () => {
    expect(
      effortForModel({ catalog: catalog(), modelId: 'sol', current: null })
    ).toBe('medium');
    expect(
      effortForModel({
        catalog: catalog(),
        modelId: 'sol',
        current: null,
        remembered: 'max',
      })
    ).toBe('max');
  });

  it('uses the source effective effort for its effective model', () => {
    expect(
      effortForModel({ catalog: catalog(), modelId: 'astra', current: null })
    ).toBe('medium');
  });

  it('carries a pinned environment effort whatever the model', () => {
    expect(
      effortForModel({
        catalog: catalog({ effortLocked: true, effectiveEffort: 'low' }),
        modelId: 'sol',
        current: 'max',
      })
    ).toBe('low');
  });
});

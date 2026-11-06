import { describe, expect, it } from 'vitest';
import type { AgentModelCatalog } from '@exawatt/core/desktop-bridge';
import {
  chosenEffort,
  derivedEffort,
  effortForModel,
  modelEfforts,
} from './launch-axes';

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

  const pick = (value: string) => chosenEffort(value);
  const shown = (value: string | null) => derivedEffort(value);

  it('keeps a chosen effort across a model change when the new model offers it', () => {
    expect(
      effortForModel({
        catalog: catalog(),
        modelId: 'sol',
        current: pick('high'),
      })
    ).toEqual(pick('high'));
  });

  it('falls back to the model default when the new model does not offer the effort', () => {
    expect(
      effortForModel({
        catalog: catalog(),
        modelId: 'sol',
        current: pick('xhigh'),
      })
    ).toEqual(shown('medium'));
    expect(
      effortForModel({
        catalog: catalog(),
        modelId: 'mini',
        current: pick('high'),
      })
    ).toEqual(shown(null));
  });

  it('lets a chosen effort outrank the one remembered for the new model', () => {
    expect(
      effortForModel({
        catalog: catalog(),
        modelId: 'sol',
        current: pick('high'),
        remembered: 'max',
      })
    ).toEqual(pick('high'));
  });

  it('never carries an effort nobody chose, even one the new model offers', () => {
    // The review's case: max was chosen for one setup, then a setup at
    // Medium was picked. Medium is showing, not chosen, so a model change
    // takes the new model's own default rather than either effort.
    expect(
      effortForModel({
        catalog: catalog(),
        modelId: 'sol',
        current: shown('high'),
      })
    ).toEqual(shown('medium'));
    expect(
      effortForModel({
        catalog: catalog(),
        modelId: 'sol',
        current: shown('low'),
        remembered: 'max',
      })
    ).toEqual(shown('max'));
  });

  it('uses the source effective effort for its effective model', () => {
    expect(
      effortForModel({
        catalog: catalog(),
        modelId: 'astra',
        current: shown(null),
      })
    ).toEqual(shown('medium'));
  });

  it('carries a pinned environment effort whatever the model', () => {
    expect(
      effortForModel({
        catalog: catalog({ effortLocked: true, effectiveEffort: 'low' }),
        modelId: 'sol',
        current: pick('max'),
      })
    ).toEqual(shown('low'));
  });
});

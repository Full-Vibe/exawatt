/**
 * Launch configuration axes (ENG-016; BUG-334).
 *
 * A launch is a point on independent axes: engine, model, effort and
 * permission mode. Effort is not a property of a list row ("GPT-6 · High",
 * "GPT-6 · Medium", …) but an axis of its own whose options are whatever the
 * chosen model declares, read from the source's own catalog (ENG-003): a
 * model that declares no efforts offers none, and an environment that pins
 * the effort offers only that one.
 *
 * Both places that set these axes, the New Agent window and a running
 * Agent's model control, resolve them here, so a model change carries the
 * effort the same way on both.
 */

import type {
  AgentEffortOption,
  AgentModelCatalog,
} from '@exawatt/core/desktop-bridge';

/** The efforts this model declares. Empty means the axis does not apply. */
export function modelEfforts(
  catalog: AgentModelCatalog | null | undefined,
  modelId: string | null
): readonly AgentEffortOption[] {
  if (!catalog || catalog.effortLocked || !modelId) return [];
  return catalog.models.find(model => model.id === modelId)?.efforts ?? [];
}

/**
 * The effort axis and where its value came from, held together so neither
 * can go stale without the other (BUG-334, amended 2026-11-05).
 *
 * `chosen` is true only when the operator picked the value on the effort
 * axis itself. Every other path that sets an effort (a setup chip, a catalog
 * row, an engine switch, a source's default, a restored draft) sets a derived
 * one. A model change carries a chosen effort and lets a derived one give
 * way, so an effort picked for one setup can never ride a later model change
 * after the operator moved to another setup. One value, one provenance: the
 * types admit no effort without it.
 */
export interface EffortSelection {
  readonly value: string | null;
  readonly chosen: boolean;
}

export function derivedEffort(value: string | null): EffortSelection {
  return { value, chosen: false };
}

export function chosenEffort(value: string): EffortSelection {
  return { value, chosen: true };
}

/**
 * The effort a launch carries once its model is `modelId`.
 *
 * The axis is orthogonal: an effort the operator chose survives a model
 * change whenever the new model offers it, and stays chosen. An effort nobody
 * chose (the last model's default, a setup's) does not: the remembered effort
 * for that model, then the source's default for it, is the better answer. A
 * model that offers no efforts carries none, and a pinned environment
 * carries its pin.
 */
export function effortForModel({
  catalog,
  modelId,
  current,
  remembered,
}: {
  catalog: AgentModelCatalog | null | undefined;
  modelId: string | null;
  /** The effort axis as it stood before the model changed. */
  current: EffortSelection;
  /** The effort last shown for this exact model, if any. */
  remembered?: string | null;
}): EffortSelection {
  if (!catalog) return current;
  if (catalog.effortLocked) return derivedEffort(catalog.effectiveEffort);
  const model = modelId
    ? catalog.models.find(candidate => candidate.id === modelId)
    : undefined;
  // A model the catalog does not list (a restored draft's) has no declared
  // efforts to check against, so what the operator had stands.
  if (!model) return remembered ? derivedEffort(remembered) : current;
  const offered = (effort: string | null | undefined): effort is string =>
    !!effort && model.efforts.some(option => option.id === effort);
  if (current.chosen && offered(current.value)) return current;
  if (offered(remembered)) return derivedEffort(remembered);
  if (model.id === catalog.effectiveModel && offered(catalog.effectiveEffort)) {
    return derivedEffort(catalog.effectiveEffort);
  }
  return derivedEffort(
    offered(model.defaultEffort) ? model.defaultEffort : null
  );
}

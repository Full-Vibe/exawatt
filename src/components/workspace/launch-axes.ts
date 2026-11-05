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
 * The effort a launch carries once its model is `modelId`.
 *
 * The axis is orthogonal: an effort the operator chose survives a model
 * change whenever the new model offers it. An effort nobody chose (the last
 * model's default) does not: the new model's own default is the better
 * answer. Otherwise the remembered effort for that model, then the source's
 * default for it. A model that offers no efforts carries none, and a pinned
 * environment carries its pin.
 */
export function effortForModel({
  catalog,
  modelId,
  current,
  remembered,
}: {
  catalog: AgentModelCatalog | null | undefined;
  modelId: string | null;
  /** The effort the operator chose before the model changed, or null when
   *  the effort showing was only a default. */
  current: string | null;
  /** The effort last chosen for this exact model, if any. */
  remembered?: string | null;
}): string | null {
  if (!catalog) return current;
  if (catalog.effortLocked) return catalog.effectiveEffort;
  const model = modelId
    ? catalog.models.find(candidate => candidate.id === modelId)
    : undefined;
  // A model the catalog does not list (a restored draft's) has no declared
  // efforts to check against, so the operator's own choice stands.
  if (!model) return remembered ?? current;
  const offered = (effort: string | null | undefined): effort is string =>
    !!effort && model.efforts.some(option => option.id === effort);
  if (offered(current)) return current;
  if (offered(remembered)) return remembered;
  if (model.id === catalog.effectiveModel && offered(catalog.effectiveEffort)) {
    return catalog.effectiveEffort;
  }
  return offered(model.defaultEffort) ? model.defaultEffort : null;
}

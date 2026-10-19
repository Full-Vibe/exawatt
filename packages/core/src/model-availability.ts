/**
 * Whether a source will start an Agent on an exact model (BUG-283).
 *
 * The ONE predicate every surface reads before it calls a model unavailable:
 * the composer's saved setups, Clone to… and anything that offers a
 * remembered Launch Configuration. Each used to test `catalog.models` for the
 * exact id on its own, so two facts were read as a refusal:
 *
 * - **Absence of an answer.** A catalog nobody could read (a cold probe in a
 *   new Project outliving the composer's deadline, a CLI that could not be
 *   asked) has no rows, and every remembered setup read "not available".
 *   Only a source's own live catalog is a list of what it offers; a view
 *   assembled from configuration files, or no view at all, proves nothing
 *   about a model it does not mention.
 * - **A modifier the source accepts.** Claude Code's `/model` picker lists
 *   base models, and its `--model` accepts any of them with the `[1m]`
 *   context modifier (measured on 2.1.303, 2026-10-18: `opus[1m]` ran as
 *   `claude-opus-5-5[1m]`, `claude-fable-5[1m]` as `claude-fable-5`, while an
 *   id it does not know is refused as `unrecognized_model`). The operator's
 *   Fable and Opus 1M setups launched and still read unavailable.
 *
 * A genuinely unlisted model stays unavailable, with its reason, and nothing
 * here substitutes one model for another.
 */
import type { AgentHarness } from './agent-sources';
import type { AgentModelCatalog } from './desktop-bridge/pty';

/**
 * Suffixes a source accepts on any model its live catalog lists, by harness.
 * Source-owned knowledge, measured against the CLI; a harness absent here
 * accepts exactly the ids it lists.
 */
const SOURCE_MODEL_MODIFIERS: Partial<
  Record<AgentHarness, readonly string[]>
> = {
  claude: ['[1m]'],
};

type AgentModelAvailability =
  /** The catalog lists it, or it is the model the source resolves to. */
  | { kind: 'listed' }
  /** A listed model with a modifier the source accepts. */
  | { kind: 'modified'; base: string; modifier: string }
  /** No live catalog answered: the attempt is the probe (BUG-063). */
  | { kind: 'unverified' }
  /** The source's own live catalog does not offer it. */
  | { kind: 'unlisted' };

function agentModelAvailability(
  catalog: AgentModelCatalog | null | undefined,
  modelId: string
): AgentModelAvailability {
  if (!catalog) return { kind: 'unverified' };
  const listed = (id: string) =>
    id === catalog.effectiveModel ||
    catalog.models.some(option => option.id === id);
  if (listed(modelId)) return { kind: 'listed' };
  if (catalog.catalogMode !== 'live-catalog') return { kind: 'unverified' };
  for (const modifier of SOURCE_MODEL_MODIFIERS[catalog.harness] ?? []) {
    if (!modelId.endsWith(modifier)) continue;
    const base = modelId.slice(0, -modifier.length);
    if (base && listed(base)) return { kind: 'modified', base, modifier };
  }
  return { kind: 'unlisted' };
}

/** True unless the source's own live catalog does not offer the model. */
export function agentModelLaunchable(
  catalog: AgentModelCatalog | null | undefined,
  modelId: string
): boolean {
  return agentModelAvailability(catalog, modelId).kind !== 'unlisted';
}

/**
 * Whether a saved setup can start an Agent is decided by what the source
 * accepts, never by whether its id is one of the rows a picker happens to
 * render (BUG-283).
 *
 * The operator's Fable and `opus[1m]` setups read "not available from Claude
 * Code" in a new Project. Both launch: Claude Code 2.1.303 accepts the `[1m]`
 * context modifier on any model its `/model` picker lists (measured
 * 2026-10-18: `--model 'opus[1m]'` ran as `claude-opus-5-5[1m]`,
 * `--model 'claude-fable-5[1m]'` as `claude-fable-5`), while an id it does not
 * know is refused (`unrecognized_model`). The picker rows below are that
 * account's live catalog, as Exawatt cached it for every Project.
 */
import { describe, expect, it } from 'vitest';
import { createAgentLaunchConfiguration } from '@exawatt/core';
import type { AgentModelCatalog } from '@exawatt/core/desktop-bridge';
import {
  fallbackAgentSourceRegistry,
  launchSourceSnapshots,
  loadAgentModelCatalog,
} from './agent-sources';
import { launchTargetAvailability } from './launch-target-catalog';

const PICKER_ROWS = [
  'default',
  'opus',
  'fable',
  'sonnet',
  'haiku',
  'claude-haiku-4-5-20251001',
  'claude-sonnet-5',
  'claude-opus-5',
  'claude-fable-5',
  'claude-opus-4-8',
];

function liveCatalog(rows = PICKER_ROWS): AgentModelCatalog {
  return {
    harness: 'claude',
    effectiveModel: 'opus',
    effectiveModelLabel: 'Opus 5.5',
    effectiveModelSource: 'config',
    effectiveEffort: 'auto',
    effectiveEffortLabel: 'Auto',
    effectiveEffortSource: 'model-default',
    effortLocked: false,
    models: rows.map(id => ({
      id,
      label: id,
      description: '',
      defaultEffort: 'auto',
      efforts: [],
    })),
    catalogMode: 'live-catalog',
    catalogProvenance: 'Installed Claude Code CLI · SDK control protocol',
    observedAt: 1,
    selectionAction: null,
  };
}

const sources = launchSourceSnapshots(fallbackAgentSourceRegistry('launch'));

function setup(modelId: string) {
  return createAgentLaunchConfiguration({
    sourceId: 'claude-local',
    modelId,
    effort: 'high',
    labels: { source: 'Claude Code', model: modelId },
  });
}

function availability(modelId: string, catalog: AgentModelCatalog) {
  return launchTargetAvailability(setup(modelId), {
    sources,
    catalogs: { claude: catalog },
  });
}

describe('saved setup availability (BUG-283)', () => {
  it("launches a listed model with the source's context modifier", () => {
    expect(availability('opus[1m]', liveCatalog())).toEqual({
      available: true,
    });
    expect(availability('claude-fable-5[1m]', liveCatalog())).toEqual({
      available: true,
    });
  });

  it('still refuses a model the live catalog does not offer', () => {
    const verdict = availability('claude-mythical-9', liveCatalog());
    expect(verdict.available).toBe(false);
    expect(verdict.reason).toContain('claude-mythical-9');
    // A modifier on a model the source does not list is not a listing.
    expect(availability('claude-mythical-9[1m]', liveCatalog()).available).toBe(
      false
    );
  });

  it('never reads a catalog nobody could read as a refusal', async () => {
    // No desktop bridge answers here, which is what a new Project's cold
    // probe looks like when it outlives the composer's deadline.
    const unanswered = await loadAgentModelCatalog('claude', '/new-project');
    expect(unanswered.models).toEqual([]);
    expect(availability('claude-fable-5[1m]', unanswered)).toEqual({
      available: true,
    });
    expect(availability('sonnet', unanswered)).toEqual({ available: true });
  });

  it('never reads a configured-values view as the whole catalog', () => {
    const configured: AgentModelCatalog = {
      ...liveCatalog(['opus']),
      catalogMode: 'configured-values',
      catalogProvenance: 'Claude Code layered configuration',
    };
    expect(availability('fable', configured)).toEqual({ available: true });
  });
});

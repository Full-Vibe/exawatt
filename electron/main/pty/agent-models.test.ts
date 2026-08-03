import { describe, expect, it } from 'vitest';
import {
  buildClaudeModelCatalog,
  formatAgentEffortLabel,
  formatAgentModelLabel,
  isValidAgentEffort,
  isValidAgentModel,
  parseClaudeModelCatalog,
  parseCodexConfiguredEffort,
  parseCodexConfiguredModel,
  parseCodexModelCatalog,
} from './agent-models';

/** Shape of a real `claude --output-format stream-json` initialize response. */
function claudeInitializeResponse(models: unknown[]): string {
  return [
    JSON.stringify({ type: 'system', subtype: 'init' }),
    JSON.stringify({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'exawatt-model-catalog',
        response: { commands: [], agents: [], models },
      },
    }),
  ].join('\n');
}

describe('Agent model catalogs', () => {
  it('reads the root Codex model without mistaking a profile model for it', () => {
    expect(
      parseCodexConfiguredModel(`
model = "gpt-5.6-sol"
model_reasoning_effort = "xhigh"

[profiles.fast]
model = "gpt-5.6-luna"
`)
    ).toBe('gpt-5.6-sol');
    expect(
      parseCodexConfiguredEffort(`
model = "gpt-5.6-sol"
model_reasoning_effort = "xhigh"

[profiles.fast]
model_reasoning_effort = "low"
`)
    ).toBe('xhigh');
    expect(
      parseCodexConfiguredModel(`[profiles.fast]\nmodel = "gpt-5.6-luna"`)
    ).toBeNull();
  });

  it('uses the configured Codex model and exposes only visible catalog rows', () => {
    const catalog = parseCodexModelCatalog(
      JSON.stringify({
        models: [
          {
            slug: 'gpt-5.6-terra',
            display_name: 'GPT-5.6-Terra',
            description: 'Balanced model.',
            visibility: 'list',
            priority: 2,
            default_reasoning_level: 'medium',
            supported_reasoning_levels: [
              { effort: 'low', description: 'Fast.' },
              { effort: 'medium', description: 'Balanced.' },
              { effort: 'xhigh', description: 'Deep.' },
            ],
          },
          {
            slug: 'gpt-5.6-sol',
            display_name: 'GPT-5.6-Sol',
            description: 'Frontier model.',
            visibility: 'list',
            priority: 1,
            default_reasoning_level: 'low',
            supported_reasoning_levels: [
              { effort: 'low', description: 'Fast.' },
              { effort: 'high', description: 'Deep.' },
            ],
          },
          {
            slug: 'review-only',
            display_name: 'Review only',
            visibility: 'hide',
            priority: 0,
          },
        ],
      }),
      'gpt-5.6-terra',
      'xhigh'
    );

    expect(catalog.effectiveModel).toBe('gpt-5.6-terra');
    expect(catalog.effectiveModelSource).toBe('config');
    expect(catalog.effectiveEffort).toBe('xhigh');
    expect(catalog.effectiveEffortSource).toBe('config');
    expect(
      catalog.models.find(model => model.id === 'gpt-5.6-sol')?.defaultEffort
    ).toBe('low');
    expect(catalog.models.map(model => model.id)).toEqual([
      'gpt-5.6-sol',
      'gpt-5.6-terra',
    ]);
  });

  it('uses the installed Codex catalog priority when no model is configured', () => {
    const catalog = parseCodexModelCatalog(
      JSON.stringify({
        models: [
          {
            slug: 'slow',
            visibility: 'list',
            priority: 3,
            default_reasoning_level: 'high',
            supported_reasoning_levels: [{ effort: 'high' }],
          },
          {
            slug: 'fast',
            visibility: 'list',
            priority: 1,
            default_reasoning_level: 'medium',
            supported_reasoning_levels: [{ effort: 'medium' }],
          },
        ],
      }),
      null
    );
    expect(catalog.effectiveModel).toBe('fast');
    expect(catalog.effectiveModelSource).toBe('harness-recommended');
    expect(catalog.effectiveEffort).toBe('medium');
    expect(catalog.effectiveEffortSource).toBe('model-default');
  });

  it('mirrors the model rows the installed Claude Code CLI reports', () => {
    const models = parseClaudeModelCatalog(
      claudeInitializeResponse([
        {
          value: 'default',
          displayName: 'Default (recommended)',
          description: 'Opus 5 with 1M context · Best for everyday tasks',
          supportsEffort: true,
          supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
        },
        {
          value: 'claude-fable-5[1m]',
          displayName: 'Fable',
          description: 'Fable 5 · Most capable',
          supportsEffort: true,
          supportedEffortLevels: ['high', 'ludicrous'],
        },
        { value: 'haiku', displayName: 'Haiku', description: 'Haiku 4.5' },
        { value: 'bad model', displayName: 'Unlaunchable' },
      ])
    );
    expect(models?.map(model => model.id)).toEqual([
      'default',
      'claude-fable-5[1m]',
      'haiku',
    ]);
    expect(models?.[1]?.label).toBe('Fable');
    // An effort level Exawatt has no copy for still reaches the picker.
    expect(models?.[1]?.efforts.map(effort => effort.id)).toEqual([
      'auto',
      'high',
      'ludicrous',
    ]);
    expect(models?.[2]?.efforts.map(effort => effort.id)).toEqual(['auto']);
    expect(parseClaudeModelCatalog('not json\n{}')).toBeNull();
  });

  it('never adds rows on top of a reported Claude catalog', () => {
    const reported = parseClaudeModelCatalog(
      claudeInitializeResponse([
        { value: 'default', displayName: 'Default (recommended)' },
        { value: 'sonnet', displayName: 'Sonnet' },
      ])
    );
    const catalog = buildClaudeModelCatalog(
      reported,
      [{ availableModels: ['opus'] }],
      { ANTHROPIC_CUSTOM_MODEL_OPTION: 'internal-model' }
    );
    expect(catalog.models.map(model => model.id)).toEqual([
      'default',
      'sonnet',
    ]);
  });

  it('resolves Claude model settings from user to Project-local precedence', () => {
    const catalog = buildClaudeModelCatalog(
      null,
      [
        { model: 'sonnet', effortLevel: 'low' },
        { model: 'opus', effortLevel: 'high' },
        {
          model: 'claude-fable-5[1m]',
          effortLevel: 'xhigh',
          availableModels: ['claude-fable-5[1m]'],
        },
      ],
      {}
    );
    expect(catalog.effectiveModel).toBe('claude-fable-5[1m]');
    expect(catalog.effectiveModelSource).toBe('config');
    expect(catalog.effectiveEffort).toBe('xhigh');
    expect(catalog.effectiveEffortSource).toBe('config');
    expect(
      catalog.models.find(model => model.id === 'claude-fable-5[1m]')?.label
    ).toBe('Claude Fable 5 · 1M');
  });

  it('honors Claude environment overrides and labels the true account default', () => {
    const environmentCatalog = buildClaudeModelCatalog(
      null,
      [{ model: 'sonnet', effortLevel: 'low' }],
      {
        ANTHROPIC_MODEL: 'opus',
        CLAUDE_CODE_EFFORT_LEVEL: 'max',
      }
    );
    expect(environmentCatalog.effectiveModel).toBe('opus');
    expect(environmentCatalog.effectiveEffort).toBe('max');
    expect(environmentCatalog.effectiveEffortSource).toBe('environment');
    expect(environmentCatalog.effortLocked).toBe(true);
    const defaultCatalog = buildClaudeModelCatalog(null, [], {});
    expect(defaultCatalog.effectiveModel).toBe('default');
    expect(defaultCatalog.effectiveModelSource).toBe('account-default');
    expect(defaultCatalog.effectiveEffort).toBe('auto');
    expect(
      defaultCatalog.models
        .find(model => model.id === 'sonnet')
        ?.efforts.map(effort => effort.id)
    ).toEqual(['auto', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(
      defaultCatalog.models
        .find(model => model.id === 'haiku')
        ?.efforts.map(effort => effort.id)
    ).toEqual(['auto']);

    const unsupportedConfiguredEffort = buildClaudeModelCatalog(
      null,
      [{ model: 'haiku', effortLevel: 'high' }],
      {}
    );
    expect(unsupportedConfiguredEffort.effectiveEffort).toBe('auto');
    expect(unsupportedConfiguredEffort.effectiveEffortSource).toBe(
      'model-default'
    );
  });

  it('keeps model IDs shell-token-safe while allowing provider paths', () => {
    expect(isValidAgentModel('arn:aws:bedrock:us-west-2:model/opus')).toBe(
      true
    );
    expect(isValidAgentModel('bad model')).toBe(false);
    expect(isValidAgentModel('bad\nmodel')).toBe(false);
    expect(isValidAgentEffort('xhigh')).toBe(true);
    expect(isValidAgentEffort('extra high')).toBe(false);
    expect(formatAgentEffortLabel('xhigh')).toBe('Extra high');
    expect(formatAgentModelLabel('gpt-5.6-sol')).toBe('GPT 5.6 Sol');
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildClaudeModelCatalog,
  formatAgentModelLabel,
  isValidAgentModel,
  parseCodexConfiguredModel,
  parseCodexModelCatalog,
} from './agent-models';

describe('Agent model catalogs', () => {
  it('reads the root Codex model without mistaking a profile model for it', () => {
    expect(
      parseCodexConfiguredModel(`
model = "gpt-5.6-sol"

[profiles.fast]
model = "gpt-5.6-luna"
`)
    ).toBe('gpt-5.6-sol');
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
          },
          {
            slug: 'gpt-5.6-sol',
            display_name: 'GPT-5.6-Sol',
            description: 'Frontier model.',
            visibility: 'list',
            priority: 1,
          },
          {
            slug: 'review-only',
            display_name: 'Review only',
            visibility: 'hide',
            priority: 0,
          },
        ],
      }),
      'gpt-5.6-terra'
    );

    expect(catalog.effectiveModel).toBe('gpt-5.6-terra');
    expect(catalog.effectiveModelSource).toBe('config');
    expect(catalog.models.map(model => model.id)).toEqual([
      'gpt-5.6-sol',
      'gpt-5.6-terra',
    ]);
  });

  it('uses the installed Codex catalog priority when no model is configured', () => {
    const catalog = parseCodexModelCatalog(
      JSON.stringify({
        models: [
          { slug: 'slow', visibility: 'list', priority: 3 },
          { slug: 'fast', visibility: 'list', priority: 1 },
        ],
      }),
      null
    );
    expect(catalog.effectiveModel).toBe('fast');
    expect(catalog.effectiveModelSource).toBe('harness-recommended');
  });

  it('resolves Claude model settings from user to Project-local precedence', () => {
    const catalog = buildClaudeModelCatalog(
      [
        { model: 'sonnet' },
        { model: 'opus' },
        {
          model: 'claude-fable-5[1m]',
          availableModels: ['claude-fable-5[1m]'],
        },
      ],
      {}
    );
    expect(catalog.effectiveModel).toBe('claude-fable-5[1m]');
    expect(catalog.effectiveModelSource).toBe('config');
    expect(
      catalog.models.find(model => model.id === 'claude-fable-5[1m]')?.label
    ).toBe('Claude Fable 5 · 1M');
  });

  it('honors Claude environment overrides and labels the true account default', () => {
    expect(
      buildClaudeModelCatalog([{ model: 'sonnet' }], {
        ANTHROPIC_MODEL: 'opus',
      }).effectiveModel
    ).toBe('opus');
    const defaultCatalog = buildClaudeModelCatalog([], {});
    expect(defaultCatalog.effectiveModel).toBe('default');
    expect(defaultCatalog.effectiveModelSource).toBe('account-default');
  });

  it('keeps model IDs shell-token-safe while allowing provider paths', () => {
    expect(isValidAgentModel('arn:aws:bedrock:us-west-2:model/opus')).toBe(
      true
    );
    expect(isValidAgentModel('bad model')).toBe(false);
    expect(isValidAgentModel('bad\nmodel')).toBe(false);
    expect(formatAgentModelLabel('gpt-5.6-sol')).toBe('GPT 5.6 Sol');
  });
});

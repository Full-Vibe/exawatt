import { describe, expect, it } from 'vitest';
import {
  buildClaudeModelCatalog,
  formatAgentEffortLabel,
  formatAgentModelLabel,
  isValidAgentEffort,
  isValidAgentModel,
  opencodeCatalogContext,
  OpencodeModelCatalogCache,
  parseClaudeModelCatalog,
  parseCodexConfiguredEffort,
  parseCodexConfiguredModel,
  parseCodexModelCatalog,
  parseGrokAuthBanner,
  parseGrokModelCatalog,
  parseOpencodeModelCatalog,
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

  it('keeps one Auto row when the CLI reports an auto effort level', () => {
    const models = parseClaudeModelCatalog(
      claudeInitializeResponse([
        {
          value: 'sonnet',
          displayName: 'Sonnet',
          supportsEffort: true,
          supportedEffortLevels: ['auto', 'high'],
        },
      ])
    );
    expect(models?.[0]?.efforts.map(effort => effort.id)).toEqual([
      'auto',
      'high',
    ]);
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
    expect(catalog.catalogMode).toBe('live-catalog');
    expect(catalog.selectionAction).toBeNull();
  });

  it('labels a configured Codex fallback separately from a live catalog', () => {
    const catalog = parseCodexModelCatalog('', 'private-model', 'high');
    expect(catalog.models.map(model => model.id)).toEqual(['private-model']);
    expect(catalog.catalogMode).toBe('configured-values');
    expect(catalog.catalogProvenance).toBe('Codex configuration');
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

  it('honors Claude environment overrides without inventing an account catalog', () => {
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
    expect(defaultCatalog.effectiveModel).toBeNull();
    expect(defaultCatalog.effectiveModelLabel).toBe('Account default');
    expect(defaultCatalog.effectiveModelSource).toBe('account-default');
    expect(defaultCatalog.effectiveEffort).toBeNull();
    expect(defaultCatalog.models).toEqual([]);
    expect(defaultCatalog.catalogMode).toBe('source-owned');
    expect(defaultCatalog.selectionAction).toBe('choose-in-source');

    const configuredEffort = buildClaudeModelCatalog(
      null,
      [{ model: 'haiku', effortLevel: 'high' }],
      {}
    );
    expect(configuredEffort.effectiveEffort).toBe('high');
    expect(configuredEffort.effectiveEffortSource).toBe('config');
    expect(configuredEffort.models.map(model => model.id)).toEqual(['haiku']);
    expect(
      configuredEffort.models[0]?.efforts.map(effort => effort.id)
    ).toEqual(['high']);
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

  it('reads OpenCode verbose records and exposes only reported variants', () => {
    const catalog = parseOpencodeModelCatalog(`opencode/big-pickle
{
  "id": "big-pickle",
  "providerID": "opencode",
  "name": "Big Pickle",
  "family": "big-pickle",
  "variants": {
    "low": { "reasoningEffort": "low" },
    "high": { "reasoningEffort": "high" }
  }
}
openai/gpt-5.3-codex
{
  "id": "gpt-5.3-codex",
  "providerID": "openai",
  "name": "GPT-5.3 Codex",
  "variants": {}
}
`);
    expect(catalog.harness).toBe('opencode');
    expect(catalog.catalogMode).toBe('live-catalog');
    expect(catalog.effectiveModel).toBeNull();
    expect(catalog.effectiveModelLabel).toBe('Source default');
    expect(catalog.models.map(model => model.id)).toEqual([
      'opencode/big-pickle',
      'openai/gpt-5.3-codex',
    ]);
    expect(catalog.models[0].efforts.map(effort => effort.id)).toEqual([
      'high',
      'low',
    ]);
    expect(catalog.models[0].defaultEffort).toBeNull();
    expect(catalog.models[1].efforts).toEqual([]);
  });

  it('keeps only an exact configured OpenCode fallback when discovery fails', () => {
    const catalog = parseOpencodeModelCatalog(
      'not a verbose catalog',
      'private/provider-model'
    );
    expect(catalog.catalogMode).toBe('configured-values');
    expect(catalog.effectiveModel).toBe('private/provider-model');
    expect(catalog.models.map(model => model.id)).toEqual([
      'private/provider-model',
    ]);
  });

  it('caches a successful OpenCode observation without refreshing its age', async () => {
    let now = 1_000;
    let probes = 0;
    const cache = new OpencodeModelCatalogCache(300, () => now);
    const probe = async () => {
      probes += 1;
      return {
        ...parseOpencodeModelCatalog(`fixture/model
{"providerID":"fixture","name":"Fixture"}`),
        observedAt: 900,
      };
    };

    const observed = await cache.read('context', probe);
    now = 1_200;
    const cached = await cache.read('context', probe);

    expect(probes).toBe(1);
    expect(observed.catalogProvenance).toBe(
      'Installed OpenCode CLI · opencode models --verbose'
    );
    expect(cached.catalogProvenance).toBe(
      'Installed OpenCode CLI · opencode models --verbose · cached observation'
    );
    expect(cached.observedAt).toBe(900);

    now = 1_301;
    await cache.read('context', probe);
    expect(probes).toBe(2);
  });

  it('does not cache an unavailable OpenCode catalog', async () => {
    let probes = 0;
    const cache = new OpencodeModelCatalogCache();
    const probe = async () => {
      probes += 1;
      return parseOpencodeModelCatalog('catalog unavailable');
    };

    await cache.read('context', probe);
    await cache.read('context', probe);
    expect(probes).toBe(2);
  });

  it('shares one in-flight OpenCode catalog probe per context', async () => {
    let probes = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const cache = new OpencodeModelCatalogCache();
    const probe = async () => {
      probes += 1;
      await gate;
      return parseOpencodeModelCatalog(`fixture/model
{"providerID":"fixture","name":"Fixture"}`);
    };

    const first = cache.read('context', probe);
    const second = cache.read('context', probe);
    expect(probes).toBe(1);
    release?.();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it('scopes OpenCode catalog evidence to its shell and config context', () => {
    const base = opencodeCatalogContext('/project', '/bin/zsh', {
      HOME: '/users/operator',
      OPENCODE_CONFIG: '/configs/a.json',
    });
    expect(base).not.toBeNull();
    expect(
      opencodeCatalogContext('/project', '/bin/fish', {
        HOME: '/users/operator',
        OPENCODE_CONFIG: '/configs/a.json',
      })
    ).not.toBe(base);
    expect(
      opencodeCatalogContext('/project', '/bin/zsh', {
        HOME: '/users/operator',
        OPENCODE_CONFIG: '/configs/b.json',
      })
    ).not.toBe(base);
    expect(
      opencodeCatalogContext('/project', '/bin/zsh', {
        HOME: '/users/operator',
        OPENCODE_CONFIG_CONTENT: '{"provider":{"private":{}}}',
      })
    ).toBeNull();
  });
});

/** Verbatim `grok models` output, captured from grok 1.0.3 on 2026-08-13. */
const GROK_MODELS_UNAUTHENTICATED = [
  'You are not authenticated.',
  '',
  'Default model: grok-4.5',
  '',
  'Available models:',
  '  * grok-4.5 (default)',
  '',
].join('\n');

const GROK_MODELS_SIGNED_IN = [
  'You are logged in with grok.com.',
  '',
  'Default model: grok-4.5',
  '',
  'Available models:',
  '  * grok-4.5 (default)',
  '  - grok-4.5-fast',
  '  - grok-code-fast-2',
  '',
].join('\n');

describe('parseGrokModelCatalog', () => {
  it('reads the source catalog and its own default', () => {
    const catalog = parseGrokModelCatalog(GROK_MODELS_SIGNED_IN);
    expect(catalog.harness).toBe('grok');
    expect(catalog.models.map(model => model.id)).toEqual([
      'grok-4.5',
      'grok-4.5-fast',
      'grok-code-fast-2',
    ]);
    expect(catalog.effectiveModel).toBe('grok-4.5');
    // A concrete id the source enumerates is a harness recommendation, the
    // same classification Codex gets for the same shape. `account-default` is
    // reserved for "no id to pin", which the composer reads as permission to
    // omit the model flag entirely (BUG-039).
    expect(catalog.effectiveModelSource).toBe('harness-recommended');
    expect(catalog.catalogMode).toBe('live-catalog');
    expect(catalog.catalogProvenance).toBe(
      'Installed Grok Build CLI · grok models'
    );
  });

  it('offers no effort options, because the source enumerates none', () => {
    const catalog = parseGrokModelCatalog(GROK_MODELS_SIGNED_IN);
    for (const model of catalog.models) {
      expect(model.efforts).toEqual([]);
      expect(model.defaultEffort).toBeNull();
    }
    expect(catalog.effectiveEffort).toBeNull();
    expect(catalog.effectiveEffortSource).toBe('unavailable');
    expect(catalog.effortLocked).toBe(false);
  });

  it('still reports the built-in catalog before sign-in', () => {
    const catalog = parseGrokModelCatalog(GROK_MODELS_UNAUTHENTICATED);
    expect(catalog.models.map(model => model.id)).toEqual(['grok-4.5']);
    expect(catalog.effectiveModel).toBe('grok-4.5');
  });

  it('never promotes the banner or a stray line into a model row', () => {
    const catalog = parseGrokModelCatalog(
      [
        'You are not authenticated.',
        '',
        'Default model: grok-4.5',
        '',
        'Available models:',
        '  * grok-4.5 (default)',
        '',
        'Some later advisory line.',
        '  - not-a-model-row',
      ].join('\n')
    );
    expect(catalog.models.map(model => model.id)).toEqual(['grok-4.5']);
  });

  it('reports an unavailable catalog rather than inventing one', () => {
    const catalog = parseGrokModelCatalog('');
    expect(catalog.models).toEqual([]);
    expect(catalog.effectiveModel).toBeNull();
    expect(catalog.catalogMode).toBe('unavailable');
    expect(catalog.selectionAction).toBeNull();
  });

  it('keeps a reported default that never appears in the listing', () => {
    const catalog = parseGrokModelCatalog(
      ['Default model: grok-5', '', 'Available models:', '  - grok-4.5'].join(
        '\n'
      )
    );
    expect(catalog.models.map(model => model.id)).toEqual([
      'grok-5',
      'grok-4.5',
    ]);
    expect(catalog.effectiveModel).toBe('grok-5');
  });
});

describe('parseGrokAuthBanner', () => {
  it('reads every credential source Grok Build names', () => {
    expect(parseGrokAuthBanner('You are not authenticated.')).toMatchObject({
      authenticated: false,
      identity: 'Not signed in',
    });
    expect(parseGrokAuthBanner('You are using XAI_API_KEY.')).toMatchObject({
      authenticated: true,
      identity: 'XAI_API_KEY',
    });
    expect(parseGrokAuthBanner('You are logged in with grok.com.')).toMatchObject(
      { authenticated: true, identity: 'grok.com' }
    );
    expect(
      parseGrokAuthBanner("Model 'local-llama' is using its own API key.")
    ).toMatchObject({ authenticated: true });
    expect(
      parseGrokAuthBanner('You are authenticated via deployment key.')
    ).toMatchObject({ authenticated: true, identity: 'Deployment key' });
  });

  it('reports credential presence without ever naming the value', () => {
    const banner = parseGrokAuthBanner('You are using XAI_API_KEY.')!;
    expect(banner.detail).toContain('never receives or stores');
    expect(banner.detail).not.toMatch(/xai-[A-Za-z0-9]/);
  });

  it('is unknown, not signed-out, for an unrecognized banner', () => {
    expect(parseGrokAuthBanner('')).toBeNull();
    expect(parseGrokAuthBanner('Checking for updates…')).toBeNull();
  });
});

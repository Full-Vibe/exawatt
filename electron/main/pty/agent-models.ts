import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { PtyHarness } from './session-manager';
import {
  AgentModelCatalogCache,
  catalogCacheKey,
} from './agent-model-catalog-cache';
import { planLoginShell, shellQuote } from './login-shell';

/**
 * `execFile`'s own `timeout` is not a deadline (ENG-016 D49).
 *
 * It sends SIGTERM to the process it spawned — the LOGIN SHELL — and then
 * keeps waiting for stdio EOF. A grandchild like `claude` or `opencode`
 * inherits those pipes, survives its parent's SIGTERM, and holds stdout open,
 * so the promise never settles. Upstream, `pty:listAgentModels` never
 * answered, the composer's `modelCatalog` stayed null, and the effort control
 * span "Detecting…" for the rest of the session (operator, 2026-08-04).
 *
 * This wrapper spawns a detached process GROUP and, at the deadline, kills the
 * whole group and resolves with whatever was read. A probe that misses its
 * deadline is a probe that failed: callers already degrade to configured
 * values with honest provenance.
 */
async function execWithDeadline(
  shell: string,
  command: string,
  options: { cwd: string; timeout: number; maxBuffer: number }
): Promise<{ stdout: string; timedOut: boolean }> {
  const plan = planLoginShell(shell, {
    command,
    directory: options.cwd,
  });
  const child = spawn(shell, plan.args, {
    cwd: plan.cwd,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let overflowed = false;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    if (overflowed) return;
    stdout += String(chunk);
    if (stdout.length > options.maxBuffer) {
      overflowed = true;
      stdout = stdout.slice(0, options.maxBuffer);
    }
  });
  // stderr is drained but discarded: an unread pipe fills and blocks the child.
  child.stderr.resume();

  const killGroup = () => {
    if (child.pid === undefined) return;
    try {
      // Negative pid targets the whole detached group, so a grandchild that
      // outlives its shell cannot keep the pipes — or this promise — open.
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        // Already gone.
      }
    }
  };

  return new Promise(resolve => {
    let settled = false;
    const finish = (timedOut: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (timedOut) killGroup();
      resolve({ stdout, timedOut });
    };
    const timer = setTimeout(() => finish(true), options.timeout);
    timer.unref?.();
    child.on('close', () => finish(false));
    child.on('error', () => finish(false));
  });
}

const MODEL_ENV_KEYS = [
  'HOME',
  'CODEX_HOME',
  'CLAUDE_CONFIG_DIR',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_CUSTOM_MODEL_OPTION',
  'ANTHROPIC_CUSTOM_MODEL_OPTION_NAME',
  'ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION',
  'CLAUDE_CODE_EFFORT_LEVEL',
  'XDG_CONFIG_HOME',
  'OPENCODE_CONFIG',
  'OPENCODE_CONFIG_DIR',
  'OPENCODE_CONFIG_CONTENT',
] as const;

export interface AgentEffortOption {
  id: string;
  label: string;
  description: string;
}

export interface AgentModelOption {
  id: string;
  label: string;
  description: string;
  defaultEffort: string | null;
  efforts: AgentEffortOption[];
}

export interface AgentModelCatalog {
  harness: Exclude<PtyHarness, 'shell'>;
  /** The model Exawatt will pin for a new Agent unless the operator changes it. */
  effectiveModel: string | null;
  effectiveModelLabel: string;
  effectiveModelSource:
    | 'config'
    | 'harness-recommended'
    | 'account-default'
    | 'unavailable';
  /** The effort Exawatt will pin unless null/auto leaves it to the harness. */
  effectiveEffort: string | null;
  effectiveEffortLabel: string;
  effectiveEffortSource:
    | 'config'
    | 'model-default'
    | 'environment'
    | 'unavailable';
  effortLocked: boolean;
  models: AgentModelOption[];
  catalogMode:
    | 'live-catalog'
    | 'configured-values'
    | 'source-owned'
    | 'unavailable';
  catalogProvenance: string;
  observedAt: number;
  selectionAction: 'choose-in-source' | null;
  /** True when this came from the disk cache rather than a fresh probe. */
  servedFromCache?: boolean;
}

interface CodexReasoningLevel {
  effort?: unknown;
  description?: unknown;
}

interface CodexCatalogEntry {
  slug?: unknown;
  display_name?: unknown;
  description?: unknown;
  visibility?: unknown;
  priority?: unknown;
  default_reasoning_level?: unknown;
  supported_reasoning_levels?: unknown;
}

interface OpencodeCatalogEntry {
  id?: unknown;
  providerID?: unknown;
  name?: unknown;
  family?: unknown;
  variants?: unknown;
}

const CLAUDE_EFFORTS: AgentEffortOption[] = [
  {
    id: 'auto',
    label: 'Auto',
    description: "Use the selected Claude model's default effort.",
  },
  {
    id: 'low',
    label: 'Low',
    description: 'Fastest for short, well-scoped work.',
  },
  {
    id: 'medium',
    label: 'Medium',
    description: 'Lower spend for work that needs some reasoning.',
  },
  {
    id: 'high',
    label: 'High',
    description: 'Strong balance for intelligence-sensitive work.',
  },
  {
    id: 'xhigh',
    label: 'Extra high',
    description: 'Deeper reasoning for demanding agentic work.',
  },
  {
    id: 'max',
    label: 'Max',
    description: 'Maximum reasoning; slower and prone to overthinking.',
  },
];

function configuredClaudeModel(
  id: string,
  label: string,
  description: string,
  observedEffort: string | null
): AgentModelOption {
  const efforts = observedEffort
    ? [
        {
          id: observedEffort,
          label: formatAgentEffortLabel(observedEffort),
          description: 'Observed in the active Claude Code configuration.',
        },
      ]
    : [];
  return {
    id,
    label,
    description,
    defaultEffort: observedEffort,
    efforts,
  };
}

export function isValidAgentModel(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 512 &&
    !/[\s\u0000-\u001f\u007f]/.test(value)
  );
}

export function isValidAgentEffort(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 32 &&
    /^[a-z][a-z0-9_-]*$/.test(value)
  );
}

export function formatAgentEffortLabel(effort: string): string {
  if (effort === 'xhigh') return 'Extra high';
  return effort.charAt(0).toUpperCase() + effort.slice(1);
}

export function formatAgentModelLabel(model: string): string {
  const contextSuffix = model.endsWith('[1m]') ? ' · 1M' : '';
  const withoutContext = model.replace(/\[1m\]$/, '');
  const words = withoutContext
    .split(/[-_]/)
    .filter(Boolean)
    .map(word => {
      if (/^gpt$/i.test(word)) return 'GPT';
      if (/^\d+(?:\.\d+)*$/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    });
  return `${words.join(' ')}${contextSuffix}`;
}

/** Read only the root TOML table. A value below a table header belongs to that
 * table/profile and is not the default used by Exawatt's bare launch. */
function parseCodexRootString(raw: string, key: string): string | null {
  const root = raw.split(/^\s*\[/m, 1)[0] ?? '';
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = root.match(
    new RegExp(
      `^\\s*${escapedKey}\\s*=\\s*("(?:\\\\.|[^"\\\\])*"|'[^']*')\\s*(?:#.*)?$`,
      'm'
    )
  );
  if (!match) return null;
  const literal = match[1];
  let value: string;
  try {
    value = literal.startsWith('"')
      ? (JSON.parse(literal) as string)
      : literal.slice(1, -1);
  } catch {
    return null;
  }
  return value;
}

export function parseCodexConfiguredModel(raw: string): string | null {
  const value = parseCodexRootString(raw, 'model');
  return isValidAgentModel(value) ? value : null;
}

export function parseCodexConfiguredEffort(raw: string): string | null {
  const value = parseCodexRootString(raw, 'model_reasoning_effort');
  return isValidAgentEffort(value) ? value : null;
}

export function parseCodexModelCatalog(
  raw: string,
  configuredModel: string | null,
  configuredEffort: string | null = null
): AgentModelCatalog {
  let parsed: { models?: unknown } = {};
  try {
    parsed = JSON.parse(raw) as { models?: unknown };
  } catch {
    // The configured value remains launchable even if catalog discovery fails.
  }
  const entries = Array.isArray(parsed.models)
    ? (parsed.models as CodexCatalogEntry[])
    : [];
  const models: AgentModelOption[] = entries
    .filter(
      entry => isValidAgentModel(entry.slug) && entry.visibility !== 'hide'
    )
    .sort((a, b) => {
      const left = typeof a.priority === 'number' ? a.priority : Infinity;
      const right = typeof b.priority === 'number' ? b.priority : Infinity;
      return left - right;
    })
    .map(entry => {
      const levels = Array.isArray(entry.supported_reasoning_levels)
        ? (entry.supported_reasoning_levels as CodexReasoningLevel[])
        : [];
      const efforts = levels
        .filter(level => isValidAgentEffort(level.effort))
        .map(level => ({
          id: level.effort as string,
          label: formatAgentEffortLabel(level.effort as string),
          description:
            typeof level.description === 'string' && level.description.trim()
              ? level.description.trim()
              : 'Supported by this model in the installed Codex CLI.',
        }));
      const reportedDefault = isValidAgentEffort(entry.default_reasoning_level)
        ? entry.default_reasoning_level
        : null;
      return {
        id: entry.slug as string,
        label:
          typeof entry.display_name === 'string' && entry.display_name.trim()
            ? entry.display_name.trim()
            : formatAgentModelLabel(entry.slug as string),
        description:
          typeof entry.description === 'string' && entry.description.trim()
            ? entry.description.trim()
            : 'Available in the installed Codex CLI.',
        defaultEffort:
          reportedDefault &&
          efforts.some(option => option.id === reportedDefault)
            ? reportedDefault
            : (efforts[0]?.id ?? null),
        efforts,
      };
    });
  const discoveredModelCount = models.length;
  if (configuredModel && !models.some(model => model.id === configuredModel)) {
    const efforts = configuredEffort
      ? [
          {
            id: configuredEffort,
            label: formatAgentEffortLabel(configuredEffort),
            description: 'Selected in your Codex configuration.',
          },
        ]
      : [];
    models.unshift({
      id: configuredModel,
      label: formatAgentModelLabel(configuredModel),
      description: 'Selected in your Codex configuration.',
      defaultEffort: configuredEffort,
      efforts,
    });
  }
  const effectiveModel = configuredModel ?? models[0]?.id ?? null;
  const effectiveModelOption = models.find(
    model => model.id === effectiveModel
  );
  const configuredEffortSupported =
    configuredEffort &&
    (effectiveModelOption?.efforts.length === 0 ||
      effectiveModelOption?.efforts.some(
        option => option.id === configuredEffort
      ));
  const effectiveEffort = configuredEffortSupported
    ? configuredEffort
    : (effectiveModelOption?.defaultEffort ?? null);
  return {
    harness: 'codex',
    effectiveModel,
    effectiveModelLabel: effectiveModel
      ? (effectiveModelOption?.label ?? formatAgentModelLabel(effectiveModel))
      : 'Source default',
    effectiveModelSource: configuredModel
      ? 'config'
      : effectiveModel
        ? 'harness-recommended'
        : 'unavailable',
    effectiveEffort,
    effectiveEffortLabel: effectiveEffort
      ? formatAgentEffortLabel(effectiveEffort)
      : 'Model default',
    effectiveEffortSource: configuredEffortSupported
      ? 'config'
      : effectiveEffort
        ? 'model-default'
        : 'unavailable',
    effortLocked: false,
    models,
    catalogMode:
      discoveredModelCount > 0
        ? 'live-catalog'
        : models.length > 0
          ? 'configured-values'
          : 'unavailable',
    catalogProvenance:
      discoveredModelCount > 0
        ? 'Installed Codex CLI · codex debug models'
        : configuredModel
          ? 'Codex configuration'
          : 'Codex model discovery unavailable',
    observedAt: Date.now(),
    selectionAction: null,
  };
}

/** Parse the exact 1.3.4 `opencode models --verbose` stream: one
 * `provider/model` line followed by one pretty-printed JSON model record.
 * The installed binary emits those pairs directly from its provider catalog;
 * JSON may span arbitrary lines, so completion is detected by successful
 * parsing rather than indentation or brace counting. */
export function parseOpencodeModelCatalog(
  raw: string,
  configuredModel: string | null = null
): AgentModelCatalog {
  const lines = raw.split(/\r?\n/);
  const models: AgentModelOption[] = [];
  for (let index = 0; index < lines.length && models.length < 2_000; index++) {
    const modelId = lines[index]?.trim() ?? '';
    if (!isValidAgentModel(modelId) || !modelId.includes('/')) continue;
    let json = '';
    let parsed: OpencodeCatalogEntry | null = null;
    let end = index + 1;
    for (; end < lines.length; end++) {
      json += `${lines[end]}\n`;
      try {
        const candidate = JSON.parse(json) as unknown;
        if (candidate && typeof candidate === 'object') {
          parsed = candidate as OpencodeCatalogEntry;
          break;
        }
      } catch {
        // A pretty-printed record is incomplete until its closing brace.
      }
    }
    if (!parsed) continue;
    index = end;
    const providerId = modelId.slice(0, modelId.indexOf('/'));
    if (
      typeof parsed.providerID === 'string' &&
      parsed.providerID !== providerId
    ) {
      continue;
    }
    const variants =
      parsed.variants && typeof parsed.variants === 'object'
        ? Object.keys(parsed.variants as Record<string, unknown>)
            .filter(isValidAgentEffort)
            .sort()
        : [];
    const family =
      typeof parsed.family === 'string' && parsed.family.trim()
        ? parsed.family.trim()
        : null;
    models.push({
      id: modelId,
      label:
        typeof parsed.name === 'string' && parsed.name.trim()
          ? parsed.name.trim()
          : formatAgentModelLabel(modelId.slice(modelId.indexOf('/') + 1)),
      description: family
        ? `${providerId} · ${family}`
        : `Available through ${providerId} in the installed OpenCode CLI.`,
      // The source reports accepted variants but no default variant. Never
      // turn the first object key into a launch policy.
      defaultEffort: null,
      efforts: variants.map(variant => ({
        id: variant,
        label: formatAgentEffortLabel(variant),
        description: `Reported for this model by the installed OpenCode CLI.`,
      })),
    });
  }

  const discoveredModelCount = models.length;
  if (configuredModel && !models.some(model => model.id === configuredModel)) {
    models.unshift({
      id: configuredModel,
      label: formatAgentModelLabel(configuredModel),
      description: 'Selected in the active OpenCode configuration.',
      defaultEffort: null,
      efforts: [],
    });
  }
  const effectiveModel = configuredModel;
  const effective = models.find(model => model.id === effectiveModel);
  return {
    harness: 'opencode',
    effectiveModel,
    effectiveModelLabel: effective?.label ?? 'Source default',
    effectiveModelSource: configuredModel ? 'config' : 'unavailable',
    effectiveEffort: null,
    effectiveEffortLabel: 'Model default',
    effectiveEffortSource: 'unavailable',
    effortLocked: false,
    models,
    catalogMode:
      discoveredModelCount > 0
        ? 'live-catalog'
        : configuredModel
          ? 'configured-values'
          : 'unavailable',
    catalogProvenance:
      discoveredModelCount > 0
        ? 'Installed OpenCode CLI · opencode models --verbose'
        : configuredModel
          ? 'OpenCode configuration'
          : 'OpenCode model discovery unavailable',
    observedAt: Date.now(),
    selectionAction: null,
  };
}

/**
 * Grok Build's authentication banner — the first line of `grok models`.
 *
 * Verified against grok 1.0.3: the command prints exactly one of these five
 * lines, then a blank line, then `Default model: <id>`, a blank line, and
 * `Available models:` followed by one `  * <id> (default)` / `  - <id>` row
 * per model. There is no `--json`, no per-model description, and no effort
 * enumeration on this surface (efforts exist only over the ACP
 * `x.ai/models/list` response, which a PTY launch never opens), so the
 * catalog is model IDs and a default — nothing is invented to fill the gap.
 */
export function parseGrokAuthBanner(raw: string): {
  authenticated: boolean;
  identity: string;
  detail: string;
} | null {
  const line = raw
    .split(/\r?\n/)
    .map(value => value.trim())
    .find(Boolean);
  if (!line) return null;
  if (/^You are not authenticated\./i.test(line)) {
    return {
      authenticated: false,
      identity: 'Not signed in',
      detail: 'Grok Build reports no active credential.',
    };
  }
  if (/^You are using XAI_API_KEY\./i.test(line)) {
    return {
      authenticated: true,
      identity: 'XAI_API_KEY',
      detail:
        'Grok Build reads the key from this shell. Exawatt never receives or stores it.',
    };
  }
  const loggedIn = line.match(/^You are logged in with (.+?)\.$/i);
  if (loggedIn) {
    return {
      authenticated: true,
      identity: loggedIn[1].trim() || 'Grok account',
      detail:
        'Signed in through Grok Build. The browser OAuth token stays in its own state directory.',
    };
  }
  const byok = line.match(/^Model '(.+?)' is using its own API key\.$/i);
  if (byok) {
    return {
      authenticated: true,
      identity: `${byok[1]} · own API key`,
      detail:
        'A custom model in the Grok Build configuration carries its own credential.',
    };
  }
  if (/^You are authenticated via deployment key\./i.test(line)) {
    return {
      authenticated: true,
      identity: 'Deployment key',
      detail: 'Grok Build is authenticated by an enterprise deployment key.',
    };
  }
  return null;
}

/** Parse the exact `grok models` listing. Rows outside the
 *  `Available models:` block are ignored so the auth banner and any future
 *  preamble can never become a model row. */
export function parseGrokModelCatalog(raw: string): AgentModelCatalog {
  const lines = raw.split(/\r?\n/);
  const defaultLine = lines.find(line => /^Default model:\s*\S/.test(line));
  const reportedDefault = defaultLine
    ? defaultLine.replace(/^Default model:\s*/, '').trim()
    : '';
  const listIndex = lines.findIndex(line =>
    /^Available models:\s*$/.test(line.trim())
  );
  const models: AgentModelOption[] = [];
  let defaultModel: string | null = isValidAgentModel(reportedDefault)
    ? reportedDefault
    : null;
  if (listIndex !== -1) {
    for (
      let index = listIndex + 1;
      index < lines.length && models.length < 500;
      index += 1
    ) {
      const row = lines[index].trim();
      if (!row) continue;
      const match = row.match(/^[*-]\s+(\S+)(\s+\(default\))?$/);
      if (!match) break;
      const id = match[1];
      if (!isValidAgentModel(id)) continue;
      if (models.some(model => model.id === id)) continue;
      if (match[2]) defaultModel = id;
      models.push({
        id,
        label: formatAgentModelLabel(id),
        description: 'Reported by the installed Grok Build CLI.',
        // Grok accepts `--reasoning-effort`, but the per-model option set is
        // not published to any interface a PTY launch can read. An empty
        // list renders as absent; a guessed list would be a launch policy.
        defaultEffort: null,
        efforts: [],
      });
    }
  }
  if (defaultModel && !models.some(model => model.id === defaultModel)) {
    models.unshift({
      id: defaultModel,
      label: formatAgentModelLabel(defaultModel),
      description: 'Reported as the default by the installed Grok Build CLI.',
      defaultEffort: null,
      efforts: [],
    });
  }
  const effective = models.find(model => model.id === defaultModel);
  return {
    harness: 'grok',
    effectiveModel: defaultModel,
    effectiveModelLabel: effective?.label ?? 'Source default',
    // `grok models` reports a CONCRETE, enumerable model id as its default, so
    // this is a harness recommendation, not an account default. The distinction
    // is load-bearing at the launch boundary: `account-default` means "the
    // account decides and Exawatt holds no id to pin", which is why the
    // composer omits the model flag for it (Claude's `default` sentinel, or a
    // source-owned catalog with no id at all). Calling a real model id an
    // account default made the composer show `Eval Grok 4.5` as the selection
    // and then launch without `-m`, leaving the source free to pick something
    // else than the name on screen (BUG-039). Codex classifies the identical
    // shape as `harness-recommended`; this now matches it.
    effectiveModelSource: defaultModel ? 'harness-recommended' : 'unavailable',
    effectiveEffort: null,
    effectiveEffortLabel: 'Source default',
    effectiveEffortSource: 'unavailable',
    effortLocked: false,
    models,
    catalogMode: models.length > 0 ? 'live-catalog' : 'unavailable',
    catalogProvenance:
      models.length > 0
        ? 'Installed Grok Build CLI · grok models'
        : 'Grok Build model discovery unavailable',
    observedAt: Date.now(),
    selectionAction: null,
  };
}

interface ClaudeSettings {
  model?: unknown;
  effortLevel?: unknown;
  availableModels?: unknown;
  env?: unknown;
}

interface ClaudeModelInfo {
  value?: unknown;
  displayName?: unknown;
  description?: unknown;
  supportsEffort?: unknown;
  supportedEffortLevels?: unknown;
}

const CLAUDE_EFFORTS_BY_ID = new Map(
  CLAUDE_EFFORTS.map(effort => [effort.id, effort])
);
const CLAUDE_AUTO_EFFORT = CLAUDE_EFFORTS[0];

function claudeModelFromInfo(info: ClaudeModelInfo): AgentModelOption | null {
  if (!isValidAgentModel(info.value)) return null;
  const levels = Array.isArray(info.supportedEffortLevels)
    ? info.supportedEffortLevels
        .filter(isValidAgentEffort)
        // Exawatt's own 'auto' row already means "the model's default", so a
        // reported level of that name must not produce a duplicate option.
        .filter(level => level !== CLAUDE_AUTO_EFFORT.id)
    : [];
  const label =
    typeof info.displayName === 'string' && info.displayName.trim()
      ? info.displayName.trim()
      : formatAgentModelLabel(info.value);
  return {
    id: info.value,
    label,
    description:
      typeof info.description === 'string' && info.description.trim()
        ? info.description.trim()
        : 'Offered by the installed Claude Code CLI.',
    defaultEffort: 'auto',
    efforts:
      info.supportsEffort === true && levels.length > 0
        ? [
            CLAUDE_AUTO_EFFORT,
            // Levels Exawatt has no copy for still belong in the picker: the
            // installed CLI is the authority on what this model accepts.
            ...levels.map(
              id =>
                CLAUDE_EFFORTS_BY_ID.get(id) ?? {
                  id,
                  label: formatAgentEffortLabel(id),
                  description:
                    'Supported by this model in the installed Claude Code CLI.',
                }
            ),
          ]
        : [CLAUDE_AUTO_EFFORT],
  };
}

/** Reads the model rows out of a Claude Code `initialize` control response —
 * the same `getModelOptions()` list its own `/model` picker renders. Only the
 * selectable rows: Claude Code reports models the account can see but not run
 * under a separate `unavailable_models` key, and Exawatt has no disabled-row
 * presentation to render them honestly yet. */
export function parseClaudeModelCatalog(
  raw: string
): AgentModelOption[] | null {
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let message: unknown;
    try {
      message = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!message || typeof message !== 'object') continue;
    const envelope = message as {
      type?: unknown;
      response?: { response?: { models?: unknown } };
    };
    if (envelope.type !== 'control_response') continue;
    const reported = envelope.response?.response?.models;
    if (!Array.isArray(reported)) continue;
    const models = reported
      .map(entry =>
        entry && typeof entry === 'object'
          ? claudeModelFromInfo(entry as ClaudeModelInfo)
          : null
      )
      .filter((model): model is AgentModelOption => model !== null);
    if (models.length > 0) return models;
  }
  return null;
}

/**
 * @param reported Models exactly as the installed CLI described them, or null
 * when it could not be asked. A reported list is authoritative: Claude Code has
 * already applied entitlements, the settings cascade, and env overrides, so
 * Exawatt must not add rows of its own on top of it.
 */
export function buildClaudeModelCatalog(
  reported: AgentModelOption[] | null,
  layers: unknown[],
  environment: NodeJS.ProcessEnv
): AgentModelCatalog {
  let configuredModel: string | null = null;
  let configuredEffort: string | null = null;
  let settingsEnvironmentModel: string | null = null;
  let settingsEnvironmentEffort: string | null = null;
  const available = new Set<string>();

  for (const raw of layers) {
    if (!raw || typeof raw !== 'object') continue;
    const settings = raw as ClaudeSettings;
    if (isValidAgentModel(settings.model)) configuredModel = settings.model;
    if (isValidAgentEffort(settings.effortLevel)) {
      configuredEffort = settings.effortLevel;
    }
    if (Array.isArray(settings.availableModels)) {
      for (const value of settings.availableModels) {
        if (isValidAgentModel(value)) available.add(value);
      }
    }
    if (settings.env && typeof settings.env === 'object') {
      const values = settings.env as Record<string, unknown>;
      if (isValidAgentModel(values.ANTHROPIC_MODEL)) {
        settingsEnvironmentModel = values.ANTHROPIC_MODEL;
      }
      if (isValidAgentEffort(values.CLAUDE_CODE_EFFORT_LEVEL)) {
        settingsEnvironmentEffort = values.CLAUDE_CODE_EFFORT_LEVEL;
      }
    }
  }

  const processModel = isValidAgentModel(environment.ANTHROPIC_MODEL)
    ? environment.ANTHROPIC_MODEL
    : null;
  const processEffort = isValidAgentEffort(environment.CLAUDE_CODE_EFFORT_LEVEL)
    ? environment.CLAUDE_CODE_EFFORT_LEVEL
    : null;
  const effortLocked = Boolean(processEffort ?? settingsEnvironmentEffort);
  const environmentEffort = processEffort ?? settingsEnvironmentEffort;
  const configuredEffectiveModel =
    processModel ?? settingsEnvironmentModel ?? configuredModel;
  const reportedDefault =
    reported?.find(model => model.id === 'default') ?? reported?.[0] ?? null;
  const effectiveModel =
    configuredEffectiveModel ?? reportedDefault?.id ?? null;
  const models = reported ? [...reported] : [];

  if (!reported) {
    for (const id of available) {
      if (models.some(model => model.id === id)) continue;
      models.push(
        configuredClaudeModel(
          id,
          formatAgentModelLabel(id),
          'Listed in your Claude Code settings.',
          id === effectiveModel ? (environmentEffort ?? configuredEffort) : null
        )
      );
    }
    const customModel = environment.ANTHROPIC_CUSTOM_MODEL_OPTION;
    if (
      isValidAgentModel(customModel) &&
      !models.some(model => model.id === customModel)
    ) {
      models.push(
        configuredClaudeModel(
          customModel,
          environment.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME?.trim() ||
            formatAgentModelLabel(customModel),
          environment.ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION?.trim() ||
            'Custom model available to Claude Code.',
          customModel === effectiveModel
            ? (environmentEffort ?? configuredEffort)
            : null
        )
      );
    }
    if (effectiveModel && !models.some(model => model.id === effectiveModel)) {
      models.unshift(
        configuredClaudeModel(
          effectiveModel,
          formatAgentModelLabel(effectiveModel),
          'Selected in your Claude Code configuration.',
          environmentEffort ?? configuredEffort
        )
      );
    }
  }

  const effectiveModelOption = models.find(
    model => model.id === effectiveModel
  );
  const configuredEffortSupported =
    configuredEffort &&
    (effectiveModelOption?.efforts.length === 0 ||
      effectiveModelOption?.efforts.some(
        option => option.id === configuredEffort
      ));
  const effectiveEffort = effortLocked
    ? environmentEffort
    : configuredEffortSupported
      ? configuredEffort
      : (effectiveModelOption?.defaultEffort ?? null);
  const usesAccountDefault =
    !configuredEffectiveModel && effectiveModel === 'default';
  const catalogMode = reported
    ? 'live-catalog'
    : models.length > 0
      ? 'configured-values'
      : 'source-owned';

  return {
    harness: 'claude',
    effectiveModel,
    effectiveModelLabel: effectiveModel
      ? (effectiveModelOption?.label ?? formatAgentModelLabel(effectiveModel))
      : 'Account default',
    effectiveModelSource: usesAccountDefault
      ? 'account-default'
      : configuredEffectiveModel
        ? 'config'
        : effectiveModel
          ? 'harness-recommended'
          : 'account-default',
    effectiveEffort,
    effectiveEffortLabel: effectiveEffort
      ? formatAgentEffortLabel(effectiveEffort)
      : 'Model default',
    effectiveEffortSource: effortLocked
      ? 'environment'
      : configuredEffortSupported
        ? 'config'
        : effectiveEffort
          ? 'model-default'
          : 'unavailable',
    effortLocked,
    models,
    catalogMode,
    catalogProvenance: reported
      ? 'Installed Claude Code CLI · SDK control protocol'
      : models.length > 0
        ? 'Claude Code layered configuration'
        : 'Claude Code account default',
    observedAt: Date.now(),
    selectionAction: models.length > 0 ? null : 'choose-in-source',
  };
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.promises.readFile(file, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

async function loginModelEnvironment(
  shell: string,
  cwd: string
): Promise<NodeJS.ProcessEnv> {
  const printCommand = MODEL_ENV_KEYS.map(
    key => `printf '${key}=%s\\n' "\${${key}-}"`
  ).join('; ');
  try {
    const result = await execWithDeadline(shell, printCommand, {
      cwd,
      timeout: 2_000,
      maxBuffer: 64 * 1024,
    });
    const resolved: NodeJS.ProcessEnv = { ...process.env };
    for (const line of result.stdout.split('\n')) {
      const separator = line.indexOf('=');
      if (separator < 1) continue;
      const key = line.slice(0, separator);
      if (!MODEL_ENV_KEYS.includes(key as (typeof MODEL_ENV_KEYS)[number])) {
        continue;
      }
      const value = line.slice(separator + 1);
      if (value) resolved[key] = value;
      else delete resolved[key];
    }
    return resolved;
  } catch {
    return { ...process.env };
  }
}

function testHarnessExecutable(harness: string): string | null {
  return process.env.EXAWATT_TEST === '1' &&
    process.env.EXAWATT_TEST_HARNESS_BIN &&
    path.isAbsolute(process.env.EXAWATT_TEST_HARNESS_BIN)
    ? path.join(process.env.EXAWATT_TEST_HARNESS_BIN, harness)
    : null;
}

// Claude Code has no catalog subcommand, but its SDK handshake carries one: the
// `initialize` control response returns the exact rows `/model` renders, each
// with the `--model` value Exawatt has to pass back. `--safe-mode` keeps the
// probe side-effect free (no hooks, plugins, or MCP) while leaving auth, the
// settings cascade, and model selection intact.
const CLAUDE_CATALOG_REQUEST = JSON.stringify({
  type: 'control_request',
  request_id: 'exawatt-model-catalog',
  request: { subtype: 'initialize' },
});

async function readClaudeModelOptions(
  cwd: string,
  shell: string
): Promise<AgentModelOption[] | null> {
  const executable = testHarnessExecutable('claude');
  const invocation = executable ? shellQuote(executable) : 'claude';
  const catalogCommand =
    `printf '%s\\n' ${shellQuote(CLAUDE_CATALOG_REQUEST)} | ` +
    `${invocation} --safe-mode --input-format stream-json ` +
    `--output-format stream-json --verbose -p`;
  try {
    const result = await execWithDeadline(shell, catalogCommand, {
      cwd,
      timeout: 20_000,
      maxBuffer: 5 * 1024 * 1024,
    });
    return result.timedOut ? null : parseClaudeModelCatalog(result.stdout);
  } catch {
    // Older CLIs, a failed launch, or a slow cold start leave the catalog
    // unknown; the caller then reports the configured values it can see
    // rather than inventing an account catalog.
    return null;
  }
}

interface ClaudeCatalogCacheEntry {
  expires: number;
  models: AgentModelOption[];
}

const CLAUDE_CATALOG_TTL_MS = 5 * 60_000;
const claudeCatalogCache = new Map<string, ClaudeCatalogCacheEntry>();
const claudeCatalogInFlight = new Map<
  string,
  Promise<AgentModelOption[] | null>
>();

async function cachedClaudeModelOptions(
  cwd: string,
  shell: string
): Promise<AgentModelOption[] | null> {
  const key = `${shell}\u0000${cwd}`;
  const cached = claudeCatalogCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.models;
  // One probe per Project at a time: the composer can ask again while the first
  // CLI launch is still running, and a second spawn would only answer the same
  // thing a second later.
  const inFlight = claudeCatalogInFlight.get(key);
  if (inFlight) return inFlight;
  const probe = readClaudeModelOptions(cwd, shell).finally(() => {
    claudeCatalogInFlight.delete(key);
  });
  claudeCatalogInFlight.set(key, probe);
  const models = await probe;
  // Only a successful probe is cached: a failure should retry on the next open,
  // not pin the configured-values view for five minutes.
  if (models) {
    claudeCatalogCache.set(key, {
      expires: Date.now() + CLAUDE_CATALOG_TTL_MS,
      models,
    });
  }
  return models;
}

async function listClaudeModels(
  cwd: string,
  shell: string,
  environment: NodeJS.ProcessEnv
): Promise<AgentModelCatalog> {
  const configDir =
    environment.CLAUDE_CONFIG_DIR ||
    path.join(environment.HOME || os.homedir(), '.claude');
  // Lowest → highest personal/project precedence. Managed policy is still
  // enforced by Claude Code itself; this catalog never claims to replace it.
  const [reported, layers] = await Promise.all([
    cachedClaudeModelOptions(cwd, shell),
    Promise.all([
      readJson(path.join(configDir, 'settings.json')),
      readJson(path.join(cwd, '.claude', 'settings.json')),
      readJson(path.join(cwd, '.claude', 'settings.local.json')),
    ]),
  ]);
  return buildClaudeModelCatalog(reported, layers, environment);
}

async function listCodexModels(
  cwd: string,
  shell: string,
  environment: NodeJS.ProcessEnv
): Promise<AgentModelCatalog> {
  const configDir =
    environment.CODEX_HOME ||
    path.join(environment.HOME || os.homedir(), '.codex');
  let configuredModel: string | null = null;
  let configuredEffort: string | null = null;
  try {
    const config = await fs.promises.readFile(
      path.join(configDir, 'config.toml'),
      'utf8'
    );
    configuredModel = parseCodexConfiguredModel(config);
    configuredEffort = parseCodexConfiguredEffort(config);
  } catch {
    // An absent config means the installed CLI's recommended model wins.
  }
  let stdout = '';
  try {
    const executable = testHarnessExecutable('codex');
    const catalogCommand = executable
      ? `${shellQuote(executable)} debug models`
      : 'codex debug models';
    const result = await execWithDeadline(shell, catalogCommand, {
      cwd,
      timeout: 5_000,
      maxBuffer: 5 * 1024 * 1024,
    });
    stdout = result.stdout;
  } catch {
    // Offline/older CLIs still expose an explicitly configured model.
  }
  return parseCodexModelCatalog(stdout, configuredModel, configuredEffort);
}

const OPENCODE_CATALOG_TTL_MS = 5 * 60_000;

interface OpencodeCatalogCacheEntry {
  expiresAt: number;
  catalog: AgentModelCatalog;
}

type OpencodeCatalogProbe = () => Promise<AgentModelCatalog>;

/**
 * Cache only complete source observations. The original observedAt remains the
 * freshness boundary on a cache hit; opening the composer must not make old
 * evidence look newly observed.
 */
export class OpencodeModelCatalogCache {
  private readonly entries = new Map<string, OpencodeCatalogCacheEntry>();
  private readonly inFlight = new Map<string, Promise<AgentModelCatalog>>();

  constructor(
    private readonly ttlMs = OPENCODE_CATALOG_TTL_MS,
    private readonly now: () => number = Date.now
  ) {}

  async read(
    context: string,
    probe: OpencodeCatalogProbe
  ): Promise<AgentModelCatalog> {
    const cached = this.entries.get(context);
    if (cached && cached.expiresAt > this.now()) {
      return {
        ...cached.catalog,
        catalogProvenance: `${cached.catalog.catalogProvenance} · cached observation`,
      };
    }

    const running = this.inFlight.get(context);
    if (running) return running;

    const observation = probe().finally(() => {
      this.inFlight.delete(context);
    });
    this.inFlight.set(context, observation);
    const catalog = await observation;
    // A failed or empty probe stays retryable. It must not turn a transient
    // source failure into five minutes of fabricated catalog certainty.
    if (catalog.catalogMode === 'live-catalog') {
      this.entries.set(context, {
        expiresAt: this.now() + this.ttlMs,
        catalog,
      });
    }
    return catalog;
  }
}

const opencodeCatalogCache = new OpencodeModelCatalogCache();

/**
 * OpenCode's catalog varies with Project-local configuration and login-shell
 * config locations. Inline config may contain credentials and can change
 * independently between calls, so it is neither retained nor reduced to a
 * cache key: that context simply bypasses the cache.
 */
export function opencodeCatalogContext(
  cwd: string,
  shell: string,
  environment: NodeJS.ProcessEnv
): string | null {
  if (environment.OPENCODE_CONFIG_CONTENT) return null;
  return JSON.stringify([
    shell,
    path.resolve(cwd),
    environment.HOME || '',
    environment.XDG_CONFIG_HOME || '',
    environment.OPENCODE_CONFIG || '',
    environment.OPENCODE_CONFIG_DIR || '',
  ]);
}

async function readOpencodeModelCatalog(
  cwd: string,
  shell: string
): Promise<AgentModelCatalog> {
  let stdout = '';
  try {
    const executable = testHarnessExecutable('opencode');
    const catalogCommand = executable
      ? `${shellQuote(executable)} models --verbose`
      : 'opencode models --verbose';
    const result = await execWithDeadline(shell, catalogCommand, {
      cwd,
      timeout: 20_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    stdout = result.stdout;
  } catch {
    // A failed catalog probe leaves the source default explicit and adds no
    // invented rows. Provider credentials remain entirely source-owned.
  }
  return parseOpencodeModelCatalog(stdout);
}

async function listOpencodeModels(
  cwd: string,
  shell: string,
  environment: NodeJS.ProcessEnv
): Promise<AgentModelCatalog> {
  const context = opencodeCatalogContext(cwd, shell, environment);
  return context
    ? opencodeCatalogCache.read(context, () =>
        readOpencodeModelCatalog(cwd, shell)
      )
    : readOpencodeModelCatalog(cwd, shell);
}

/**
 * `grok models` starts the agent backend to answer, so it is slower than a
 * flag parse and gets the same generous deadline OpenCode's catalog does.
 * Measured at ~2 s unauthenticated on grok 1.0.3.
 */
export async function readGrokModelCatalog(
  cwd: string,
  shell: string
): Promise<AgentModelCatalog> {
  let stdout = '';
  try {
    const executable = testHarnessExecutable('grok');
    const catalogCommand = executable
      ? `${shellQuote(executable)} models`
      : 'grok models';
    const result = await execWithDeadline(shell, catalogCommand, {
      cwd,
      timeout: 20_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    stdout = result.stdout;
  } catch {
    // A failed probe leaves the catalog explicitly unavailable. No row is
    // invented, and no credential is read to compensate.
  }
  return parseGrokModelCatalog(stdout);
}

async function probeAgentModels(
  harness: Exclude<PtyHarness, 'shell'>,
  cwd: string,
  shell: string
): Promise<AgentModelCatalog> {
  const environment = await loginModelEnvironment(shell, cwd);
  if (harness === 'codex') {
    return listCodexModels(cwd, shell, environment);
  }
  if (harness === 'opencode') {
    return listOpencodeModels(cwd, shell, environment);
  }
  if (harness === 'grok') {
    return readGrokModelCatalog(cwd, shell);
  }
  return listClaudeModels(cwd, shell, environment);
}

let catalogCache: AgentModelCatalogCache | null = null;

/** Injected by the main process once userData is known; testable by design. */
export function setAgentModelCatalogCache(
  cache: AgentModelCatalogCache | null
): void {
  catalogCache = cache;
}

const revalidating = new Set<string>();

/**
 * Read an engine's catalog, stale-while-revalidate (ENG-016 D49).
 *
 * A fresh cached catalog is returned without touching the CLI at all. A stale
 * one is returned immediately AND re-probed in the background, so the common
 * case is instant and the data still converges. `refresh` forces a probe and
 * waits for it — that is what the engine menu's Refresh action calls.
 */
export async function listAgentModels(
  harness: Exclude<PtyHarness, 'shell'>,
  cwd: string,
  shell: string,
  refresh = false
): Promise<AgentModelCatalog> {
  const cache = catalogCache;
  if (!cache) return probeAgentModels(harness, cwd, shell);

  const key = catalogCacheKey(harness, cwd, shell);
  if (!refresh) {
    const cached = await cache.read(key);
    if (cached) {
      if (!cached.fresh && !revalidating.has(key)) {
        revalidating.add(key);
        void probeAgentModels(harness, cwd, shell)
          .then(catalog => cache.write(key, cwd, catalog))
          .catch(() => undefined)
          .finally(() => revalidating.delete(key));
      }
      return { ...cached.catalog, servedFromCache: true };
    }
  }

  const catalog = await probeAgentModels(harness, cwd, shell);
  void cache.write(key, cwd, catalog).catch(() => undefined);
  return catalog;
}

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { PtyHarness } from './session-manager';

const execFileAsync = promisify(execFile);
const MODEL_ENV_KEYS = [
  'HOME',
  'CODEX_HOME',
  'CLAUDE_CONFIG_DIR',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_CUSTOM_MODEL_OPTION',
  'ANTHROPIC_CUSTOM_MODEL_OPTION_NAME',
  'ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION',
  'CLAUDE_CODE_EFFORT_LEVEL',
] as const;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

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
  effectiveModelSource:
    | 'config'
    | 'harness-recommended'
    | 'account-default'
    | 'unavailable';
  /** The effort Exawatt will pin unless null/auto leaves it to the harness. */
  effectiveEffort: string | null;
  effectiveEffortSource:
    | 'config'
    | 'model-default'
    | 'environment'
    | 'unavailable';
  effortLocked: boolean;
  models: AgentModelOption[];
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

function claudeModel(
  id: string,
  label: string,
  description: string,
  efforts: AgentEffortOption[] = CLAUDE_EFFORTS
): AgentModelOption {
  return {
    id,
    label,
    description,
    defaultEffort: 'auto',
    efforts,
  };
}

const CLAUDE_MODELS: AgentModelOption[] = [
  claudeModel(
    'default',
    'Account default',
    'Claude Code chooses the recommended model for your account.'
  ),
  claudeModel('opus', 'Opus', 'Most capable Claude model for complex work.'),
  claudeModel(
    'sonnet',
    'Sonnet',
    'Balanced Claude model for everyday coding.',
    CLAUDE_EFFORTS.filter(effort => effort.id !== 'xhigh')
  ),
  claudeModel(
    'haiku',
    'Haiku',
    'Fast Claude model for focused tasks.',
    CLAUDE_EFFORTS.filter(effort => effort.id === 'auto')
  ),
  claudeModel(
    'opusplan',
    'Opus plan',
    'Opus while planning, then Sonnet while executing.',
    CLAUDE_EFFORTS.filter(effort => effort.id !== 'xhigh')
  ),
];

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
    effectiveModelSource: configuredModel
      ? 'config'
      : effectiveModel
        ? 'harness-recommended'
        : 'unavailable',
    effectiveEffort,
    effectiveEffortSource: configuredEffortSupported
      ? 'config'
      : effectiveEffort
        ? 'model-default'
        : 'unavailable',
    effortLocked: false,
    models,
  };
}

interface ClaudeSettings {
  model?: unknown;
  effortLevel?: unknown;
  availableModels?: unknown;
  env?: unknown;
}

export function buildClaudeModelCatalog(
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
  const effectiveModel =
    processModel ?? settingsEnvironmentModel ?? configuredModel ?? 'default';
  const processEffort = isValidAgentEffort(environment.CLAUDE_CODE_EFFORT_LEVEL)
    ? environment.CLAUDE_CODE_EFFORT_LEVEL
    : null;
  const effortLocked = Boolean(processEffort ?? settingsEnvironmentEffort);
  const models = [...CLAUDE_MODELS];
  for (const id of available) {
    if (!models.some(model => model.id === id)) {
      models.push(
        claudeModel(
          id,
          formatAgentModelLabel(id),
          'Available in your Claude Code settings.'
        )
      );
    }
  }
  const customModel = environment.ANTHROPIC_CUSTOM_MODEL_OPTION;
  if (
    isValidAgentModel(customModel) &&
    !models.some(model => model.id === customModel)
  ) {
    models.push(
      claudeModel(
        customModel,
        environment.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME?.trim() ||
          formatAgentModelLabel(customModel),
        environment.ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION?.trim() ||
          'Custom model available to Claude Code.'
      )
    );
  }
  if (!models.some(model => model.id === effectiveModel)) {
    models.unshift(
      claudeModel(
        effectiveModel,
        formatAgentModelLabel(effectiveModel),
        'Selected in your Claude Code configuration.'
      )
    );
  }

  const environmentEffort = processEffort ?? settingsEnvironmentEffort;
  const effectiveModelOption = models.find(
    model => model.id === effectiveModel
  );
  const configuredEffortSupported =
    configuredEffort &&
    effectiveModelOption?.efforts.some(
      option => option.id === configuredEffort
    );
  const effectiveEffort = effortLocked
    ? environmentEffort
    : configuredEffortSupported
      ? configuredEffort
      : (effectiveModelOption?.defaultEffort ?? 'auto');

  return {
    harness: 'claude',
    effectiveModel,
    effectiveModelSource:
      effectiveModel === 'default' ? 'account-default' : 'config',
    effectiveEffort,
    effectiveEffortSource: effortLocked
      ? 'environment'
      : configuredEffortSupported
        ? 'config'
        : 'model-default',
    effortLocked,
    models,
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
    const result = await execFileAsync(shell, ['-l', '-c', printCommand], {
      cwd,
      timeout: 2_000,
      maxBuffer: 64 * 1024,
      encoding: 'utf8',
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

async function listClaudeModels(
  cwd: string,
  environment: NodeJS.ProcessEnv
): Promise<AgentModelCatalog> {
  const configDir =
    environment.CLAUDE_CONFIG_DIR ||
    path.join(environment.HOME || os.homedir(), '.claude');
  // Lowest → highest personal/project precedence. Managed policy is still
  // enforced by Claude Code itself; this catalog never claims to replace it.
  const layers = await Promise.all([
    readJson(path.join(configDir, 'settings.json')),
    readJson(path.join(cwd, '.claude', 'settings.json')),
    readJson(path.join(cwd, '.claude', 'settings.local.json')),
  ]);
  return buildClaudeModelCatalog(layers, environment);
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
    const testHarnessExecutable =
      process.env.EXAWATT_TEST === '1' &&
      process.env.EXAWATT_TEST_HARNESS_BIN &&
      path.isAbsolute(process.env.EXAWATT_TEST_HARNESS_BIN)
        ? path.join(process.env.EXAWATT_TEST_HARNESS_BIN, 'codex')
        : null;
    const catalogCommand = testHarnessExecutable
      ? `${shellQuote(testHarnessExecutable)} debug models`
      : 'codex debug models';
    const result = await execFileAsync(shell, ['-l', '-c', catalogCommand], {
      cwd,
      timeout: 5_000,
      maxBuffer: 5 * 1024 * 1024,
      encoding: 'utf8',
    });
    stdout = result.stdout;
  } catch {
    // Offline/older CLIs still expose an explicitly configured model.
  }
  return parseCodexModelCatalog(stdout, configuredModel, configuredEffort);
}

export async function listAgentModels(
  harness: Exclude<PtyHarness, 'shell'>,
  cwd: string,
  shell: string
): Promise<AgentModelCatalog> {
  const environment = await loginModelEnvironment(shell, cwd);
  return harness === 'codex'
    ? listCodexModels(cwd, shell, environment)
    : listClaudeModels(cwd, environment);
}

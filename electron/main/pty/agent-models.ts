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
] as const;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export interface AgentModelOption {
  id: string;
  label: string;
  description: string;
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
  models: AgentModelOption[];
}

interface CodexCatalogEntry {
  slug?: unknown;
  display_name?: unknown;
  description?: unknown;
  visibility?: unknown;
  priority?: unknown;
}

const CLAUDE_MODELS: AgentModelOption[] = [
  {
    id: 'default',
    label: 'Account default',
    description: 'Claude Code chooses the recommended model for your account.',
  },
  {
    id: 'opus',
    label: 'Opus',
    description: 'Most capable Claude model for complex work.',
  },
  {
    id: 'sonnet',
    label: 'Sonnet',
    description: 'Balanced Claude model for everyday coding.',
  },
  {
    id: 'haiku',
    label: 'Haiku',
    description: 'Fast Claude model for focused tasks.',
  },
  {
    id: 'opusplan',
    label: 'Opus plan',
    description: 'Opus while planning, then Sonnet while executing.',
  },
];

export function isValidAgentModel(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 512 &&
    !/[\s\u0000-\u001f\u007f]/.test(value)
  );
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

/** Read only the root TOML table. A `model` below a table header belongs to
 * that table/profile and is not the default used by Exawatt's bare launch. */
export function parseCodexConfiguredModel(raw: string): string | null {
  const root = raw.split(/^\s*\[/m, 1)[0] ?? '';
  const match = root.match(
    /^\s*model\s*=\s*("(?:\\.|[^"\\])*"|'[^']*')\s*(?:#.*)?$/m
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
  return isValidAgentModel(value) ? value : null;
}

export function parseCodexModelCatalog(
  raw: string,
  configuredModel: string | null
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
  const models = entries
    .filter(
      entry => isValidAgentModel(entry.slug) && entry.visibility !== 'hide'
    )
    .sort((a, b) => {
      const left = typeof a.priority === 'number' ? a.priority : Infinity;
      const right = typeof b.priority === 'number' ? b.priority : Infinity;
      return left - right;
    })
    .map(entry => ({
      id: entry.slug as string,
      label:
        typeof entry.display_name === 'string' && entry.display_name.trim()
          ? entry.display_name.trim()
          : formatAgentModelLabel(entry.slug as string),
      description:
        typeof entry.description === 'string' && entry.description.trim()
          ? entry.description.trim()
          : 'Available in the installed Codex CLI.',
    }));
  if (configuredModel && !models.some(model => model.id === configuredModel)) {
    models.unshift({
      id: configuredModel,
      label: formatAgentModelLabel(configuredModel),
      description: 'Selected in your Codex configuration.',
    });
  }
  const effectiveModel = configuredModel ?? models[0]?.id ?? null;
  return {
    harness: 'codex',
    effectiveModel,
    effectiveModelSource: configuredModel
      ? 'config'
      : effectiveModel
        ? 'harness-recommended'
        : 'unavailable',
    models,
  };
}

interface ClaudeSettings {
  model?: unknown;
  availableModels?: unknown;
  env?: unknown;
}

export function buildClaudeModelCatalog(
  layers: unknown[],
  environment: NodeJS.ProcessEnv
): AgentModelCatalog {
  let configuredModel: string | null = null;
  let settingsEnvironmentModel: string | null = null;
  const available = new Set<string>();

  for (const raw of layers) {
    if (!raw || typeof raw !== 'object') continue;
    const settings = raw as ClaudeSettings;
    if (isValidAgentModel(settings.model)) configuredModel = settings.model;
    if (Array.isArray(settings.availableModels)) {
      for (const value of settings.availableModels) {
        if (isValidAgentModel(value)) available.add(value);
      }
    }
    if (settings.env && typeof settings.env === 'object') {
      const value = (settings.env as Record<string, unknown>).ANTHROPIC_MODEL;
      if (isValidAgentModel(value)) settingsEnvironmentModel = value;
    }
  }

  const processModel = isValidAgentModel(environment.ANTHROPIC_MODEL)
    ? environment.ANTHROPIC_MODEL
    : null;
  const effectiveModel =
    processModel ?? settingsEnvironmentModel ?? configuredModel ?? 'default';
  const models = [...CLAUDE_MODELS];
  for (const id of available) {
    if (!models.some(model => model.id === id)) {
      models.push({
        id,
        label: formatAgentModelLabel(id),
        description: 'Available in your Claude Code settings.',
      });
    }
  }
  const customModel = environment.ANTHROPIC_CUSTOM_MODEL_OPTION;
  if (
    isValidAgentModel(customModel) &&
    !models.some(model => model.id === customModel)
  ) {
    models.push({
      id: customModel,
      label:
        environment.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME?.trim() ||
        formatAgentModelLabel(customModel),
      description:
        environment.ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION?.trim() ||
        'Custom model available to Claude Code.',
    });
  }
  if (!models.some(model => model.id === effectiveModel)) {
    models.unshift({
      id: effectiveModel,
      label: formatAgentModelLabel(effectiveModel),
      description: 'Selected in your Claude Code configuration.',
    });
  }

  return {
    harness: 'claude',
    effectiveModel,
    effectiveModelSource:
      effectiveModel === 'default' ? 'account-default' : 'config',
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
  try {
    configuredModel = parseCodexConfiguredModel(
      await fs.promises.readFile(path.join(configDir, 'config.toml'), 'utf8')
    );
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
  return parseCodexModelCatalog(stdout, configuredModel);
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

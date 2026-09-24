/**
 * Qwen Code's local records, read without running it (ENG-003 S5.2).
 *
 * Qwen Code has no sign-in status command and no model list command: both
 * live only inside its interactive session. What Exawatt can observe without
 * a model call is what Qwen Code itself wrote down, its settings and its
 * transcripts, so this module reads those and reports them as exactly that:
 * a configured credential, not a working one, and a configured catalog, not
 * an account's entitlement. Measured against Qwen Code 0.24.4.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { QWEN_ADMIN_DEFAULTS_PATH } from '../harness-events/qwen-hooks';

/** The oldest version whose launch, identity and hook contract was verified. */
export const QWEN_MIN_VERSION = [0, 24, 0] as const;

export interface QwenVersion {
  version: string;
  compatible: boolean;
}

export function parseQwenVersion(output: string): QwenVersion | null {
  const match = /\b(\d+)\.(\d+)\.(\d+)\b/.exec(output);
  if (!match) return null;
  const parts = match.slice(1, 4).map(Number);
  let compatible = true;
  for (let index = 0; index < QWEN_MIN_VERSION.length; index += 1) {
    if (parts[index] === QWEN_MIN_VERSION[index]) continue;
    compatible = parts[index] > QWEN_MIN_VERSION[index];
    break;
  }
  return { version: match.slice(1, 4).join('.'), compatible };
}

/**
 * The machine-wide defaults document an administrator may have installed.
 * Exawatt's per-launch document replaces it for that launch, so its content
 * is read here and carried over. Absent is the normal case.
 */
export function readQwenAdminDefaults(
  file = QWEN_ADMIN_DEFAULTS_PATH
): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Qwen Code's user directory: `QWEN_HOME`, else `~/.qwen`. */
export function qwenHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.QWEN_HOME || path.join(os.homedir(), '.qwen');
}

function readJsonObject(file: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readPath(
  source: Record<string, unknown> | null,
  keys: readonly string[]
): unknown {
  let value: unknown = source;
  for (const key of keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

export function readQwenUserSettings(
  env: NodeJS.ProcessEnv = process.env
): Record<string, unknown> | null {
  return readJsonObject(path.join(qwenHome(env), 'settings.json'));
}

/**
 * Where Qwen Code writes transcripts, resolved in its own order:
 * `QWEN_RUNTIME_DIR`, the `advanced.runtimeOutputDir` setting, `QWEN_HOME`,
 * then `~/.qwen`.
 */
export function qwenRuntimeRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.EXAWATT_QWEN_RUNTIME_ROOT) return env.EXAWATT_QWEN_RUNTIME_ROOT;
  if (env.QWEN_RUNTIME_DIR) return env.QWEN_RUNTIME_DIR;
  const configured = readPath(readQwenUserSettings(env), [
    'advanced',
    'runtimeOutputDir',
  ]);
  if (typeof configured === 'string' && configured) {
    return configured.startsWith('~')
      ? path.join(os.homedir(), configured.slice(1))
      : configured;
  }
  return qwenHome(env);
}

/** Qwen Code's project directory name: every non-alphanumeric becomes `-`. */
export function qwenProjectDirname(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

export interface QwenSignIn {
  /** Qwen Code's own name for the configured credential, e.g. `openai`. */
  authType: string;
}

/** The credential Qwen Code is configured to use, or null when none is. */
export function readQwenSignIn(
  settings: Record<string, unknown> | null
): QwenSignIn | null {
  const authType = readPath(settings, ['security', 'auth', 'selectedType']);
  return typeof authType === 'string' && authType ? { authType } : null;
}

export interface QwenConfiguredModel {
  id: string;
  label: string;
  provider: string;
}

/**
 * The models Qwen Code's own settings name: `modelProviders`, keyed by
 * provider, each a list of model entries with an `id`. Unknown shapes are
 * skipped rather than guessed at. `model.name` is the configured default.
 */
export function readQwenConfiguredModels(
  settings: Record<string, unknown> | null
): { models: QwenConfiguredModel[]; defaultModel: string | null } {
  const models: QwenConfiguredModel[] = [];
  const seen = new Set<string>();
  const providers = readPath(settings, ['modelProviders']);
  if (providers && typeof providers === 'object' && !Array.isArray(providers)) {
    for (const [provider, entries] of Object.entries(
      providers as Record<string, unknown>
    )) {
      const list = Array.isArray(entries)
        ? entries
        : readPath(entries as Record<string, unknown>, ['models']);
      if (!Array.isArray(list)) continue;
      for (const entry of list) {
        if (!entry || typeof entry !== 'object') continue;
        const record = entry as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id : null;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        models.push({
          id,
          label:
            typeof record.name === 'string' && record.name ? record.name : id,
          provider,
        });
      }
    }
  }
  const configured = readPath(settings, ['model', 'name']);
  return {
    models,
    defaultModel:
      typeof configured === 'string' && configured ? configured : null,
  };
}

export interface QwenTranscriptHead {
  id: string;
  cwd: string;
  startedAt: number;
  updatedAt: number;
  /** The operator's first real prompt, when the head holds one. */
  title: string | null;
}

function promptText(message: unknown): string | null {
  const parts = readPath(message as Record<string, unknown>, ['parts']);
  if (!Array.isArray(parts)) return null;
  const text = parts
    .map(part =>
      part && typeof part === 'object' && typeof part.text === 'string'
        ? part.text
        : ''
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

/**
 * Read a transcript's head: its session id, launch directory, start time and
 * the operator's first real prompt. The head may end mid-record, so a line
 * that does not parse is skipped rather than failing the file.
 */
export function parseQwenTranscriptHead(
  head: string,
  fallbackId: string,
  updatedAt: number
): QwenTranscriptHead | null {
  let id: string | null = null;
  let cwd: string | null = null;
  let startedAt: number | null = null;
  let title: string | null = null;
  for (const line of head.split('\n')) {
    if (!line.trim()) continue;
    let record: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(line);
      if (!value || typeof value !== 'object') continue;
      record = value as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!id && typeof record.sessionId === 'string') id = record.sessionId;
    if (!cwd && typeof record.cwd === 'string') cwd = record.cwd;
    if (startedAt === null && typeof record.timestamp === 'string') {
      const parsed = Date.parse(record.timestamp);
      if (Number.isFinite(parsed)) startedAt = parsed;
    }
    if (!title && record.type === 'user' && record.provenance === 'real_user') {
      title = promptText(record.message);
    }
    if (id && cwd && startedAt !== null && title) break;
  }
  if (!cwd) return null;
  return {
    id: id ?? fallbackId,
    cwd,
    startedAt: startedAt ?? updatedAt,
    updatedAt,
    title,
  };
}

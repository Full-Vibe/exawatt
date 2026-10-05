/**
 * Antigravity CLI's local records, read without running it (ENG-003 S5.3).
 *
 * Antigravity (`agy`) keeps its state under `~/.gemini/antigravity-cli`:
 * `settings.json` names the model its own picker chose, and
 * `conversation_summaries.db` (SQLite) indexes every conversation with its
 * workspace paths and times. Exawatt reads both read-only and reports them as
 * exactly what they are. Measured against Antigravity CLI 1.2.17.
 *
 * Deliberately never read: `history.jsonl`, which stores prompts verbatim
 * (operator hygiene finding, 2026-09-24), and the `preview` column of the
 * summaries table, which is the first prompt. Titles come from the `title`
 * column, which Antigravity generates, or fall back to a plain label.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';
import {
  asConfigObject,
  readConfigFileSync,
  type ConfigFileRead,
} from '@exawatt/core/server';

/** The oldest version whose launch, resume and hook contract was verified. */
const ANTIGRAVITY_MIN_VERSION = [1, 2, 17] as const;

interface AntigravityVersion {
  version: string;
  compatible: boolean;
}

export function parseAntigravityVersion(
  output: string
): AntigravityVersion | null {
  const match = /\b(\d+)\.(\d+)\.(\d+)\b/.exec(output);
  if (!match) return null;
  const parts = match.slice(1, 4).map(Number);
  let compatible = true;
  for (let index = 0; index < ANTIGRAVITY_MIN_VERSION.length; index += 1) {
    if (parts[index] === ANTIGRAVITY_MIN_VERSION[index]) continue;
    compatible = parts[index] > ANTIGRAVITY_MIN_VERSION[index];
    break;
  }
  return { version: match.slice(1, 4).join('.'), compatible };
}

/** Antigravity CLI's state directory. There is no supported override: the
 *  hidden `--gemini_dir` flag relocates settings and history and is never
 *  passed. */
export function antigravityHome(): string {
  return path.join(os.homedir(), '.gemini', 'antigravity-cli');
}

export type AntigravitySettingsRead = ConfigFileRead<Record<string, unknown>>;

/** Antigravity writes plain JSON; the document must be an object. */
export function readAntigravitySettings(
  home = antigravityHome()
): AntigravitySettingsRead {
  return readConfigFileSync(path.join(home, 'settings.json'), {
    name: 'JSON',
    parse: text => asConfigObject(JSON.parse(text.replace(/^﻿/, ''))),
  });
}

/**
 * The model Antigravity's own picker chose, as its settings record it: a
 * display label (`Gemini 3.5 Flash (Medium)`), not an id. The catalog matches
 * it against the rows `agy models` reports; an unmatched label pins nothing.
 */
export function readAntigravityConfiguredModel(
  settings: Record<string, unknown> | null
): string | null {
  const model = settings?.['model'];
  return typeof model === 'string' && model.trim() ? model.trim() : null;
}

interface AntigravityModelRow {
  id: string;
  label: string;
}

/**
 * `agy models` prints a progress line, then one model per line as
 * `<id><TAB><label>` (1.2.17; `--output-format json` is not accepted there).
 * Read defensively: a line is a row only when it has an id and a label, the
 * id is deduplicated, and nothing else is promoted into the catalog.
 */
export function parseAntigravityModelRows(output: string): AntigravityModelRow[] {
  const rows: AntigravityModelRow[] = [];
  const seen = new Set<string>();
  for (const raw of output.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) continue;
    const match = /^(\S+)(?:\t+|\s{2,})(\S.*)$/.exec(line.trim());
    if (!match) continue;
    const id = match[1];
    const label = match[2].trim();
    if (seen.has(id) || rows.length >= 500) continue;
    seen.add(id);
    rows.push({ id, label });
  }
  return rows;
}

interface AntigravityConversationSummary {
  id: string;
  /** Antigravity's own generated title, or null when it has none yet. */
  title: string | null;
  /** The workspace directories, launch directory included. */
  workspacePaths: string[];
  startedAt: number;
  updatedAt: number;
  steps: number;
}

export function antigravitySummariesFile(home = antigravityHome()): string {
  return path.join(home, 'conversation_summaries.db');
}

/**
 * SQLite stores Antigravity's times as `YYYY-MM-DD HH:MM:SS.ffffff+00:00`.
 * `0001-01-01 00:00:00+00:00` is Go's zero time, which means "never".
 */
export function parseAntigravityTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  if (value.startsWith('0001-01-01')) return null;
  const normalized = value
    .replace(' ', 'T')
    .replace(/(\.\d{3})\d+/, '$1')
    .replace(/\s*\+00:00$/, 'Z');
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** `workspace_uris` is a JSON array of `file://` URIs. Anything else is
 *  skipped rather than guessed at. */
export function parseAntigravityWorkspaceUris(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const paths: string[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'string' || !entry.startsWith('file://')) continue;
    try {
      paths.push(fileURLToPath(entry));
    } catch {
      // Not a path this machine can name.
    }
  }
  return paths;
}

/**
 * The newest top-level conversations Antigravity indexed, read read-only.
 * A missing database is "never ran here" and reads as empty; any other
 * failure throws, because a history that exists and could not be read must
 * never read as an empty one. Children of a delegation (rows with a parent)
 * and conversations with no step yet are left out.
 */
export function readAntigravityConversationSummaries(
  file = antigravitySummariesFile(),
  limit = 200
): AntigravityConversationSummary[] {
  if (!fs.existsSync(file)) return [];
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = database
      .prepare(
        'SELECT conversation_id, title, workspace_uris, step_count, ' +
          'last_modified_time, last_user_input_time ' +
          'FROM conversation_summaries ' +
          "WHERE parent_conversation_id = '' AND step_count > 0 " +
          'ORDER BY last_modified_time DESC LIMIT ?'
      )
      .all(limit) as Array<Record<string, unknown>>;
    const summaries: AntigravityConversationSummary[] = [];
    for (const row of rows) {
      const id = row['conversation_id'];
      if (typeof id !== 'string' || !id) continue;
      const updatedAt = parseAntigravityTimestamp(row['last_modified_time']);
      if (updatedAt === null) continue;
      const startedAt =
        parseAntigravityTimestamp(row['last_user_input_time']) ?? updatedAt;
      const title = row['title'];
      summaries.push({
        id,
        title: typeof title === 'string' && title.trim() ? title.trim() : null,
        workspacePaths: parseAntigravityWorkspaceUris(row['workspace_uris']),
        startedAt: Math.min(startedAt, updatedAt),
        updatedAt,
        steps: typeof row['step_count'] === 'number' ? row['step_count'] : 0,
      });
    }
    return summaries;
  } finally {
    database.close();
  }
}

import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { antigravityModelCatalog } from './agent-models';
import { AntigravityConversationAdapter } from './conversation-catalog';
import {
  parseAntigravityModelRows,
  parseAntigravityTimestamp,
  parseAntigravityVersion,
  parseAntigravityWorkspaceUris,
  readAntigravityConfiguredModel,
  readAntigravityConversationSummaries,
  readAntigravitySettings,
} from './antigravity-source';

/**
 * Antigravity CLI's local records (ENG-003 S5.3). The `agy models` output,
 * settings document and summaries rows are the ones 1.2.17 produced on
 * 2026-10-05, with only paths replaced; none are invented.
 */

const MODELS_OUTPUT = [
  'Fetching available models...',
  'gemini-3.8-flash-high\tGemini 3.8 Flash (High)',
  'gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)',
  'gemini-3.1-pro-low\tGemini 3.1 Pro (Low)',
  'claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)',
  'claude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)',
  'gpt-oss-120b-medium\tGPT-OSS 120B (Medium)',
  '',
].join('\n');

const SUMMARY_COLUMNS = `CREATE TABLE conversation_summaries (
  conversation_id text, title text NOT NULL DEFAULT "", preview text NOT NULL DEFAULT "",
  step_count integer NOT NULL DEFAULT 0, last_modified_time datetime NOT NULL,
  workspace_uris text NOT NULL, status text NOT NULL DEFAULT "", source text NOT NULL DEFAULT "",
  project_id text NOT NULL DEFAULT "", agent_name text NOT NULL DEFAULT "",
  parent_conversation_id text NOT NULL DEFAULT "", nesting_depth integer NOT NULL DEFAULT 0,
  not_fully_idle numeric NOT NULL DEFAULT false, killed numeric NOT NULL DEFAULT false,
  last_user_input_time datetime NOT NULL, last_user_input_step_index integer NOT NULL DEFAULT -1,
  app_data_dir text NOT NULL DEFAULT "", raw_summary blob, group_id text NOT NULL DEFAULT "",
  PRIMARY KEY (conversation_id))`;

const temps: string[] = [];
function tempDir(): string {
  // Real path: the Project scope compares real directories, and macOS aliases
  // /var to /private/var.
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'exawatt-agy-'))
  );
  temps.push(dir);
  return dir;
}

interface SummaryRow {
  id: string;
  title?: string;
  steps?: number;
  modified: string;
  input?: string;
  workspaces: string[];
  parent?: string;
}

function writeSummaries(file: string, rows: SummaryRow[]): void {
  const database = new DatabaseSync(file);
  database.exec(SUMMARY_COLUMNS);
  const insert = database.prepare(
    'INSERT INTO conversation_summaries (conversation_id, title, preview, step_count, last_modified_time, workspace_uris, parent_conversation_id, last_user_input_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  for (const row of rows) {
    insert.run(
      row.id,
      row.title ?? '',
      'the operator prompt, which is never read',
      row.steps ?? 2,
      row.modified,
      JSON.stringify(row.workspaces.map(dir => `file://${dir}`)),
      row.parent ?? '',
      row.input ?? row.modified
    );
  }
  database.close();
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('parseAntigravityVersion', () => {
  it('reads the version and gates on the verified contract', () => {
    expect(parseAntigravityVersion('1.2.17\n')).toEqual({
      version: '1.2.17',
      compatible: true,
    });
    expect(parseAntigravityVersion('1.3.0')?.compatible).toBe(true);
    expect(parseAntigravityVersion('1.2.9')?.compatible).toBe(false);
    // The operator's stale install before step 0 (self-updated to 1.2.17).
    expect(parseAntigravityVersion('1.0.4')?.compatible).toBe(false);
    expect(parseAntigravityVersion('not a version')).toBeNull();
  });
});

describe('parseAntigravityModelRows', () => {
  it('reads id and label from each tab-separated row and skips the progress line', () => {
    const rows = parseAntigravityModelRows(MODELS_OUTPUT);
    expect(rows.map(row => row.id)).toEqual([
      'gemini-3.8-flash-high',
      'gemini-3.8-flash-medium',
      'gemini-3.1-pro-low',
      'claude-sonnet-4-6',
      'claude-opus-4-6-thinking',
      'gpt-oss-120b-medium',
    ]);
    expect(rows[3]).toEqual({
      id: 'claude-sonnet-4-6',
      label: 'Claude Sonnet 4.6 (Thinking)',
    });
  });

  it('promotes nothing without both an id and a label, and deduplicates', () => {
    expect(
      parseAntigravityModelRows(
        [
          'Fetching available models...',
          'Error: not signed in',
          'lonely-id',
          'a-model\tA Model',
          'a-model\tA Model again',
          'b-model   B Model (two spaces)',
        ].join('\n')
      )
    ).toEqual([
      { id: 'a-model', label: 'A Model' },
      { id: 'b-model', label: 'B Model (two spaces)' },
    ]);
    expect(parseAntigravityModelRows('')).toEqual([]);
  });
});

describe('Antigravity settings', () => {
  it('reads the picker’s model label, and none when absent or blank', () => {
    expect(
      readAntigravityConfiguredModel({ model: 'Gemini 3.5 Flash (Medium)' })
    ).toBe('Gemini 3.5 Flash (Medium)');
    expect(readAntigravityConfiguredModel({ model: '  ' })).toBeNull();
    expect(readAntigravityConfiguredModel({})).toBeNull();
    expect(readAntigravityConfiguredModel(null)).toBeNull();
  });

  it('reports a missing file as missing and a broken one as unreadable', () => {
    const home = tempDir();
    expect(readAntigravitySettings(home).status).toBe('missing');
    fs.writeFileSync(path.join(home, 'settings.json'), '{ "model": ');
    expect(readAntigravitySettings(home).status).toBe('unreadable');
    fs.writeFileSync(
      path.join(home, 'settings.json'),
      '{\n  "model": "Gemini 3.5 Flash (Medium)"\n}\n'
    );
    const read = readAntigravitySettings(home);
    expect(read.status).toBe('ok');
    if (read.status === 'ok') {
      expect(read.value).toEqual({ model: 'Gemini 3.5 Flash (Medium)' });
    }
  });
});

describe('antigravityModelCatalog', () => {
  it('offers every reported model and pins the one the settings label names', () => {
    const catalog = antigravityModelCatalog(MODELS_OUTPUT, {
      status: 'ok',
      value: { model: 'Claude Sonnet 4.6 (Thinking)' },
    });
    expect(catalog.harness).toBe('antigravity');
    expect(catalog.models).toHaveLength(6);
    expect(catalog.effectiveModel).toBe('claude-sonnet-4-6');
    expect(catalog.effectiveModelSource).toBe('config');
    expect(catalog.catalogMode).toBe('live-catalog');
    expect(catalog.catalogProvenance).toBe(
      'Installed Antigravity CLI · agy models'
    );
    // No per-model effort set is published to any interface a launch reads.
    for (const model of catalog.models) {
      expect(model.efforts).toEqual([]);
      expect(model.defaultEffort).toBeNull();
    }
    expect(catalog.effectiveEffortSource).toBe('unavailable');
  });

  it('pins nothing when the settings label matches no row, so the account decides', () => {
    // The operator's settings on 2026-10-05 named a model the catalog no
    // longer lists.
    const catalog = antigravityModelCatalog(MODELS_OUTPUT, {
      status: 'ok',
      value: { model: 'Gemini 3.5 Flash (Medium)' },
    });
    expect(catalog.effectiveModel).toBeNull();
    expect(catalog.effectiveModelSource).toBe('account-default');
    expect(catalog.effectiveModelLabel).toBe('Account default');
    expect(catalog.models).toHaveLength(6);
  });

  it('leaves the choice to the source when agy listed nothing, without inventing a row', () => {
    const catalog = antigravityModelCatalog('', { status: 'missing' });
    expect(catalog.models).toEqual([]);
    expect(catalog.catalogMode).toBe('source-owned');
    expect(catalog.effectiveModelSource).toBe('account-default');
    expect(catalog.configurationUnreadable).toBeUndefined();
  });

  it('marks an unreadable settings file instead of reading it as the default', () => {
    const catalog = antigravityModelCatalog(MODELS_OUTPUT, {
      status: 'unreadable',
      cause: { kind: 'invalid', detail: 'Unexpected end of JSON input' },
    } as never);
    expect(catalog.configurationUnreadable).toBe(true);
    expect(catalog.effectiveModelSource).toBe('unavailable');
    expect(catalog.models).toHaveLength(6);
  });
});

describe('Antigravity timestamps and workspaces', () => {
  it('reads SQLite’s microsecond UTC stamps and treats Go’s zero time as never', () => {
    expect(parseAntigravityTimestamp('2026-10-05 19:16:40.22836+00:00')).toBe(
      Date.parse('2026-10-05T19:16:40.228Z')
    );
    expect(parseAntigravityTimestamp('2026-06-03 07:53:48+00:00')).toBe(
      Date.parse('2026-06-03T07:53:48Z')
    );
    expect(parseAntigravityTimestamp('0001-01-01 00:00:00+00:00')).toBeNull();
    expect(parseAntigravityTimestamp('')).toBeNull();
    expect(parseAntigravityTimestamp(42)).toBeNull();
  });

  it('decodes file URIs and skips anything else', () => {
    expect(
      parseAntigravityWorkspaceUris(
        '["file:///Users/op/Code/app","https://example.invalid","file:///tmp/with%20space"]'
      )
    ).toEqual(['/Users/op/Code/app', '/tmp/with space']);
    expect(parseAntigravityWorkspaceUris('not json')).toEqual([]);
    expect(parseAntigravityWorkspaceUris(null)).toEqual([]);
  });
});

describe('readAntigravityConversationSummaries', () => {
  it('is empty when Antigravity never ran here', () => {
    expect(
      readAntigravityConversationSummaries(
        path.join(tempDir(), 'conversation_summaries.db')
      )
    ).toEqual([]);
  });

  it('throws on a database that exists and cannot be read', () => {
    const file = path.join(tempDir(), 'conversation_summaries.db');
    fs.writeFileSync(file, 'this is not sqlite');
    expect(() => readAntigravityConversationSummaries(file)).toThrow();
  });

  it('lists top-level conversations with steps, newest first, never the preview', () => {
    const file = path.join(tempDir(), 'conversation_summaries.db');
    writeSummaries(file, [
      {
        id: 'older',
        title: 'Fix the build',
        modified: '2026-06-03 07:53:48.783241+00:00',
        input: '2026-06-03 07:53:36.62603+00:00',
        workspaces: ['/Users/op/Desktop/CalendarMCP'],
      },
      {
        id: 'newest',
        modified: '2026-10-05 19:16:40.22836+00:00',
        input: '2026-10-05 19:16:39.06073+00:00',
        workspaces: ['/tmp/exawatt/hooks/pty-1', '/work/app'],
      },
      {
        id: 'child',
        modified: '2026-10-05 19:16:40.22836+00:00',
        workspaces: ['/work/app'],
        parent: 'newest',
      },
      {
        id: 'empty',
        steps: 0,
        modified: '0001-01-01 00:00:00+00:00',
        input: '0001-01-01 00:00:00+00:00',
        workspaces: ['/work/app'],
      },
    ]);
    const summaries = readAntigravityConversationSummaries(file);
    expect(summaries.map(summary => summary.id)).toEqual(['newest', 'older']);
    expect(summaries[0]).toEqual({
      id: 'newest',
      title: null,
      workspacePaths: ['/tmp/exawatt/hooks/pty-1', '/work/app'],
      startedAt: Date.parse('2026-10-05T19:16:39.060Z'),
      updatedAt: Date.parse('2026-10-05T19:16:40.228Z'),
      steps: 2,
    });
    expect(summaries[1].title).toBe('Fix the build');
    expect(JSON.stringify(summaries)).not.toContain('operator prompt');
  });
});

describe('AntigravityConversationAdapter', () => {
  it('lists the conversations whose workspace is inside the Project, under the launch directory', async () => {
    const root = tempDir();
    const project = path.join(root, 'app');
    const elsewhere = path.join(root, 'other');
    fs.mkdirSync(project);
    fs.mkdirSync(elsewhere);
    const file = path.join(root, 'conversation_summaries.db');
    writeSummaries(file, [
      {
        id: 'in-project',
        title: 'Wire the adapter',
        modified: '2026-10-05 19:16:40.22836+00:00',
        workspaces: [path.join(root, 'hooks', 'pty-1'), project],
      },
      {
        id: 'elsewhere',
        modified: '2026-10-05 19:17:40+00:00',
        workspaces: [elsewhere],
      },
    ]);
    const rows = await new AntigravityConversationAdapter(file).list(project);
    expect(rows.map(row => row.id)).toEqual(['in-project']);
    expect(rows[0]).toMatchObject({
      harness: 'antigravity',
      cwd: project,
      title: 'Wire the adapter',
      titleSource: 'native',
      providerSessionId: 'in-project',
      continuation: { kind: 'provider' },
    });
  });

  it('is empty, not broken, when Antigravity never ran here', async () => {
    const root = tempDir();
    const project = path.join(root, 'app');
    fs.mkdirSync(project);
    expect(
      await new AntigravityConversationAdapter(
        path.join(root, 'conversation_summaries.db')
      ).list(project)
    ).toEqual([]);
  });
});

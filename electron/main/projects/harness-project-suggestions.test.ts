import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { DatabaseSync } from 'node:sqlite';
import { git } from '../../../scripts/lib/hermetic-git.mjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RECENT_WINDOW_MS,
  createSuggestionsSource,
  readHarnessProjectSuggestions,
  type HarnessProjectSuggestions,
} from './harness-project-suggestions';
import { harnessEnvironment } from '../pty/harness-homes';

// The login shell's environment is the default; a fixture never spawns one.
vi.mock('../pty/harness-homes', async importOriginal => ({
  ...(await importOriginal<typeof import('../pty/harness-homes')>()),
  harnessEnvironment: vi.fn(async () => ({})),
}));

/*
 * Fixtures are each store's real shape (docs/research/market/
 * 2026-10-15-harness-project-stores-and-exawatt-bindings.md), written into a
 * private HOME with real git repositories, so the join rule under test is
 * the product's own.
 */

const NOW = Date.UTC(2026, 9, 15, 12);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

function makeRepository(directory: string): void {
  fs.mkdirSync(directory, { recursive: true });
  git(directory, ['init', '-q']);
  git(directory, ['commit', '-q', '--allow-empty', '-m', 'init']);
}

function write(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function antigravityTime(at: number): string {
  return `${new Date(at).toISOString().replace('T', ' ').replace('Z', '')}000+00:00`;
}

interface Fixture {
  home: string;
  alpha: string;
  worktree: string;
  beta: string;
  scripts: string;
  /** Where Claude Code and Codex keep their state for this fixture. */
  claudeDir: string;
  claudeJson: string;
  codexDir: string;
  env: NodeJS.ProcessEnv;
}

/**
 * One machine:
 * - `code/alpha`: a repository Claude Code and Codex both know; Claude's
 *   transcript ran in a subdirectory, Codex's newest thread in a worktree.
 * - `code/beta`: a repository only Antigravity knows, active 40 days ago.
 * - `code/scripts`: no git, a `package.json`, known to Codex's trust table.
 * - `code` itself: a non-git parent with a marker, known to Claude Code.
 * - noise the filter drops: home, Downloads, Library, a scratch root, a
 *   missing directory, a folder with no marker.
 */
function buildFixture({
  viaEnvironment = false,
}: { viaEnvironment?: boolean } = {}): Fixture {
  const home = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'exawatt-suggest-'))
  );
  homes.push(home);
  const code = path.join(home, 'code');
  const alpha = path.join(code, 'alpha');
  const beta = path.join(code, 'beta');
  const scripts = path.join(code, 'scripts');
  makeRepository(alpha);
  fs.mkdirSync(path.join(alpha, 'packages', 'web'), { recursive: true });
  const worktree = path.join(code, 'alpha-wt', 'feature');
  git(alpha, ['worktree', 'add', '-q', worktree, '-b', 'feature']);
  makeRepository(beta);
  write(path.join(scripts, 'package.json'), '{}');
  write(path.join(code, 'package.json'), '{}');
  write(path.join(home, 'Downloads', 'package.json'), '{}');
  write(path.join(home, 'Library', 'Tools', 'thing', 'package.json'), '{}');
  makeRepository(path.join(home, 'scratch', 'eval-1'));
  fs.mkdirSync(path.join(home, 'notes', 'plain'), { recursive: true });

  const claudeDir = viaEnvironment
    ? path.join(home, 'custom-claude')
    : path.join(home, '.claude');
  const claudeJson = viaEnvironment
    ? path.join(claudeDir, '.claude.json')
    : path.join(home, '.claude.json');
  const codexDir = viaEnvironment
    ? path.join(home, 'custom-codex')
    : path.join(home, '.codex');

  // Claude Code: the per-directory entries; `lastStartTime` only sometimes.
  write(
    claudeJson,
    JSON.stringify({
      numStartups: 3,
      projects: {
        [home]: { allowedTools: [], lastStartTime: NOW - 5 * HOUR },
        [alpha]: {
          allowedTools: [],
          hasTrustDialogAccepted: true,
          lastStartTime: NOW - 3 * HOUR,
        },
        [code]: { allowedTools: [], lastStartTime: NOW - 2 * HOUR },
        [path.join(home, 'Downloads')]: { allowedTools: [] },
        [path.join(home, 'Library', 'Tools', 'thing')]: { allowedTools: [] },
        [path.join(home, 'scratch', 'eval-1')]: { allowedTools: [] },
        [path.join(home, 'gone', 'deleted')]: { allowedTools: [] },
        [path.join(home, 'notes', 'plain')]: { allowedTools: [] },
      },
    })
  );
  // A transcript whose first records carry no `cwd`, then one that does.
  const transcript = path.join(
    claudeDir,
    'projects',
    alpha.replace(/[^a-zA-Z0-9_-]/g, '-') + '-packages-web',
    'a1b2.jsonl'
  );
  write(
    transcript,
    [
      JSON.stringify({ type: 'queue-operation', operation: 'enqueue' }),
      JSON.stringify({
        type: 'user',
        cwd: path.join(alpha, 'packages', 'web'),
        message: { content: 'a "cwd":"/nowhere" inside text' },
      }),
      '',
    ].join('\n')
  );
  fs.utimesSync(transcript, (NOW - HOUR) / 1000, (NOW - HOUR) / 1000);
  // A memory-only directory: nothing to read, nothing suggested.
  write(
    path.join(claudeDir, 'projects', '-memory-only', 'memory', 'MEMORY.md'),
    ''
  );

  // Codex: the trust table and a WAL-mode state database.
  write(
    path.join(codexDir, 'config.toml'),
    [
      'model = "gpt-5"',
      `[projects."${alpha}"]`,
      'trust_level = "trusted"',
      `[projects."${scripts}"]`,
      'trust_level = "trusted"',
      `[projects."${home}"]`,
      'trust_level = "trusted"',
      '',
    ].join('\n')
  );
  const codexDatabase = new DatabaseSync(path.join(codexDir, 'state_5.sqlite'));
  codexDatabase.exec(
    'PRAGMA journal_mode=WAL; CREATE TABLE threads (id TEXT, cwd TEXT, updated_at_ms INTEGER, archived INTEGER)'
  );
  const insert = codexDatabase.prepare(
    'INSERT INTO threads VALUES (?, ?, ?, 0)'
  );
  insert.run('t1', worktree, NOW - 10 * 60 * 1000);
  insert.run('t2', alpha, NOW - 2 * DAY);
  insert.run('t3', path.join(home, 'scratch', 'eval-1'), NOW);
  codexDatabase.close();

  // Antigravity: a project file and the conversation index.
  write(
    path.join(home, '.gemini', 'config', 'projects', 'p1.json'),
    JSON.stringify({
      id: 'p1',
      name: beta,
      projectResources: {
        resources: [{ folderUri: pathToFileURL(beta).href }],
      },
    })
  );
  write(
    path.join(
      home,
      '.gemini',
      'config',
      'projects',
      'default-cli-project.json'
    ),
    JSON.stringify({
      id: 'default-cli-project',
      name: 'CLI Project',
      projectResources: {},
    })
  );
  // Gemini CLI's files sit beside Antigravity's and must not be read.
  write(
    path.join(home, '.gemini', 'projects.json'),
    JSON.stringify({ projects: { [path.join(home, 'notes')]: 'notes' } })
  );
  fs.mkdirSync(path.join(home, '.gemini', 'antigravity-cli'), {
    recursive: true,
  });
  const antigravityDatabase = new DatabaseSync(
    path.join(home, '.gemini', 'antigravity-cli', 'conversation_summaries.db')
  );
  antigravityDatabase.exec(
    `PRAGMA journal_mode=WAL;
     CREATE TABLE conversation_summaries (
       conversation_id TEXT, title TEXT, preview TEXT, step_count INTEGER,
       last_modified_time TEXT, workspace_uris TEXT, project_id TEXT,
       parent_conversation_id TEXT, last_user_input_time TEXT)`
  );
  antigravityDatabase
    .prepare(
      'INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      'c1',
      'Beta work',
      'secret prompt',
      4,
      antigravityTime(NOW - 40 * DAY),
      JSON.stringify([pathToFileURL(beta).href]),
      'p1',
      '',
      antigravityTime(NOW - 40 * DAY)
    );
  antigravityDatabase.close();

  return {
    home,
    alpha,
    worktree,
    beta,
    scripts,
    claudeDir,
    claudeJson,
    codexDir,
    env: viaEnvironment
      ? { CLAUDE_CONFIG_DIR: claudeDir, CODEX_HOME: codexDir }
      : {},
  };
}

function read(
  fixture: Fixture,
  options: { foldWorktrees?: boolean } = {}
): Promise<HarnessProjectSuggestions> {
  return readHarnessProjectSuggestions({
    env: fixture.env,
    home: fixture.home,
    now: NOW,
    // The fixture lives under the system temporary directory; its own
    // `scratch` folder plays the temporary root.
    temporaryRoots: [path.join(fixture.home, 'scratch')],
    ...options,
  });
}

function storeStatus(result: HarnessProjectSuggestions) {
  return Object.fromEntries(
    result.stores.map(store => [store.store, store.status])
  );
}

describe('harness project suggestions', () => {
  it('lists real projects once each, folded, ranked and split by recency', async () => {
    const fixture = buildFixture();
    const result = await read(fixture);

    expect(result.suggestions.map(row => row.path)).toEqual([
      fixture.alpha,
      fixture.beta,
      fixture.scripts,
    ]);
    const [alpha, beta, scripts] = result.suggestions;
    // One row, a badge per harness, the newest harness first: Codex's
    // worktree thread is newer than Claude Code's transcript.
    expect(alpha.harnesses).toEqual(['codex', 'claude']);
    expect(alpha.lastActivityAt).toBe(NOW - 10 * 60 * 1000);
    expect(alpha.recent).toBe(true);
    expect(alpha.commonDir).toBe(path.join(fixture.alpha, '.git'));
    expect(new Set(alpha.evidence.map(item => item.store))).toEqual(
      new Set([
        'claude-code-config',
        'claude-code-transcripts',
        'codex-config',
        'codex-sessions',
      ])
    );
    expect(beta.harnesses).toEqual(['antigravity']);
    expect(beta.recent).toBe(false);
    expect(beta.lastActivityAt).toBe(NOW - 40 * DAY);
    // A store's own name is evidence, never the row's name.
    expect(beta.name).toBe('beta');
    expect(beta.evidence.some(item => item.label === fixture.beta)).toBe(true);
    // A marker folder outside git is a project; a folder with no time is
    // older and ranks last.
    expect(scripts.commonDir).toBeNull();
    expect(scripts.lastActivityAt).toBeNull();
    expect(scripts.recent).toBe(false);
    expect(storeStatus(result)).toEqual({
      'claude-code-config': 'read',
      'claude-code-transcripts': 'read',
      'codex-config': 'read',
      'codex-sessions': 'read',
      'antigravity-projects': 'read',
      'antigravity-conversations': 'read',
    });
  });

  it('drops home, Downloads, Library, temporary, missing, unmarked and parent-only folders', async () => {
    const fixture = buildFixture();
    const paths = (await read(fixture)).suggestions.map(row => row.path);
    for (const dropped of [
      fixture.home,
      path.join(fixture.home, 'Downloads'),
      path.join(fixture.home, 'Library', 'Tools', 'thing'),
      path.join(fixture.home, 'scratch', 'eval-1'),
      path.join(fixture.home, 'gone', 'deleted'),
      path.join(fixture.home, 'notes', 'plain'),
      // A non-git folder with a marker that only contains other rows.
      path.join(fixture.home, 'code'),
      // Gemini CLI's project list is not Antigravity's.
      path.join(fixture.home, 'notes'),
    ]) {
      expect(paths).not.toContain(dropped);
    }
  });

  it('keeps a worktree as its own row when folding is off, sharing the repository', async () => {
    const fixture = buildFixture();
    const result = await read(fixture, { foldWorktrees: false });
    const worktree = result.suggestions.find(
      row => row.path === fixture.worktree
    );
    const alpha = result.suggestions.find(row => row.path === fixture.alpha);
    expect(worktree?.harnesses).toEqual(['codex']);
    expect(worktree?.commonDir).toBe(alpha?.commonDir);
    expect(alpha?.harnesses).toEqual(['claude', 'codex']);
  });

  it('reads Claude Code and Codex from CLAUDE_CONFIG_DIR and CODEX_HOME', async () => {
    const fixture = buildFixture({ viaEnvironment: true });
    const result = await read(fixture);
    expect(result.suggestions[0]?.path).toBe(fixture.alpha);
    expect(result.suggestions[0]?.harnesses).toEqual(['codex', 'claude']);
    // Nothing at the default locations, and it was not read there.
    expect(fs.existsSync(path.join(fixture.home, '.claude.json'))).toBe(false);
  });

  it('names an unreadable store and still lists the others', async () => {
    const fixture = buildFixture();
    fs.writeFileSync(fixture.claudeJson, '{"projects": {');
    const result = await read(fixture);
    const config = result.stores.find(
      store => store.store === 'claude-code-config'
    );
    expect(config).toMatchObject({ status: 'unreadable', entries: 0 });
    expect(config?.reason).toBeTruthy();
    expect(config?.reason).not.toContain('projects');
    expect(result.suggestions.map(row => row.path)).toContain(fixture.alpha);

    fs.rmSync(fixture.claudeJson);
    fs.mkdirSync(fixture.claudeJson);
    const directory = (await read(fixture)).stores.find(
      store => store.store === 'claude-code-config'
    );
    expect(directory?.status).toBe('unreadable');
  });

  it('resolves CLAUDE_CONFIG_DIR and CODEX_HOME through the login shell by default', async () => {
    // A Finder-launched app has no shell rc variables in process.env.
    const fixture = buildFixture({ viaEnvironment: true });
    vi.mocked(harnessEnvironment).mockResolvedValueOnce(fixture.env);
    const result = await readHarnessProjectSuggestions({
      home: fixture.home,
      now: NOW,
      temporaryRoots: [path.join(fixture.home, 'scratch')],
    });
    expect(harnessEnvironment).toHaveBeenCalled();
    expect(result.suggestions[0]?.path).toBe(fixture.alpha);
    expect(result.suggestions[0]?.harnesses).toEqual(['codex', 'claude']);
  });

  it('names an unreadable Codex thread database, never reporting it missing', async () => {
    const fixture = buildFixture();
    // The database exists and is not a database; Codex wrote no rollouts.
    fs.writeFileSync(
      path.join(fixture.codexDir, 'state_5.sqlite'),
      'x'.repeat(8192)
    );
    fs.rmSync(path.join(fixture.codexDir, 'state_5.sqlite-wal'), {
      force: true,
    });
    const result = await read(fixture);
    const sessions = result.stores.find(
      store => store.store === 'codex-sessions'
    );
    expect(sessions).toMatchObject({ status: 'unreadable', entries: 0 });
    expect(sessions?.reason).toMatch(/thread database/);
  });

  it('keeps Codex rollouts beside an unreadable thread database', async () => {
    const fixture = buildFixture();
    fs.writeFileSync(
      path.join(fixture.codexDir, 'state_5.sqlite'),
      'x'.repeat(8192)
    );
    const rollout = path.join(
      fixture.codexDir,
      'sessions',
      '2026',
      '10',
      '15',
      'rollout-2026-10-15T10-00-00-abc.jsonl'
    );
    write(
      rollout,
      JSON.stringify({
        type: 'session_meta',
        payload: { id: 'abc', cwd: fixture.beta },
      }) + '\n'
    );
    fs.utimesSync(rollout, (NOW - HOUR) / 1000, (NOW - HOUR) / 1000);
    const result = await read(fixture);
    const sessions = result.stores.find(
      store => store.store === 'codex-sessions'
    );
    expect(sessions).toMatchObject({ status: 'unreadable', entries: 1 });
    expect(sessions?.reason).toMatch(/thread database/);
    const beta = result.suggestions.find(row => row.path === fixture.beta);
    expect(beta?.harnesses).toEqual(['codex', 'antigravity']);
  });

  it('reports a machine with no harness as missing stores, not unreadable ones', async () => {
    const home = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'exawatt-suggest-empty-'))
    );
    homes.push(home);
    const result = await readHarnessProjectSuggestions({
      env: {},
      home,
      now: NOW,
      temporaryRoots: [],
    });
    expect(result.suggestions).toEqual([]);
    expect(new Set(result.stores.map(store => store.status))).toEqual(
      new Set(['missing'])
    );
  });

  it('falls back to Codex rollouts, reading cwd from a first line longer than the head', async () => {
    const fixture = buildFixture();
    fs.rmSync(path.join(fixture.codexDir, 'state_5.sqlite'));
    const rollout = path.join(
      fixture.codexDir,
      'sessions',
      '2026',
      '10',
      '15',
      'rollout-2026-10-15T10-00-00-abc.jsonl'
    );
    write(
      rollout,
      JSON.stringify({
        timestamp: '2026-10-15T10:00:00Z',
        type: 'session_meta',
        payload: {
          id: 'abc',
          cwd: fixture.beta,
          base_instructions: 'x'.repeat(200 * 1024),
        },
      }) + '\n'
    );
    fs.utimesSync(rollout, (NOW - HOUR) / 1000, (NOW - HOUR) / 1000);
    const result = await read(fixture);
    const beta = result.suggestions.find(row => row.path === fixture.beta);
    expect(beta?.harnesses).toEqual(['codex', 'antigravity']);
    expect(beta?.recent).toBe(true);
  });

  it('writes nothing to any harness store', async () => {
    const fixture = buildFixture();
    // Codex is running: its database is held open with a live log.
    const live = new DatabaseSync(
      path.join(fixture.codexDir, 'state_5.sqlite')
    );
    live.exec("INSERT INTO threads VALUES ('t4', 'x', 1, 0)");
    try {
      const roots = [
        fixture.claudeJson,
        fixture.claudeDir,
        fixture.codexDir,
        path.join(fixture.home, '.gemini'),
      ];
      const before = manifest(roots);
      expect(before).toContain('state_5.sqlite-wal');
      expect(before).not.toContain('conversation_summaries.db-wal');
      const source = createSuggestionsSource(() => read(fixture));
      expect((await source()).ok).toBe(true);
      expect((await source({ refresh: true })).ok).toBe(true);
      expect(manifest(roots)).toBe(before);
    } finally {
      live.close();
    }
  });
});

/** Every file under the roots: path, size and content hash. */
function manifest(roots: readonly string[]): string {
  const lines: string[] = [];
  const visit = (entry: string) => {
    const stat = fs.statSync(entry);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(entry).sort()) {
        visit(path.join(entry, name));
      }
      return;
    }
    const digest = createHash('sha256')
      .update(fs.readFileSync(entry))
      .digest('hex');
    lines.push(`${entry} ${stat.size} ${digest}`);
  };
  for (const root of roots) visit(root);
  return lines.join('\n');
}

describe('the suggestions source', () => {
  function deferred() {
    let resolve!: (value: HarnessProjectSuggestions) => void;
    const promise = new Promise<HarnessProjectSuggestions>(done => {
      resolve = done;
    });
    return { promise, resolve };
  }
  const empty: HarnessProjectSuggestions = {
    suggestions: [],
    stores: [],
    readAt: 0,
  };

  it('shares a read in flight, answers repeats from it, and re-reads on refresh', async () => {
    let now = 0;
    const reads: Array<ReturnType<typeof deferred>> = [];
    const source = createSuggestionsSource(
      () => {
        const next = deferred();
        reads.push(next);
        return next.promise;
      },
      () => now
    );
    const first = source();
    const refreshWhileReading = source({ refresh: true });
    expect(reads).toHaveLength(1);
    reads[0].resolve(empty);
    expect(await first).toEqual({ ok: true, ...empty });
    expect(await refreshWhileReading).toEqual({ ok: true, ...empty });

    now = 1_000;
    await source();
    expect(reads).toHaveLength(1);

    const refreshed = source({ refresh: true });
    expect(reads).toHaveLength(2);
    reads[1].resolve(empty);
    await refreshed;

    now += RECENT_WINDOW_MS;
    void source();
    expect(reads).toHaveLength(3);
  });

  it('answers a failed read as a failure, never as an empty list', async () => {
    const source = createSuggestionsSource(() =>
      Promise.reject(new Error('boom'))
    );
    expect(await source()).toEqual({ ok: false, error: 'boom' });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  ClaudeConversationAdapter,
  CodexConversationAdapter,
  OpenCodeConversationAdapter,
  ProjectSessionConversationAdapter,
  RecentConversationCatalog,
  redactHostedSummaryText,
  type ConversationCatalogAdapter,
  type ConversationDraft,
} from './conversation-catalog';

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots
      .splice(0)
      .map(root => fs.promises.rm(root, { recursive: true, force: true }))
  );
});

async function temporaryRoot(name: string) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), name));
  roots.push(root);
  return root;
}

describe('RecentConversationCatalog', () => {
  it('filters Codex envelopes and keeps exact IDs with useful short text', async () => {
    const root = await temporaryRoot('exawatt-conversation-codex-');
    const cwd = await temporaryRoot('exawatt-cortex-ehr-');
    await fs.promises.writeFile(
      path.join(root, 'rollout.jsonl'),
      [
        JSON.stringify({
          type: 'session_meta',
          payload: {
            session_id: '11111111-1111-4111-8111-111111111111',
            cwd,
          },
        }),
        JSON.stringify({
          type: 'response_item',
          payload: {
            role: 'user',
            content: [{ text: '# AGENTS.md instructions for /projects' }],
          },
        }),
        JSON.stringify({
          type: 'response_item',
          payload: {
            role: 'user',
            content: [{ text: 'Build client-side de-identification' }],
          },
        }),
      ].join('\n')
    );

    const rows = await new RecentConversationCatalog({
      adapters: [new CodexConversationAdapter(root)],
    }).list(cwd);

    expect(rows).toMatchObject([
      {
        id: '11111111-1111-4111-8111-111111111111',
        harness: 'codex',
        title: 'Build client-side de-identification',
        titleSource: 'fallback',
        needsSummary: true,
      },
    ]);
  });

  it('includes nested Project work and excludes a neighboring directory', async () => {
    const sessionsRoot = await temporaryRoot(
      'exawatt-conversation-project-scope-'
    );
    const projectRoot = await temporaryRoot('exawatt-project-root-');
    const nested = path.join(projectRoot, 'packages', 'app');
    const neighbor = `${projectRoot}-other`;
    await fs.promises.mkdir(nested, { recursive: true });
    await fs.promises.mkdir(neighbor, { recursive: true });
    const writeRollout = async (name: string, cwd: string) =>
      fs.promises.writeFile(
        path.join(sessionsRoot, name),
        [
          JSON.stringify({
            type: 'session_meta',
            payload: { session_id: name, cwd },
          }),
          JSON.stringify({
            type: 'response_item',
            payload: { role: 'user', content: 'Scoped task' },
          }),
        ].join('\n')
      );
    await writeRollout('nested.jsonl', nested);
    await writeRollout('neighbor.jsonl', neighbor);

    const rows = await new CodexConversationAdapter(sessionsRoot).list(
      projectRoot
    );

    expect(rows.map(row => row.id)).toEqual(['nested.jsonl']);
    expect(rows[0].cwd).toBe(await fs.promises.realpath(nested));
  });

  it('uses Claude native titles and preserves the full provider ID', async () => {
    const root = await temporaryRoot('exawatt-conversation-claude-');
    const cwd = await temporaryRoot('exawatt-claude-project-');
    const worktree = path.join(cwd, '.worktrees', 'privacy-pass');
    await fs.promises.mkdir(worktree, { recursive: true });
    const project = path.join(root, cwd.replace(/[^a-zA-Z0-9_-]/g, '-'));
    const worktreeProject = path.join(
      root,
      worktree.replace(/[^a-zA-Z0-9_-]/g, '-')
    );
    await fs.promises.mkdir(project);
    await fs.promises.mkdir(worktreeProject);
    await fs.promises.writeFile(
      path.join(project, 'sessions-index.json'),
      JSON.stringify({
        entries: [
          {
            sessionId: '6e3a2161-9d9c-445e-85a4-cca87896b071',
            projectPath: cwd,
            summary: 'client-side-deidentification-mmhc',
            firstPrompt: 'Move protected health information out of the client',
            created: '2026-07-20T10:00:00Z',
            modified: '2026-07-21T10:00:00Z',
          },
        ],
      })
    );
    await fs.promises.writeFile(
      path.join(worktreeProject, 'sessions-index.json'),
      JSON.stringify({
        entries: [
          {
            sessionId: 'worktree-session-id',
            projectPath: worktree,
            summary: 'privacy-worktree-follow-up',
            firstPrompt: 'Continue the privacy worktree pass',
            created: '2026-07-21T11:00:00Z',
            modified: '2026-07-21T12:00:00Z',
          },
        ],
      })
    );

    const rows = await new ClaudeConversationAdapter(root, async () => [
      cwd,
      worktree,
    ]).list(cwd);
    expect(rows.find(row => row.id.startsWith('6e3a'))).toMatchObject({
      id: '6e3a2161-9d9c-445e-85a4-cca87896b071',
      title: 'client-side-deidentification-mmhc',
      titleSource: 'native',
      needsSummary: false,
    });
    expect(rows.find(row => row.id === 'worktree-session-id')).toMatchObject({
      id: 'worktree-session-id',
      title: 'privacy-worktree-follow-up',
    });
  });

  it('caches generated labels by harness identity and file fingerprint', async () => {
    const cacheRoot = await temporaryRoot('exawatt-conversation-cache-');
    const cacheFile = path.join(cacheRoot, 'summaries.json');
    const draft: ConversationDraft = {
      id: 'provider-id',
      harness: 'codex',
      cwd: '/project',
      startedAt: 1,
      updatedAt: 2,
      title: 'Long raw operator prompt',
      description: 'Long raw operator prompt',
      titleSource: 'fallback',
      needsSummary: true,
      providerSessionId: 'provider-id',
      continuation: { kind: 'provider' },
      fingerprint: '2:100',
      summaryInput: ['Long raw operator prompt'],
      providerIdentity: 'provider-id',
      correlationKey: 'codex:long raw operator prompt',
    };
    const adapter: ConversationCatalogAdapter = {
      harnesses: ['codex'],
      list: vi.fn(async () => [draft]),
    };
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            conversations: [
              {
                key: 'codex:provider-id',
                title: 'Cortex Intake Refactor',
                summary:
                  'Refactor the patient intake flow and verify consent boundaries.',
              },
            ],
          })
        )
    );
    const catalog = new RecentConversationCatalog({
      adapters: [adapter],
      cacheFile,
      fetch: fetchMock as typeof fetch,
      summaryEndpoint: 'https://example.test/summarize',
    });

    const rows = await catalog.enrich('/project', 'signed-in-token');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/summarize',
      expect.objectContaining({ method: 'POST' })
    );
    expect(rows[0]).toMatchObject({
      title: 'Cortex Intake Refactor',
      titleSource: 'generated',
      needsSummary: false,
    });
    expect((await fs.promises.stat(cacheFile)).mode & 0o777).toBe(0o600);
    await expect(catalog.list('/project')).resolves.toMatchObject([
      { title: 'Cortex Intake Refactor' },
    ]);
  });

  // ENG-030 OS1.5 / decision `0031`: the Settings switch must PREVENT the
  // hosted call, and must do so on the next call, not the next launch.
  it('never reaches the summary endpoint once the operator switches summaries off', async () => {
    const cacheRoot = await temporaryRoot('exawatt-conversation-off-');
    const draft: ConversationDraft = {
      id: 'provider-id',
      harness: 'codex',
      cwd: '/project',
      startedAt: 1,
      updatedAt: 2,
      title: 'Long raw operator prompt',
      description: 'Long raw operator prompt',
      titleSource: 'fallback',
      needsSummary: true,
      providerSessionId: 'provider-id',
      continuation: { kind: 'provider' },
      fingerprint: '2:100',
      summaryInput: ['Long raw operator prompt'],
      providerIdentity: 'provider-id',
      correlationKey: 'codex:long raw operator prompt',
    };
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            conversations: [
              {
                key: 'codex:provider-id',
                title: 'Cortex Intake Refactor',
                summary:
                  'Refactor the patient intake flow and verify consent boundaries.',
              },
            ],
          })
        )
    );
    let hosted = true;
    const catalog = new RecentConversationCatalog({
      adapters: [{ harnesses: ['codex'], list: vi.fn(async () => [draft]) }],
      cacheFile: path.join(cacheRoot, 'summaries.json'),
      fetch: fetchMock as typeof fetch,
      summaryEndpoint: 'https://example.test/summarize',
      hostedSummariesEnabled: () => hosted,
    });

    await expect(
      catalog.enrich('/project', 'signed-in-token')
    ).resolves.toMatchObject([{ title: 'Cortex Intake Refactor' }]);
    expect(fetchMock).toHaveBeenCalledOnce();

    hosted = false;
    catalog.invalidate();
    await expect(
      catalog.enrich('/project', 'signed-in-token')
    ).rejects.toThrow(/disabled in Settings/);
    expect(fetchMock).toHaveBeenCalledOnce();

    // The private cache written while it was on survives, and the local list
    // stays useful with the feature off.
    await expect(catalog.list('/project')).resolves.toMatchObject([
      { title: 'Cortex Intake Refactor', needsSummary: false },
    ]);
  });

  it('refuses generated narration and overlong cached labels at the desktop boundary', async () => {
    const cacheRoot = await temporaryRoot('exawatt-conversation-cache-');
    const cacheFile = path.join(cacheRoot, 'summaries.json');
    const draft: ConversationDraft = {
      id: 'provider-id',
      harness: 'codex',
      cwd: '/project',
      startedAt: 1,
      updatedAt: 2,
      title: "I'm going to give you a call transcript…",
      description: 'Verify E&M codes use AMA guidelines',
      titleSource: 'fallback',
      needsSummary: true,
      continuation: { kind: 'provider' },
      fingerprint: '2:100',
      summaryInput: ['Call transcript', 'Verify the E&M guidance'],
      providerIdentity: 'provider-id',
      correlationKey: 'codex:call transcript',
    };
    const catalog = new RecentConversationCatalog({
      adapters: [{ list: vi.fn(async () => [draft]) }],
      cacheFile,
      fetch: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              conversations: [
                {
                  key: 'codex:provider-id',
                  title: 'Verify E&M billing guidance',
                  summary: "Based on my exploration, here's what I found",
                },
              ],
            })
          )
      ) as typeof fetch,
      summaryEndpoint: 'https://example.test/summarize',
    });

    await expect(
      catalog.enrich('/project', 'signed-in-token')
    ).resolves.toEqual([
      expect.objectContaining({
        title: 'Verify E&M codes use AMA guidelines',
        description: 'Verify E&M codes use AMA guidelines',
        titleSource: 'fallback',
        needsSummary: true,
      }),
    ]);
    await expect(fs.promises.readFile(cacheFile, 'utf8')).resolves.toBe('{}');

    await fs.promises.writeFile(
      cacheFile,
      JSON.stringify({
        'codex:provider-id': {
          fingerprint: draft.fingerprint,
          title: 'Verify all E&M codes against the AMA guidelines',
          description: 'Verify E&M codes use AMA guidelines',
        },
      })
    );
    await expect(catalog.list('/project')).resolves.toEqual([
      expect.objectContaining({
        title: 'Verify E&M codes use AMA guidelines',
        description: 'Verify E&M codes use AMA guidelines',
        titleSource: 'fallback',
        needsSummary: true,
      }),
    ]);
  });

  it('replaces provider narration previews with the durable operator goal', async () => {
    const draft: ConversationDraft = {
      id: 'provider-id',
      harness: 'codex',
      cwd: '/project',
      startedAt: 1,
      updatedAt: 2,
      title: 'Voting shipped to production',
      description: "Based on my exploration, here's what I found:",
      titleSource: 'native',
      needsSummary: false,
      continuation: { kind: 'provider' },
      fingerprint: '2:100',
      summaryInput: [
        'Implement the voting project. Make it look subtle and tasteful.',
        "Based on my exploration, here's what I found:",
      ],
      providerIdentity: 'provider-id',
      correlationKey: 'codex:implement the voting project',
    };
    const catalog = new RecentConversationCatalog({
      adapters: [{ list: vi.fn(async () => [draft]) }],
    });

    await expect(catalog.list('/project')).resolves.toEqual([
      expect.objectContaining({
        title: 'Voting shipped to production',
        description:
          'Implement the voting project. Make it look subtle and tasteful.',
      }),
    ]);
  });

  it('queries the Codex thread index without walking rollout files', async () => {
    const sessionsRoot = await temporaryRoot('exawatt-index-sessions-');
    const projectRoot = await temporaryRoot('exawatt-index-project-');
    const nested = path.join(projectRoot, 'packages', 'ehr');
    await fs.promises.mkdir(nested, { recursive: true });
    const launchDirectory = await fs.promises.realpath(nested);
    const databaseFile = path.join(
      await temporaryRoot('exawatt-index-database-'),
      'state.sqlite'
    );
    const { DatabaseSync } =
      require('node:sqlite') as typeof import('node:sqlite');
    const database = new DatabaseSync(databaseFile);
    database.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY, cwd TEXT NOT NULL, rollout_path TEXT NOT NULL,
        title TEXT NOT NULL, first_user_message TEXT NOT NULL,
        preview TEXT NOT NULL, created_at_ms INTEGER, updated_at_ms INTEGER,
        recency_at_ms INTEGER, archived INTEGER NOT NULL DEFAULT 0
      )
    `);
    database
      .prepare(`INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        'indexed-session-id',
        launchDirectory,
        path.join(sessionsRoot, 'missing.jsonl'),
        'Cortex Privacy Boundary',
        'Implement client-side de-identification',
        'Verify the privacy boundary',
        100,
        200,
        300,
        0
      );
    database.close();
    const readdir = vi.spyOn(fs.promises, 'readdir');

    const rows = await new CodexConversationAdapter(
      sessionsRoot,
      databaseFile,
      async () => [projectRoot]
    ).list(projectRoot);

    expect(rows).toMatchObject([
      {
        id: 'indexed-session-id',
        cwd: launchDirectory,
        title: 'Cortex Privacy Boundary',
        providerSessionId: 'indexed-session-id',
      },
    ]);
    expect(readdir).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent Project loads and supports explicit invalidation', async () => {
    const projectDir = await temporaryRoot('exawatt-catalog-cache-');
    const draft: ConversationDraft = {
      id: 'cached-provider',
      harness: 'codex',
      cwd: projectDir,
      startedAt: 1,
      updatedAt: 2,
      title: 'Cached Project row',
      description: null,
      titleSource: 'native',
      needsSummary: false,
      providerSessionId: 'cached-provider',
      continuation: { kind: 'provider' },
      fingerprint: 'cache-fingerprint',
      summaryInput: [],
      providerIdentity: 'cached-provider',
      correlationKey: null,
    };
    const adapter: ConversationCatalogAdapter = {
      harnesses: ['codex'],
      list: vi.fn(async () => [draft]),
    };
    const catalog = new RecentConversationCatalog({ adapters: [adapter] });

    await Promise.all([catalog.list(projectDir), catalog.list(projectDir)]);
    expect(adapter.list).toHaveBeenCalledTimes(1);
    catalog.invalidate(projectDir);
    await catalog.list(projectDir);
    expect(adapter.list).toHaveBeenCalledTimes(2);
  });

  it('does not let an invalidated in-flight load repopulate stale rows', async () => {
    const projectDir = await temporaryRoot('exawatt-catalog-race-');
    const row = (title: string): ConversationDraft => ({
      id: 'race-provider',
      harness: 'codex',
      cwd: projectDir,
      startedAt: 1,
      updatedAt: 2,
      title,
      description: null,
      titleSource: 'native',
      needsSummary: false,
      providerSessionId: 'race-provider',
      continuation: { kind: 'provider' },
      fingerprint: title,
      summaryInput: [],
      providerIdentity: 'race-provider',
      correlationKey: null,
    });
    let resolveStale!: (rows: ConversationDraft[]) => void;
    const stale = new Promise<ConversationDraft[]>(resolve => {
      resolveStale = resolve;
    });
    const adapter: ConversationCatalogAdapter = {
      harnesses: ['codex'],
      list: vi
        .fn()
        .mockImplementationOnce(() => stale)
        .mockResolvedValue([row('Fresh row')]),
    };
    const catalog = new RecentConversationCatalog({ adapters: [adapter] });

    const first = catalog.list(projectDir);
    await vi.waitFor(() => expect(adapter.list).toHaveBeenCalledTimes(1));
    catalog.invalidate(projectDir);
    await expect(catalog.list(projectDir)).resolves.toMatchObject([
      { title: 'Fresh row' },
    ]);
    resolveStale([row('Stale row')]);
    await first;
    await expect(catalog.list(projectDir)).resolves.toMatchObject([
      { title: 'Fresh row' },
    ]);
  });

  it('never reconciles two retained Sessions onto one provider identity', async () => {
    const projectDir = await temporaryRoot('exawatt-one-to-one-');
    const provider: ConversationDraft = {
      id: 'one-provider',
      harness: 'claude',
      cwd: projectDir,
      startedAt: 1,
      updatedAt: 1,
      title: 'Repeat this task',
      description: null,
      titleSource: 'fallback',
      needsSummary: true,
      providerSessionId: 'one-provider',
      continuation: { kind: 'provider' },
      fingerprint: 'provider',
      summaryInput: ['Repeat this task'],
      providerIdentity: 'one-provider',
      correlationKey: 'claude:repeat this task',
    };
    const adapters: ConversationCatalogAdapter[] = [
      { harnesses: ['claude'], list: vi.fn(async () => [provider]) },
      new ProjectSessionConversationAdapter(() =>
        ['retained-a', 'retained-b'].map((durableSessionId, index) => ({
          durableSessionId,
          title: 'Claude Code',
          goal: null,
          harness: 'claude',
          cwd: projectDir,
          projectDir,
          projectName: 'Project',
          harnessSessionId: null,
          initialTask: 'Repeat this task',
          closedAt: 10 + index,
        }))
      ),
    ];

    const rows = await new RecentConversationCatalog({ adapters }).list(
      projectDir
    );
    expect(rows).toHaveLength(3);
    expect(rows.find(row => row.id === 'one-provider')?.continuation).toEqual({
      kind: 'provider',
    });
  });

  it('redacts common credentials before hosted summary transport', () => {
    const raw =
      'authorization: Bearer secret-token-value password=hunter2 sk-ant-api03-longsecrettoken';
    const redacted = redactHostedSummaryText(raw);
    expect(redacted).not.toContain('secret-token-value');
    expect(redacted).not.toContain('hunter2');
    expect(redacted).not.toContain('longsecrettoken');
    expect(redacted).toContain('[REDACTED]');
  });

  it('merges Project Session history with provider history by exact identity', async () => {
    const projectDir = await temporaryRoot('exawatt-merged-project-');
    const otherProjectDir = await temporaryRoot('exawatt-other-project-');
    const providerDraft: ConversationDraft = {
      id: 'provider-id',
      harness: 'codex',
      cwd: projectDir,
      startedAt: 1,
      updatedAt: 10,
      title: 'Take a look at this project',
      description: 'Okay done',
      titleSource: 'fallback',
      needsSummary: true,
      providerSessionId: 'provider-id',
      continuation: { kind: 'provider' },
      fingerprint: '10:100',
      summaryInput: ['Take a look at this project', 'Okay done'],
      providerIdentity: 'provider-id',
      correlationKey: 'codex:take a look at this project',
    };
    const identitylessMatch: ConversationDraft = {
      id: 'provider-recovered-by-task',
      harness: 'claude',
      cwd: projectDir,
      startedAt: 2,
      updatedAt: 11,
      title: 'Restore the retained terminal history.',
      description: null,
      titleSource: 'fallback',
      needsSummary: true,
      providerSessionId: 'provider-recovered-by-task',
      continuation: { kind: 'provider' },
      fingerprint: '11:100',
      summaryInput: ['Restore the retained terminal history.'],
      providerIdentity: 'provider-recovered-by-task',
      correlationKey: 'claude:restore the retained terminal history.',
    };
    const provider: ConversationCatalogAdapter = {
      harnesses: ['claude', 'codex'],
      list: vi.fn(async () => [providerDraft, identitylessMatch]),
    };
    const sessions = new ProjectSessionConversationAdapter(() => [
      {
        durableSessionId: 'durable-with-provider',
        title: 'Codex',
        goal: 'Finalize website migration and App resubmit',
        harness: 'codex',
        cwd: projectDir,
        projectDir,
        projectName: 'Project',
        harnessSessionId: 'provider-id',
        initialTask: null,
        closedAt: 20,
      },
      {
        durableSessionId: 'durable-without-provider',
        title: 'Claude Code',
        goal: 'Recover the Project handoff',
        harness: 'claude',
        cwd: projectDir,
        projectDir,
        projectName: 'Project',
        harnessSessionId: null,
        initialTask: 'Restore the retained terminal history.',
        closedAt: 19,
      },
      {
        durableSessionId: 'different-project',
        title: 'Codex',
        goal: 'Do not include this',
        harness: 'codex',
        cwd: otherProjectDir,
        projectDir: otherProjectDir,
        projectName: 'Elsewhere',
        harnessSessionId: 'other-id',
        initialTask: null,
        closedAt: 30,
      },
    ]);

    const rows = await new RecentConversationCatalog({
      adapters: [provider, sessions],
    }).list(projectDir);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: 'provider-id',
      title: 'Finalize website migration and App resubmit',
      continuation: {
        kind: 'exawatt-session',
        durableSessionId: 'durable-with-provider',
      },
    });
    expect(rows[1]).toMatchObject({
      id: 'provider-recovered-by-task',
      title: 'Recover the Project handoff',
      continuation: {
        kind: 'exawatt-session',
        durableSessionId: 'durable-without-provider',
      },
    });
  });

  it('keeps retained OpenCode Sessions in the source-agnostic Project history', async () => {
    const projectDir = await temporaryRoot('exawatt-opencode-project-');
    const sessions = new ProjectSessionConversationAdapter(() => [
      {
        durableSessionId: 'durable-opencode',
        title: 'OpenCode',
        goal: 'Verify provider routing',
        harness: 'opencode',
        cwd: projectDir,
        projectDir,
        projectName: 'Project',
        harnessSessionId: 'ses_opencode_exact',
        initialTask: 'Route this through the selected provider.',
        closedAt: 20,
      },
    ]);

    const rows = await new RecentConversationCatalog({
      adapters: [sessions],
    }).listForHarness('opencode', projectDir);

    expect(rows).toEqual([
      expect.objectContaining({
        id: 'ses_opencode_exact',
        harness: 'opencode',
        continuation: {
          kind: 'exawatt-session',
          durableSessionId: 'durable-opencode',
        },
      }),
    ]);
  });

  it('accepts only bounded, non-narrative native OpenCode titles', async () => {
    const projectDir = await temporaryRoot('exawatt-opencode-native-project-');
    const binDir = await temporaryRoot('exawatt-opencode-native-bin-');
    const fakeShell = path.join(binDir, 'fake-shell');
    const sessionRows = [
      {
        id: 'ses_valid_title',
        title: '  Verify\tprovider   routing  ',
        directory: projectDir,
        created: 10,
        updated: 20,
      },
      {
        id: 'ses_long_title',
        title: 'x'.repeat(73),
        directory: projectDir,
        created: 11,
        updated: 21,
      },
      {
        id: 'ses_narrative_title',
        title: 'I am reviewing the provider routing implementation',
        directory: projectDir,
        created: 12,
        updated: 22,
      },
    ];
    await fs.promises.writeFile(
      fakeShell,
      `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify(sessionRows)}'\n`,
      'utf8'
    );
    await fs.promises.chmod(fakeShell, 0o755);

    const rows = await new OpenCodeConversationAdapter(
      async () => fakeShell
    ).list(projectDir);

    expect(rows).toEqual([
      expect.objectContaining({
        id: 'ses_valid_title',
        title: 'Verify provider routing',
        titleSource: 'native',
      }),
      expect.objectContaining({
        id: 'ses_long_title',
        title: 'OpenCode session',
        titleSource: 'fallback',
      }),
      expect.objectContaining({
        id: 'ses_narrative_title',
        title: 'OpenCode session',
        titleSource: 'fallback',
      }),
    ]);
  });
});

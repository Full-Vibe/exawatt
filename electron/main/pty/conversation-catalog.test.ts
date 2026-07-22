import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  ClaudeConversationAdapter,
  CodexConversationAdapter,
  ProjectSessionConversationAdapter,
  RecentConversationCatalog,
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
    const cwd = '/projects/cortex-ehr';
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
    expect(rows[0].cwd).toBe(projectRoot);
  });

  it('uses Claude native titles and preserves the full provider ID', async () => {
    const root = await temporaryRoot('exawatt-conversation-claude-');
    const cwd = '/projects/cortex-ehr';
    const worktree = '/projects/cortex-ehr/.worktrees/privacy-pass';
    const project = path.join(root, '-projects-cortex-ehr');
    const worktreeProject = path.join(
      root,
      '-projects-cortex-ehr--worktrees-privacy-pass'
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
    expect(rows[0]).toMatchObject({
      id: '6e3a2161-9d9c-445e-85a4-cca87896b071',
      title: 'client-side-deidentification-mmhc',
      titleSource: 'native',
      needsSummary: false,
    });
    expect(rows[1]).toMatchObject({
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
      continuation: { kind: 'provider' },
      fingerprint: '2:100',
      summaryInput: ['Long raw operator prompt'],
      providerIdentity: 'provider-id',
      correlationKey: 'codex:long raw operator prompt',
    };
    const adapter: ConversationCatalogAdapter = {
      harness: 'codex',
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

  it('merges Project Session history with provider history by exact identity', async () => {
    const providerDraft: ConversationDraft = {
      id: 'provider-id',
      harness: 'codex',
      cwd: '/project',
      startedAt: 1,
      updatedAt: 10,
      title: 'Take a look at this project',
      description: 'Okay done',
      titleSource: 'fallback',
      needsSummary: true,
      continuation: { kind: 'provider' },
      fingerprint: '10:100',
      summaryInput: ['Take a look at this project', 'Okay done'],
      providerIdentity: 'provider-id',
      correlationKey: 'codex:take a look at this project',
    };
    const identitylessMatch: ConversationDraft = {
      id: 'provider-recovered-by-task',
      harness: 'claude',
      cwd: '/project',
      startedAt: 2,
      updatedAt: 11,
      title: 'Restore the retained terminal history.',
      description: null,
      titleSource: 'fallback',
      needsSummary: true,
      continuation: { kind: 'provider' },
      fingerprint: '11:100',
      summaryInput: ['Restore the retained terminal history.'],
      providerIdentity: 'provider-recovered-by-task',
      correlationKey: 'claude:restore the retained terminal history.',
    };
    const provider: ConversationCatalogAdapter = {
      list: vi.fn(async () => [providerDraft, identitylessMatch]),
    };
    const sessions = new ProjectSessionConversationAdapter(() => [
      {
        durableSessionId: 'durable-with-provider',
        title: 'Codex',
        goal: 'Finalize website migration and App resubmit',
        harness: 'codex',
        cwd: '/project',
        projectDir: '/project',
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
        cwd: '/project',
        projectDir: '/project',
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
        cwd: '/elsewhere',
        projectDir: '/elsewhere',
        projectName: 'Elsewhere',
        harnessSessionId: 'other-id',
        initialTask: null,
        closedAt: 30,
      },
    ]);

    const rows = await new RecentConversationCatalog({
      adapters: [provider, sessions],
    }).list('/project');

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
});

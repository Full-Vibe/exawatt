import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  ClaudeConversationAdapter,
  CodexConversationAdapter,
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

  it('uses Claude native titles and preserves the full provider ID', async () => {
    const root = await temporaryRoot('exawatt-conversation-claude-');
    const cwd = '/projects/cortex-ehr';
    const project = path.join(root, '-projects-cortex-ehr');
    await fs.promises.mkdir(project);
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

    const rows = await new ClaudeConversationAdapter(root).list(cwd);
    expect(rows[0]).toMatchObject({
      id: '6e3a2161-9d9c-445e-85a4-cca87896b071',
      title: 'client-side-deidentification-mmhc',
      titleSource: 'native',
      needsSummary: false,
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
      fingerprint: '2:100',
      summaryInput: ['Long raw operator prompt'],
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
});

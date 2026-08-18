import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COMMUNITY_DISTRIBUTION,
  type DistributionContractV2,
} from '@exawatt/core/distribution';
import { ContextSummarizer } from './context-summarizer';
import {
  RecentConversationCatalog,
  type ConversationCatalogAdapter,
  type ConversationDraft,
} from './conversation-catalog';
import type { PtySessionManager } from './session-manager';

class FakeManager extends EventEmitter {
  list() {
    return [
      {
        id: 'live-1',
        durableSessionId: 'session-1',
        exited: false,
        harness: 'codex' as const,
        projectDir: '/example/project',
        projectName: 'Example project',
      },
    ];
  }
}

const cleanupDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupDirectories
      .splice(0)
      .map(directory =>
        fs.promises.rm(directory, { recursive: true, force: true })
      )
  );
});

describe('resolved enrichment contract against a fake compatible service', () => {
  it('routes every official request to the configured endpoint', async () => {
    const requests: Array<{
      path: string;
      authorization: string | undefined;
      body: Record<string, unknown>;
    }> = [];
    const server = createServer(async (request, response) => {
      let raw = '';
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw) as Record<string, unknown>;
      requests.push({
        path: request.url ?? '',
        authorization: request.headers.authorization,
        body,
      });
      response.writeHead(200, { 'content-type': 'application/json' });
      if (request.url === '/v1/context-labels') {
        response.end(
          JSON.stringify({
            label: 'Compatible service contract',
            relationship: 'new_context',
            confidence: 0.99,
          })
        );
        return;
      }
      if (request.url === '/v1/goal-visuals') {
        response.end(
          JSON.stringify({
            identityKey: 'fake-compatible-visual',
            dataUrl: 'data:image/jpeg;base64,YWJj',
          })
        );
        return;
      }
      const conversations = body.conversations as Array<{ key: string }>;
      response.end(
        JSON.stringify({
          conversations: [
            {
              key: conversations[0].key,
              title: 'Compatible summary',
              summary: 'Summary returned through the configured service.',
            },
          ],
        })
      );
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    try {
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('fake enrichment service has no TCP address');
      const origin = `http://127.0.0.1:${address.port}`;
      const distribution = {
        ...COMMUNITY_DISTRIBUTION,
        account: {
          supabaseUrl: 'https://account.example.test',
          supabaseAnonKey: 'public-test-key',
          recoveryOrigin: 'https://app.example.test',
        },
        enrichment: {
          contextLabels: {
            url: `${origin}/v1/context-labels`,
            protocolVersion: 1,
          },
          conversationSummaries: {
            url: `${origin}/v1/conversation-summaries`,
            protocolVersion: 1,
          },
          goalVisuals: {
            url: `${origin}/v1/goal-visuals`,
            protocolVersion: 1,
          },
        },
      } satisfies DistributionContractV2;

      const summarizer = new ContextSummarizer({ distribution });
      summarizer.attach(new FakeManager() as unknown as PtySessionManager);
      summarizer.setAccessToken('compatible-service-token');
      summarizer.noteInput('live-1', 'Exercise the compatible service\r');

      const cacheRoot = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'exawatt-enrichment-contract-')
      );
      cleanupDirectories.push(cacheRoot);
      const draft: ConversationDraft = {
        id: 'provider-session',
        harness: 'codex',
        cwd: '/example/project',
        startedAt: 1,
        updatedAt: 2,
        title: 'Raw local title',
        description: 'Raw local title',
        titleSource: 'fallback',
        needsSummary: true,
        providerSessionId: 'provider-session',
        continuation: { kind: 'provider' },
        fingerprint: '2:100',
        summaryInput: ['Local conversation excerpt'],
        providerIdentity: 'provider-session',
        correlationKey: 'codex:local conversation excerpt',
      };
      const adapter: ConversationCatalogAdapter = {
        harnesses: ['codex'],
        list: async () => [draft],
      };
      const catalog = new RecentConversationCatalog({
        distribution,
        adapters: [adapter],
        cacheFile: path.join(cacheRoot, 'summaries.json'),
      });
      await expect(
        catalog.enrich('/example/project', 'compatible-service-token')
      ).resolves.toMatchObject([
        { title: 'Compatible summary', titleSource: 'generated' },
      ]);

      await vi.waitFor(() => expect(requests).toHaveLength(3));
      expect(requests.map(request => request.path).sort()).toEqual([
        '/v1/context-labels',
        '/v1/conversation-summaries',
        '/v1/goal-visuals',
      ]);
      expect(
        requests.every(
          request => request.authorization === 'Bearer compatible-service-token'
        )
      ).toBe(true);
      summarizer.stop();
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});

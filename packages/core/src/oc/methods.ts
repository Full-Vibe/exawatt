import type { OCGatewayClient } from './client';
import type {
  ChatSendParams,
  ChatHistoryResult,
  SessionsListResult,
  CronListResult,
  CronRunsResult,
  OCHealthResult,
  CronAddParams,
  ChatSendResult,
  OCSession,
  OCCronJob,
} from './protocol-types';

export class OCMethods {
  constructor(private client: OCGatewayClient) {}

  chatSend(text: string, sessionKey?: string): Promise<ChatSendResult> {
    const params: ChatSendParams = { text };
    if (sessionKey) {
      params.sessionKey = sessionKey;
    }
    params.idempotencyKey = `${Date.now()}-${Math.random()}`;
    return this.client.call('chat.send', params);
  }

  chatHistory(sessionKey?: string, limit?: number): Promise<ChatHistoryResult> {
    return this.client.call('chat.history', { sessionKey, limit });
  }

  chatAbort(sessionKey?: string): Promise<void> {
    return this.client.call('chat.abort', { sessionKey });
  }

  sessionsList(): Promise<SessionsListResult> {
    return this.client.call('sessions.list', {});
  }

  sessionsGet(key: string): Promise<OCSession> {
    return this.client.call('sessions.get', { key });
  }

  sessionsReset(key: string): Promise<void> {
    return this.client.call('sessions.reset', { key });
  }

  sessionsPatch(
    key: string,
    patch: { thinkingLevel?: number; verboseLevel?: number; model?: string }
  ): Promise<void> {
    return this.client.call('sessions.patch', { key, patch });
  }

  cronList(): Promise<CronListResult> {
    return this.client.call('cron.list', {});
  }

  cronAdd(job: CronAddParams): Promise<OCCronJob> {
    return this.client.call('cron.add', job);
  }

  cronRun(jobId: string): Promise<void> {
    return this.client.call('cron.run', { jobId });
  }

  cronUpdate(jobId: string, patch: Partial<CronAddParams>): Promise<OCCronJob> {
    return this.client.call('cron.update', { jobId, patch });
  }

  cronRemove(jobId: string): Promise<void> {
    return this.client.call('cron.remove', { jobId });
  }

  cronStatus(): Promise<unknown> {
    return this.client.call('cron.status', {});
  }

  cronRuns(jobId: string): Promise<CronRunsResult> {
    return this.client.call('cron.runs', { jobId });
  }

  health(): Promise<OCHealthResult> {
    return this.client.call('health', {});
  }

  status(): Promise<unknown> {
    return this.client.call('status', {});
  }

  toolsCatalog(): Promise<unknown> {
    return this.client.call('tools.catalog', {});
  }
}

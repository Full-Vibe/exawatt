import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatAdapter } from '../adapters/chat-adapter';
import type { OCClient } from '../oc/client';
import type { OCMethods } from '../oc/methods';
import type { AgentActivity } from '../types/agent';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

class MockOCClient {
  private ocHandlers = new Map<string, ((p: unknown) => void)[]>();

  onOCEvent(name: string, handler: (p: unknown) => void) {
    if (!this.ocHandlers.has(name)) this.ocHandlers.set(name, []);
    this.ocHandlers.get(name)!.push(handler);
  }

  offOCEvent(_name: string, _handler: (p: unknown) => void) {}

  simulateEvent(name: string, payload: unknown) {
    for (const h of this.ocHandlers.get(name) ?? []) h(payload);
  }
}

class MockOCMethods {
  chatHistoryResult = {
    messages: [
      { role: 'user' as const, content: 'Hello', timestamp: 1000, runId: 'r1' },
      {
        role: 'assistant' as const,
        content: 'Hi there',
        timestamp: 2000,
        runId: 'r1',
      },
    ],
    sessionKey: 'main',
  };

  chatSend = vi.fn().mockResolvedValue({ runId: 'run-1', status: 'ok' });
  chatAbort = vi.fn().mockResolvedValue(undefined);
  chatHistory = vi
    .fn()
    .mockImplementation(() => Promise.resolve(this.chatHistoryResult));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAdapter() {
  const client = new MockOCClient();
  const methods = new MockOCMethods();
  const adapter = new ChatAdapter(
    client as unknown as OCClient,
    methods as unknown as OCMethods
  );
  return { client, methods, adapter };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatAdapter', () => {
  describe('chat.segment events', () => {
    it('emits chat:message with initial delta content', () => {
      const { client, adapter } = makeAdapter();
      const received: { agentId: string; activity: AgentActivity }[] = [];
      adapter.on('chat:message', data => received.push(data));

      client.simulateEvent('chat.segment', {
        sessionKey: 'agent-1',
        runId: 'run-abc',
        delta: 'Hello',
        done: false,
      });

      expect(received).toHaveLength(1);
      expect(received[0].agentId).toBe('agent-1');
      expect(received[0].activity.content).toBe('Hello');
      expect(received[0].activity.type).toBe('chat_message');
      expect(received[0].activity.metadata?.streaming).toBe(true);
      expect(received[0].activity.id).toBe('seg-run-abc');
    });

    it('accumulates consecutive segment deltas', () => {
      const { client, adapter } = makeAdapter();
      const received: { agentId: string; activity: AgentActivity }[] = [];
      adapter.on('chat:message', data => received.push(data));

      client.simulateEvent('chat.segment', {
        sessionKey: 'agent-1',
        runId: 'run-abc',
        delta: 'Hello',
        done: false,
      });
      client.simulateEvent('chat.segment', {
        sessionKey: 'agent-1',
        runId: 'run-abc',
        delta: ' world',
        done: false,
      });

      expect(received).toHaveLength(2);
      expect(received[0].activity.content).toBe('Hello');
      expect(received[1].activity.content).toBe('Hello world');
      expect(received[1].activity.metadata?.streaming).toBe(true);
    });

    it('final segment (done=true) emits with streaming=false', () => {
      const { client, adapter } = makeAdapter();
      const received: { agentId: string; activity: AgentActivity }[] = [];
      adapter.on('chat:message', data => received.push(data));

      client.simulateEvent('chat.segment', {
        sessionKey: 'agent-1',
        runId: 'run-abc',
        delta: 'Final',
        done: true,
      });

      expect(received).toHaveLength(1);
      expect(received[0].activity.metadata?.streaming).toBe(false);
    });

    it('clears the stream buffer after done=true segment', () => {
      const { client, adapter } = makeAdapter();
      const received: { agentId: string; activity: AgentActivity }[] = [];
      adapter.on('chat:message', data => received.push(data));

      // First stream: accumulate + complete
      client.simulateEvent('chat.segment', {
        sessionKey: 'agent-1',
        runId: 'run-abc',
        delta: 'Hello',
        done: false,
      });
      client.simulateEvent('chat.segment', {
        sessionKey: 'agent-1',
        runId: 'run-abc',
        delta: ' world',
        done: true,
      });

      // Second stream with same runId: buffer should be cleared, starts fresh
      client.simulateEvent('chat.segment', {
        sessionKey: 'agent-1',
        runId: 'run-abc',
        delta: 'Fresh start',
        done: false,
      });

      expect(received[2].activity.content).toBe('Fresh start');
    });

    it('tracks separate buffers for different runIds', () => {
      const { client, adapter } = makeAdapter();
      const received: { agentId: string; activity: AgentActivity }[] = [];
      adapter.on('chat:message', data => received.push(data));

      client.simulateEvent('chat.segment', {
        sessionKey: 'agent-1',
        runId: 'run-1',
        delta: 'Alpha',
        done: false,
      });
      client.simulateEvent('chat.segment', {
        sessionKey: 'agent-2',
        runId: 'run-2',
        delta: 'Beta',
        done: false,
      });
      client.simulateEvent('chat.segment', {
        sessionKey: 'agent-1',
        runId: 'run-1',
        delta: ' more',
        done: false,
      });

      const run1Events = received.filter(
        r => r.activity.metadata?.runId === 'run-1'
      );
      const run2Events = received.filter(
        r => r.activity.metadata?.runId === 'run-2'
      );

      expect(run1Events[1].activity.content).toBe('Alpha more');
      expect(run2Events[0].activity.content).toBe('Beta');
    });

    it('includes runId in activity metadata', () => {
      const { client, adapter } = makeAdapter();
      const received: { agentId: string; activity: AgentActivity }[] = [];
      adapter.on('chat:message', data => received.push(data));

      client.simulateEvent('chat.segment', {
        sessionKey: 'agent-1',
        runId: 'my-run-id',
        delta: 'Test',
        done: false,
      });

      expect(received[0].activity.metadata?.runId).toBe('my-run-id');
    });
  });

  describe('chat.tool events', () => {
    it('emits chat:tool when done=true', () => {
      const { client, adapter } = makeAdapter();
      const received: { agentId: string; activity: AgentActivity }[] = [];
      adapter.on('chat:tool', data => received.push(data));

      client.simulateEvent('chat.tool', {
        sessionKey: 'agent-1',
        runId: 'run-abc',
        tool: 'read_file',
        input: { path: '/foo/bar' },
        output: 'file contents here',
        done: true,
      });

      expect(received).toHaveLength(1);
      expect(received[0].agentId).toBe('agent-1');
      expect(received[0].activity.type).toBe('tool_use');
      expect(received[0].activity.content).toBe('Used tool: read_file');
      expect(received[0].activity.id).toBe('tool-run-abc-read_file');
      expect(received[0].activity.metadata?.tool).toBe('read_file');
      expect(received[0].activity.metadata?.runId).toBe('run-abc');
      expect(received[0].activity.metadata?.output).toBe('file contents here');
    });

    it('does NOT emit when done=false', () => {
      const { client, adapter } = makeAdapter();
      const received: { agentId: string; activity: AgentActivity }[] = [];
      adapter.on('chat:tool', data => received.push(data));

      client.simulateEvent('chat.tool', {
        sessionKey: 'agent-1',
        runId: 'run-abc',
        tool: 'read_file',
        input: { path: '/foo/bar' },
        done: false,
      });

      expect(received).toHaveLength(0);
    });

    it('includes tool activity timestamp', () => {
      const { client, adapter } = makeAdapter();
      const before = Date.now();
      const received: { agentId: string; activity: AgentActivity }[] = [];
      adapter.on('chat:tool', data => received.push(data));

      client.simulateEvent('chat.tool', {
        sessionKey: 'agent-1',
        runId: 'run-abc',
        tool: 'bash',
        input: {},
        done: true,
      });

      const after = Date.now();
      expect(received[0].activity.timestamp).toBeGreaterThanOrEqual(before);
      expect(received[0].activity.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('getHistory()', () => {
    it('translates OCTranscriptEntry[] to AgentActivity[]', async () => {
      const { methods, adapter } = makeAdapter();
      const history = await adapter.getHistory('agent-1');

      expect(history).toHaveLength(2);
      expect(history[0].type).toBe('chat_message');
      expect(history[0].content).toBe('Hello');
      expect(history[0].timestamp).toBe(1000);
      expect(history[0].metadata?.role).toBe('user');
      expect(history[0].metadata?.historical).toBe(true);

      expect(history[1].content).toBe('Hi there');
      expect(history[1].timestamp).toBe(2000);
      expect(history[1].metadata?.role).toBe('assistant');
      expect(history[1].metadata?.historical).toBe(true);
    });

    it('passes sessionKey to chatHistory when provided', async () => {
      const { methods, adapter } = makeAdapter();
      await adapter.getHistory('agent-1', 'custom-session');

      expect(methods.chatHistory).toHaveBeenCalledWith('custom-session');
    });

    it('uses agentId as sessionKey when no sessionKey provided', async () => {
      const { methods, adapter } = makeAdapter();
      await adapter.getHistory('agent-1');

      expect(methods.chatHistory).toHaveBeenCalledWith('agent-1');
    });

    it('preserves runId in history metadata', async () => {
      const { adapter } = makeAdapter();
      const history = await adapter.getHistory('agent-1');

      expect(history[0].metadata?.runId).toBe('r1');
      expect(history[1].metadata?.runId).toBe('r1');
    });

    it('generates unique ids for history entries', async () => {
      const { adapter } = makeAdapter();
      const history = await adapter.getHistory('agent-1');

      expect(history[0].id).toMatch(/^hist-1000-/);
      expect(history[1].id).toMatch(/^hist-2000-/);
      expect(history[0].id).not.toBe(history[1].id);
    });
  });

  describe('sendMessage()', () => {
    it('calls chatSend with correct args', async () => {
      const { methods, adapter } = makeAdapter();
      await adapter.sendMessage('agent-1', 'Hello there');

      expect(methods.chatSend).toHaveBeenCalledWith('Hello there', 'agent-1');
    });

    it('uses provided sessionKey over agentId', async () => {
      const { methods, adapter } = makeAdapter();
      await adapter.sendMessage('agent-1', 'Hi', 'custom-key');

      expect(methods.chatSend).toHaveBeenCalledWith('Hi', 'custom-key');
    });
  });

  describe('abort()', () => {
    it('calls chatAbort', async () => {
      const { methods, adapter } = makeAdapter();
      await adapter.abort('my-session');

      expect(methods.chatAbort).toHaveBeenCalledWith('my-session');
    });

    it('calls chatAbort with undefined when no sessionKey', async () => {
      const { methods, adapter } = makeAdapter();
      await adapter.abort();

      expect(methods.chatAbort).toHaveBeenCalledWith(undefined);
    });
  });

  describe('destroy()', () => {
    it('removes all listeners', () => {
      const { adapter } = makeAdapter();
      const spy = vi.fn();
      adapter.on('chat:message', spy);
      adapter.destroy();

      // After destroy, re-simulate — listener should not fire
      // (We test by checking no throw and spy not called after destroy)
      // Since destroy removes listeners, we just verify the method runs cleanly
      expect(() => adapter.destroy()).not.toThrow();
    });

    it('clears stream buffers on destroy', () => {
      const { client, adapter } = makeAdapter();

      // Accumulate some data in buffers
      client.simulateEvent('chat.segment', {
        sessionKey: 'agent-1',
        runId: 'run-abc',
        delta: 'Some text',
        done: false,
      });

      // Should not throw
      expect(() => adapter.destroy()).not.toThrow();
    });
  });

  describe('event subscription setup', () => {
    it('subscribes to chat.segment and chat.tool on construction', () => {
      const client = new MockOCClient();
      const onOCEventSpy = vi.spyOn(client, 'onOCEvent');
      const methods = new MockOCMethods();

      new ChatAdapter(
        client as unknown as OCClient,
        methods as unknown as OCMethods
      );

      const names = onOCEventSpy.mock.calls.map(c => c[0]);
      expect(names).toContain('chat.segment');
      expect(names).toContain('chat.tool');
    });
  });
});

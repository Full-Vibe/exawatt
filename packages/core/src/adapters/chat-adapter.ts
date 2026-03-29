import type { OCClient } from '../oc/client';
import { TypedEmitter, type CoreEventMap } from '../events/emitter';
import type { AgentActivity } from '../types/agent';
import type {
  ChatSegmentPayload,
  ChatToolPayload,
  OCTranscriptEntry,
} from '../oc/protocol-types';
import type { OCMethods } from '../oc/methods';

export class ChatAdapter extends TypedEmitter<CoreEventMap> {
  // Accumulate streaming text segments per runId
  private streamBuffers = new Map<
    string,
    { agentId: string; content: string }
  >();

  constructor(
    private client: OCClient,
    private methods: OCMethods
  ) {
    super();
    this._subscribeToEvents();
  }

  private _subscribeToEvents(): void {
    this.client.onOCEvent('chat.segment', payload => {
      const p = payload as ChatSegmentPayload;
      this._handleSegment(p);
    });

    this.client.onOCEvent('chat.tool', payload => {
      const p = payload as ChatToolPayload;
      this._handleTool(p);
    });
  }

  private _handleSegment(p: ChatSegmentPayload): void {
    // Determine which agent this is for (use sessionKey as agentId proxy)
    const agentId = p.sessionKey;

    // Accumulate streaming content
    const existing = this.streamBuffers.get(p.runId);
    const content = (existing?.content ?? '') + p.delta;
    this.streamBuffers.set(p.runId, { agentId, content });

    // Emit progressive update for streaming UI
    const activity: AgentActivity = {
      id: `seg-${p.runId}`,
      timestamp: Date.now(),
      type: 'chat_message',
      content,
      metadata: { runId: p.runId, streaming: !p.done },
    };

    this.emit('chat:message', { agentId, activity });

    // Clean up buffer when stream completes
    if (p.done) {
      this.streamBuffers.delete(p.runId);
    }
  }

  private _handleTool(p: ChatToolPayload): void {
    const agentId = p.sessionKey;

    if (p.done) {
      const activity: AgentActivity = {
        id: `tool-${p.runId}-${p.tool}`,
        timestamp: Date.now(),
        type: 'tool_use',
        content: `Used tool: ${p.tool}`,
        metadata: {
          tool: p.tool,
          runId: p.runId,
          output: p.output,
        },
      };
      this.emit('chat:tool', { agentId, activity });
    }
  }

  /**
   * Send a message to an agent session.
   */
  async sendMessage(
    agentId: string,
    text: string,
    sessionKey?: string
  ): Promise<void> {
    await this.methods.chatSend(text, sessionKey ?? agentId);
  }

  /**
   * Get chat history for a session, translated to AgentActivity[].
   */
  async getHistory(
    agentId: string,
    sessionKey?: string
  ): Promise<AgentActivity[]> {
    const result = await this.methods.chatHistory(sessionKey ?? agentId);
    return result.messages.map((msg: OCTranscriptEntry) =>
      this._translateEntry(msg, agentId)
    );
  }

  /**
   * Abort the current agent run.
   */
  async abort(sessionKey?: string): Promise<void> {
    await this.methods.chatAbort(sessionKey);
  }

  private _translateEntry(
    entry: OCTranscriptEntry,
    agentId: string
  ): AgentActivity {
    return {
      id: `hist-${entry.timestamp}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: entry.timestamp,
      type: 'chat_message',
      content: entry.content,
      metadata: {
        role: entry.role,
        runId: entry.runId,
        historical: true,
      },
    };
  }

  destroy(): void {
    this.removeAllListeners();
    this.streamBuffers.clear();
  }
}

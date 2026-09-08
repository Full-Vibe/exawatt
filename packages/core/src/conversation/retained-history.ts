/** D71: pure retained-history projection. Source adapters own IO and execution. */
export interface RetainedConversationIdentity {
  sourceId: string;
  providerSessionId: string;
  projectId: string;
}

export type RetainedHistoryBlock =
  | { kind: 'text'; text: string; clipped: boolean }
  | {
      kind: 'tool-call';
      inputOmitted: boolean;
      toolId: string;
      name: string;
      text: string;
      clipped: boolean;
    }
  | {
      kind: 'tool-result';
      toolId: string;
      text: string;
      clipped: boolean;
      failed: boolean | null;
    }
  | { kind: 'unsupported'; sourceType: string };

export interface RetainedHistoryRecord {
  /** Address-scoped source identity, stable across pages and renderer switches. */
  id: string;
  sourceItemId: string;
  sourceTurnId: string | null;
  /** Tool/system records have no human voice. */
  role: 'operator' | 'agent' | null;
  at: number | null;
  blocks: RetainedHistoryBlock[];
}

type PartialReason =
  | 'malformed-record'
  | 'identity-mismatch'
  | 'truncated'
  | 'unsupported-record'
  | 'incomplete-turn'
  | 'omitted-tool-input';

export interface RetainedHistoryOptions {
  identity: RetainedConversationIdentity;
  /** Provenance, not a claim that this source version supports native execution. */
  sourceVersion: string | null;
  order: 'asc' | 'desc';
  olderCursor: string | null;
  completeness: 'complete' | 'partial' | 'unknown';
}

export type RetainedHistoryPage =
  | {
      status: 'unavailable';
      error: 'invalid-address' | 'invalid-page';
      identity: RetainedConversationIdentity | null;
    }
  | {
      status: 'ready';
      identity: RetainedConversationIdentity;
      sourceVersion: string | null;
      observation: 'retained';
      records: RetainedHistoryRecord[];
      olderCursor: string | null;
      completeness: 'complete' | 'partial' | 'unknown';
      partialReasons: PartialReason[];
    };

/** Processing bounds, independent of source IO bounds which adapters must enforce. */
export const RETAINED_HISTORY_LIMITS = {
  rows: 200,
  items: 400,
  blocks: 800,
  text: 64_000,
  blockText: 16_000,
  identifier: 512,
} as const;

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as ObjectValue)
    : null;
}
function identifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= RETAINED_HISTORY_LIMITS.identifier
  );
}
function timestamp(value: unknown): number | null {
  if (typeof value === 'number')
    return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== 'string' || value.length > 64) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

class Projection {
  readonly records: RetainedHistoryRecord[] = [];
  readonly reasons = new Set<PartialReason>();
  private seen = new Set<string>();
  private characters = 0;
  private items = 0;
  private blocks = 0;
  private inspectedBlocks = 0;

  constructor(readonly options: RetainedHistoryOptions) {}

  takeBlock(): boolean {
    if (++this.inspectedBlocks <= RETAINED_HISTORY_LIMITS.blocks) return true;
    this.reasons.add('truncated');
    return false;
  }

  has(sourceItemId: string, sourceTurnId: string | null = null): boolean {
    return this.seen.has(JSON.stringify([sourceTurnId, sourceItemId]));
  }

  takeItem(): boolean {
    if (++this.items <= RETAINED_HISTORY_LIMITS.items) return true;
    this.reasons.add('truncated');
    return false;
  }

  text(value: string): { text: string; clipped: boolean } {
    const length = Math.max(
      0,
      Math.min(
        RETAINED_HISTORY_LIMITS.blockText,
        RETAINED_HISTORY_LIMITS.text - this.characters
      )
    );
    // Do not split a UTF-16 surrogate pair at the clipping boundary.
    let end = Math.min(length, value.length);
    if (end > 0 && end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1]))
      end--;
    const text = value.slice(0, end);
    this.characters += text.length;
    const clipped = end < value.length;
    if (clipped) this.reasons.add('truncated');
    return { text, clipped };
  }

  block(
    target: RetainedHistoryBlock[],
    build: () => RetainedHistoryBlock
  ): boolean {
    if (++this.blocks > RETAINED_HISTORY_LIMITS.blocks) {
      this.reasons.add('truncated');
      return false;
    }
    target.push(build());
    return true;
  }

  unsupported(target: RetainedHistoryBlock[], type: unknown): void {
    this.reasons.add('unsupported-record');
    this.block(target, () => ({
      kind: 'unsupported',
      sourceType: identifier(type) ? type : 'unknown',
    }));
  }

  add(
    sourceItemId: string,
    role: RetainedHistoryRecord['role'],
    at: number | null,
    blocks: RetainedHistoryBlock[],
    sourceTurnId: string | null = null
  ): void {
    if (blocks.length === 0 || this.has(sourceItemId, sourceTurnId)) return;
    this.seen.add(JSON.stringify([sourceTurnId, sourceItemId]));
    const { sourceId, providerSessionId, projectId } = this.options.identity;
    this.records.push({
      id: JSON.stringify([
        sourceId,
        providerSessionId,
        projectId,
        sourceTurnId,
        sourceItemId,
      ]),
      sourceItemId,
      sourceTurnId,
      role,
      at,
      blocks,
    });
  }

  finish(): RetainedHistoryPage {
    return {
      status: 'ready',
      identity: { ...this.options.identity },
      sourceVersion: this.options.sourceVersion,
      observation: 'retained',
      records: this.records,
      olderCursor: this.options.olderCursor,
      completeness: this.reasons.size ? 'partial' : this.options.completeness,
      partialReasons: [...this.reasons],
    };
  }
}

function start(
  options: RetainedHistoryOptions,
  rows: unknown
): Projection | RetainedHistoryPage {
  if (
    !options.identity ||
    ![
      options.identity.sourceId,
      options.identity.providerSessionId,
      options.identity.projectId,
    ].every(identifier)
  ) {
    return {
      status: 'unavailable',
      error: 'invalid-address',
      identity: null,
    };
  }
  if (
    !Array.isArray(rows) ||
    !['asc', 'desc'].includes(options.order) ||
    !['complete', 'partial', 'unknown'].includes(options.completeness) ||
    (options.olderCursor !== null && !identifier(options.olderCursor)) ||
    (options.sourceVersion !== null && !identifier(options.sourceVersion))
  ) {
    return {
      status: 'unavailable',
      error: 'invalid-page',
      identity: { ...options.identity },
    };
  }
  const result = new Projection(options);
  if (rows.length > RETAINED_HISTORY_LIMITS.rows)
    result.reasons.add('truncated');
  return result;
}

function ordered(
  rows: unknown[],
  direction: RetainedHistoryOptions['order']
): unknown[] {
  const bounded = rows.slice(0, RETAINED_HISTORY_LIMITS.rows);
  return direction === 'desc' ? bounded.reverse() : bounded;
}

/** Codex thread/turns/list(itemsView:full). Items inside each turn are chronological. */
export function normalizeCodexRetainedHistory(
  options: RetainedHistoryOptions,
  turns: unknown
): RetainedHistoryPage {
  const projection = start(options, turns);
  if (!(projection instanceof Projection)) return projection;
  for (const value of ordered(turns as unknown[], options.order)) {
    const turn = object(value);
    if (
      !turn ||
      !identifier(turn.id) ||
      !Array.isArray(turn.items) ||
      turn.itemsView !== 'full'
    ) {
      projection.reasons.add('malformed-record');
      continue;
    }
    if (turn.status === 'inProgress') projection.reasons.add('incomplete-turn');
    for (const value of turn.items) {
      if (!projection.takeItem()) break;
      const item = object(value);
      if (!item || !identifier(item.id)) {
        projection.reasons.add('malformed-record');
        continue;
      }
      if (projection.has(item.id, turn.id)) continue;
      const blocks: RetainedHistoryBlock[] = [];
      let role: RetainedHistoryRecord['role'] = null;
      if (item.type === 'reasoning') continue;
      if (item.type === 'agentMessage' && typeof item.text === 'string') {
        role = 'agent';
        projection.block(blocks, () => ({
          kind: 'text',
          ...projection.text(item.text as string),
        }));
      } else if (item.type === 'userMessage' && Array.isArray(item.content)) {
        role = 'operator';
        if (item.content.length > RETAINED_HISTORY_LIMITS.blocks)
          projection.reasons.add('truncated');
        for (const input of item.content.slice(
          0,
          RETAINED_HISTORY_LIMITS.blocks
        )) {
          if (!projection.takeBlock()) break;
          const block = object(input);
          if (block?.type === 'text' && typeof block.text === 'string') {
            if (
              !projection.block(blocks, () => ({
                kind: 'text',
                ...projection.text(block.text as string),
              }))
            )
              break;
          } else {
            projection.unsupported(blocks, block?.type);
            if (blocks.length >= RETAINED_HISTORY_LIMITS.blocks) break;
          }
        }
      } else if (
        item.type === 'commandExecution' &&
        typeof item.command === 'string'
      ) {
        projection.block(blocks, () => ({
          kind: 'tool-call',
          inputOmitted: false,
          toolId: item.id as string,
          name: 'command',
          ...projection.text(item.command as string),
        }));
        if (typeof item.aggregatedOutput === 'string') {
          projection.block(blocks, () => ({
            kind: 'tool-result',
            toolId: item.id as string,
            ...projection.text(item.aggregatedOutput as string),
            failed:
              typeof item.exitCode === 'number' ? item.exitCode !== 0 : null,
          }));
        }
      } else projection.unsupported(blocks, item.type);
      projection.add(item.id, role, null, blocks, turn.id);
    }
  }
  return projection.finish();
}

/** Claude SDK getSessionMessages output, already selected onto its parent chain. */
export function normalizeClaudeRetainedHistory(
  options: RetainedHistoryOptions,
  messages: unknown
): RetainedHistoryPage {
  const projection = start(options, messages);
  if (!(projection instanceof Projection)) return projection;
  for (const value of ordered(messages as unknown[], options.order)) {
    if (!projection.takeItem()) break;
    const row = object(value);
    if (!row || !identifier(row.uuid)) {
      projection.reasons.add('malformed-record');
      continue;
    }
    if (row.session_id !== options.identity.providerSessionId) {
      projection.reasons.add('identity-mismatch');
      continue;
    }
    if (projection.has(row.uuid)) continue;
    const message = object(row.message);
    const blocks: RetainedHistoryBlock[] = [];
    const voice =
      row.type === 'user'
        ? 'operator'
        : row.type === 'assistant'
          ? 'agent'
          : null;
    if (!voice) {
      projection.unsupported(blocks, row.type);
      projection.add(row.uuid, null, timestamp(row.timestamp), blocks);
      continue;
    }
    if (typeof message?.content === 'string') {
      projection.block(blocks, () => ({
        kind: 'text',
        ...projection.text(message.content as string),
      }));
    } else if (Array.isArray(message?.content)) {
      for (const value of message.content.slice(
        0,
        RETAINED_HISTORY_LIMITS.blocks
      )) {
        if (!projection.takeBlock()) break;
        const block = object(value);
        if (block?.type === 'thinking' || block?.type === 'redacted_thinking')
          continue;
        if (block?.type === 'text' && typeof block.text === 'string') {
          if (
            !projection.block(blocks, () => ({
              kind: 'text',
              ...projection.text(block.text as string),
            }))
          )
            break;
        } else if (
          block?.type === 'tool_use' &&
          identifier(block.id) &&
          identifier(block.name)
        ) {
          projection.reasons.add('omitted-tool-input');
          projection.block(blocks, () => ({
            kind: 'tool-call',
            inputOmitted: true,
            toolId: block.id as string,
            name: block.name as string,
            text: '',
            clipped: false,
          }));
        } else if (
          block?.type === 'tool_result' &&
          identifier(block.tool_use_id)
        ) {
          const content = block.content;
          if (typeof content === 'string')
            projection.block(blocks, () => ({
              kind: 'tool-result',
              toolId: block.tool_use_id as string,
              ...projection.text(content),
              failed:
                typeof block.is_error === 'boolean' ? block.is_error : null,
            }));
          else if (Array.isArray(content)) {
            for (const part of content.slice(
              0,
              RETAINED_HISTORY_LIMITS.blocks
            )) {
              if (!projection.takeBlock()) break;
              const text = object(part);
              if (text?.type === 'text' && typeof text.text === 'string') {
                if (
                  !projection.block(blocks, () => ({
                    kind: 'tool-result',
                    toolId: block.tool_use_id as string,
                    ...projection.text(text.text as string),
                    failed:
                      typeof block.is_error === 'boolean'
                        ? block.is_error
                        : null,
                  }))
                )
                  break;
              } else projection.unsupported(blocks, text?.type);
            }
            if (content.length > RETAINED_HISTORY_LIMITS.blocks)
              projection.reasons.add('truncated');
          } else projection.unsupported(blocks, block.type);
        } else projection.unsupported(blocks, block?.type);
      }
      if (message.content.length > RETAINED_HISTORY_LIMITS.blocks)
        projection.reasons.add('truncated');
    } else {
      projection.reasons.add('malformed-record');
      continue;
    }
    projection.add(
      row.uuid,
      blocks.some(block => block.kind === 'text') ? voice : null,
      timestamp(row.timestamp),
      blocks
    );
  }
  return projection.finish();
}

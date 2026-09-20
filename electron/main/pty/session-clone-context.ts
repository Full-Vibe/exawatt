import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { CodexAppServerClient } from '../harness-events/codex-app-server';

const MAX_NATIVE_BYTES = 256 * 1024;
const MAX_CONTEXT_CHARS = 16_000;

type Identity = {
  harness: string;
  harnessSessionId: string | null;
  cwd: string;
};
type SessionCloneContext = {
  text: string;
  provenance: 'source-conversation';
  capturedAt: number;
  partial: boolean;
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .flatMap(item => {
      const block = object(item);
      return block &&
        ['text', 'input_text', 'output_text'].includes(String(block.type)) &&
        typeof block.text === 'string'
        ? [block.text]
        : [];
    })
    .join('\n');
}

/** Only human/assistant prose: never reasoning, tool payloads or child transcripts. */
export function cloneConversationText(
  records: readonly unknown[],
  format: 'claude' | 'codex',
  sessionId: string
): string {
  const turns: string[] = [];
  for (const value of records) {
    const row = object(value);
    if (!row) continue;
    if (format === 'claude') {
      if (row.sessionId !== sessionId || row.isSidechain === true) continue;
      const message = object(row.message);
      if (!message || !['user', 'assistant'].includes(String(message.role)))
        continue;
      const text = contentText(message.content).trim();
      if (text) turns.push(`${message.role}: ${text}`);
    } else {
      if (row.type === 'userMessage') {
        const text = contentText(row.content).trim();
        if (text) turns.push(`user: ${text}`);
      } else if (row.type === 'agentMessage' && typeof row.text === 'string') {
        turns.push(`assistant: ${row.text.trim()}`);
      }
    }
  }
  return turns.join('\n\n').slice(-MAX_CONTEXT_CHARS);
}

async function claudeContext(identity: Identity): Promise<string> {
  const root =
    process.env.EXAWATT_CLAUDE_PROJECTS_ROOT ??
    path.join(
      process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
      'projects'
    );
  const canonical = await fs.realpath(identity.cwd);
  for (const cwd of new Set([identity.cwd, canonical])) {
    const file = path.join(
      root,
      cwd.replace(/[^a-zA-Z0-9_-]/g, '-'),
      `${identity.harnessSessionId}.jsonl`
    );
    let handle: Awaited<ReturnType<typeof fs.open>>;
    try {
      handle = await fs.open(file, 'r');
    } catch {
      continue;
    }
    try {
      const stat = await handle.stat();
      const offset = Math.max(0, stat.size - MAX_NATIVE_BYTES);
      const bytes = Buffer.alloc(Math.min(stat.size, MAX_NATIVE_BYTES));
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, offset);
      const lines = bytes.subarray(0, bytesRead).toString('utf8').split('\n');
      if (offset) lines.shift();
      const rows = lines.flatMap(line => {
        try {
          const row = object(JSON.parse(line));
          // Encoded directory names are lossy. Both exact identity and cwd
          // establish ownership; no directory/recency guess can select a chat.
          return row && row.cwd === cwd ? [row] : [];
        } catch {
          return [];
        }
      });
      const text = cloneConversationText(
        rows,
        'claude',
        identity.harnessSessionId!
      );
      if (text) return text;
    } finally {
      await handle.close();
    }
  }
  return '';
}

async function nativeContext(identity: Identity): Promise<string> {
  if (
    !identity.harnessSessionId ||
    !/^[A-Za-z0-9_-]{8,128}$/.test(identity.harnessSessionId)
  )
    return '';
  if (identity.harness === 'claude') return claudeContext(identity);
  if (identity.harness !== 'codex') return '';
  const client = new CodexAppServerClient();
  try {
    await client.connect();
    const items = await client.recentConversationItems(
      identity.harnessSessionId
    );
    return cloneConversationText(items, 'codex', identity.harnessSessionId);
  } finally {
    client.close();
  }
}

/** Explicit Clone gesture authorizes a local, bounded snapshot, never a hosted summarizer. */
export async function readSessionCloneContext(
  identity: Identity,
  readNative: (identity: Identity) => Promise<string> = nativeContext
): Promise<SessionCloneContext> {
  let text = '';
  try {
    text = await readNative(identity);
  } catch {
    // Terminal output has no role boundary: never substitute tool output or
    // private reasoning for source-owned human/assistant conversation prose.
  }
  if (!text.trim())
    throw new Error(
      'Current conversation context is unavailable from this Agent Source. Clone was not started; the original Session is unchanged.'
    );
  return {
    text: text.slice(-MAX_CONTEXT_CHARS),
    provenance: 'source-conversation',
    capturedAt: Date.now(),
    partial: true,
  };
}

import { describe, it, expect } from 'vitest';
import { parseCodexConversationItems } from '../harness-events/codex-app-server';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  cloneConversationText,
  readSessionCloneContext,
} from './session-clone-context';

const identity = {
  harness: 'claude',
  harnessSessionId: 'exact-session',
  cwd: '/project',
};

describe('local Clone context boundary', () => {
  it('reads only the exact local Claude conversation and excludes cwd collisions', async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), 'clone-context-test-')
    );
    const previous = process.env.EXAWATT_CLAUDE_PROJECTS_ROOT;
    process.env.EXAWATT_CLAUDE_PROJECTS_ROOT = root;
    try {
      const cwd = await fs.realpath(root);
      const directory = path.join(root, cwd.replace(/[^a-zA-Z0-9_-]/g, '-'));
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(
        path.join(directory, 'exact-session.jsonl'),
        [
          {
            sessionId: 'exact-session',
            cwd,
            message: { role: 'user', content: 'Latest accepted direction' },
          },
          {
            sessionId: 'exact-session',
            cwd: cwd + '-other',
            message: { role: 'user', content: 'Foreign directory' },
          },
          {
            sessionId: 'other-session',
            cwd,
            message: { role: 'user', content: 'Foreign conversation' },
          },
        ]
          .map(row => JSON.stringify(row))
          .join('\n') + '\n{"partial":'
      );
      const result = await readSessionCloneContext({ ...identity, cwd });
      expect(result.text).toContain('Latest accepted direction');
      expect(result.text).not.toMatch(/Foreign/);
    } finally {
      if (previous === undefined)
        delete process.env.EXAWATT_CLAUDE_PROJECTS_ROOT;
      else process.env.EXAWATT_CLAUDE_PROJECTS_ROOT = previous;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('carries recent human/assistant prose but not another Session, child, tool output or private reasoning', () => {
    const rows = [
      {
        sessionId: identity.harnessSessionId,
        message: { role: 'user', content: 'New task replaces old task' },
      },
      {
        sessionId: identity.harnessSessionId,
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Tests pass, deploy remains' },
            { type: 'thinking', thinking: 'private' },
            { type: 'tool_use', input: 'tool secret' },
          ],
        },
      },
      {
        sessionId: 'another-session',
        message: { role: 'user', content: 'unrelated' },
      },
      {
        sessionId: identity.harnessSessionId,
        isSidechain: true,
        message: { role: 'assistant', content: 'child private' },
      },
      {
        sessionId: identity.harnessSessionId,
        message: {
          role: 'user',
          content: [{ type: 'tool_result', content: 'tool output' }],
        },
      },
    ];
    const text = cloneConversationText(
      rows,
      'claude',
      identity.harnessSessionId
    );
    expect(text).toContain('New task replaces old task');
    expect(text).toContain('Tests pass, deploy remains');
    expect(text).not.toMatch(/unrelated|private|secret|tool output/);
  });

  it('normalizes Codex source-owned items without copying reasoning or tools', () => {
    expect(
      cloneConversationText(
        [
          {
            type: 'userMessage',
            content: [{ type: 'text', text: 'Finish new objective' }],
          },
          { type: 'agentMessage', text: 'Current result' },
          { type: 'reasoning', text: 'hidden' },
          { type: 'commandExecution', aggregatedOutput: 'tool output' },
        ],
        'codex',
        'exact-session'
      )
    ).toBe('user: Finish new objective\n\nassistant: Current result');
  });

  it('normalizes real wrapped Codex protocol entries before selecting conversation prose', () => {
    const items = parseCodexConversationItems({
      data: [
        {
          turnId: 'turn',
          item: { type: 'agentMessage', text: 'Latest result' },
        },
        {
          turnId: 'turn',
          item: { type: 'reasoning', text: 'private reasoning' },
        },
        {
          turnId: 'turn',
          item: { type: 'commandExecution', aggregatedOutput: 'credential' },
        },
        {
          turnId: 'turn',
          item: {
            type: 'userMessage',
            content: [{ type: 'text', text: 'Latest request' }],
          },
        },
      ],
    });
    expect(cloneConversationText(items, 'codex', 'exact-session')).toBe(
      'user: Latest request\n\nassistant: Latest result'
    );
    expect(() =>
      parseCodexConversationItems({
        data: [{ type: 'agentMessage', text: 'unwrapped' }],
      })
    ).toThrow('no item object');
  });

  it('bounds source conversation from its latest end', async () => {
    const result = await readSessionCloneContext(
      identity,
      async () => 'old'.repeat(10_000) + 'latest request'
    );
    expect(result.text.length).toBeLessThanOrEqual(16_000);
    expect(result.text).toMatch(/latest request$/);
    expect(result.provenance).toBe('source-conversation');
  });

  it('refuses missing or failed source prose; no terminal fallback crosses the boundary', async () => {
    await expect(
      readSessionCloneContext(identity, async () => '')
    ).rejects.toThrow('Clone was not started');
    await expect(
      readSessionCloneContext(identity, async () => {
        throw new Error('unavailable');
      })
    ).rejects.toThrow('Clone was not started');
  });
});

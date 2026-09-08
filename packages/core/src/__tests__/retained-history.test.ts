import { describe, expect, it } from 'vitest';
import {
  normalizeClaudeRetainedHistory as claude,
  normalizeCodexRetainedHistory as codex,
  RETAINED_HISTORY_LIMITS as limits,
  type RetainedHistoryOptions,
  type RetainedHistoryPage,
} from '../conversation/retained-history';

const options: RetainedHistoryOptions = {
  identity: {
    sourceId: 'installed-source',
    providerSessionId: 'conversation',
    projectId: 'project',
  },
  sourceVersion: null,
  order: 'asc',
  olderCursor: null,
  completeness: 'complete',
};
const message = (uuid: string, content: unknown, type = 'assistant') => ({
  uuid,
  session_id: options.identity.providerSessionId,
  type,
  message: { content },
});
const turn = (id: string, items: unknown[]) => ({
  id,
  items,
  itemsView: 'full',
});
const text = (id: string, value: string) => ({
  id,
  type: 'agentMessage',
  text: value,
});
function ready(page: RetainedHistoryPage) {
  expect(page.status).toBe('ready');
  if (page.status !== 'ready') throw new Error('expected history');
  return page;
}

describe('retained history projection', () => {
  it('keeps source order, stable address identity and exact untrusted markdown as inert text', () => {
    const raw =
      '# Heading\n\n<script>alert(1)</script>\n![image](file:///private/key)\n```js\n$HOME\n```';
    const input = [
      turn('newer', [text('b', 'later')]),
      turn('older', [text('a', raw)]),
    ];
    const first = ready(codex({ ...options, order: 'desc' }, input));
    expect(first.records.map(row => row.sourceItemId)).toEqual(['a', 'b']);
    expect(first.records[0].blocks).toEqual([
      { kind: 'text', text: raw, clipped: false },
    ]);
    expect(ready(codex({ ...options, order: 'desc' }, input)).records).toEqual(
      first.records
    );
    const other = ready(
      codex(
        {
          ...options,
          identity: { ...options.identity, providerSessionId: 'other' },
          order: 'desc',
        },
        input
      )
    );
    expect(other.records[0].id).not.toBe(first.records[0].id);
    expect(input[0].id).toBe('newer');
  });

  it('deduplicates replayed source IDs before spending the text budget', () => {
    const repeated = text('a', 'a'.repeat(limits.blockText));
    const page = ready(
      codex(options, [
        turn('t', [
          repeated,
          repeated,
          repeated,
          repeated,
          text('b', 'still readable'),
        ]),
      ])
    );
    expect(page.records).toHaveLength(2);
    expect(page.records[1].blocks).toEqual([
      { kind: 'text', text: 'still readable', clipped: false },
    ]);
    expect(page.completeness).toBe('complete');
  });

  it('scopes Codex item identity to its source turn without inventing Claude turn identity', () => {
    const page = ready(
      codex(options, [
        turn('first', [text('same-item', 'first')]),
        turn('second', [text('same-item', 'second')]),
      ])
    );
    expect(page.records).toHaveLength(2);
    expect(page.records[0].id).not.toBe(page.records[1].id);
    expect(page.records.map(row => row.sourceTurnId)).toEqual([
      'first',
      'second',
    ]);
    expect(
      ready(claude(options, [message('m', 'text')])).records[0].sourceTurnId
    ).toBeNull();
  });

  it('never merges Claude history from another session or accepts records without stable IDs', () => {
    const page = ready(
      claude(options, [
        { ...message('wrong', 'private'), session_id: 'other' },
        message('', 'missing'),
        message('right', 'visible'),
      ])
    );
    expect(page.records.map(row => row.sourceItemId)).toEqual(['right']);
    expect(page.partialReasons).toEqual(
      expect.arrayContaining(['identity-mismatch', 'malformed-record'])
    );
    expect(page.completeness).toBe('partial');
    expect(JSON.stringify(page)).not.toContain('private');
  });

  it('retains tool correlation without presenting results or private reasoning as operator prose', () => {
    const page = ready(
      claude(options, [
        message('call', [
          { type: 'thinking', thinking: 'secret reasoning' },
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'Read',
            input: { hidden: 'not serialized' },
          },
        ]),
        message(
          'result',
          [
            {
              type: 'tool_result',
              tool_use_id: 'tool-1',
              content: [{ type: 'text', text: 'file output' }],
              is_error: false,
            },
          ],
          'user'
        ),
        message('answer', [{ type: 'text', text: 'Answer' }]),
      ])
    );
    expect(page.records.map(row => row.role)).toEqual([null, null, 'agent']);
    expect(page.records[0].blocks[0]).toMatchObject({
      kind: 'tool-call',
      toolId: 'tool-1',
      name: 'Read',
      inputOmitted: true,
    });
    expect(page.partialReasons).toContain('omitted-tool-input');
    expect(page.records[1].blocks[0]).toMatchObject({
      kind: 'tool-result',
      toolId: 'tool-1',
      text: 'file output',
      failed: false,
    });
    expect(JSON.stringify(page)).not.toMatch(/secret reasoning|not serialized/);
  });

  it('preserves bounded Codex command output and unknown exit status', () => {
    const page = ready(
      codex(options, [
        turn('t', [
          {
            type: 'commandExecution',
            id: 'cmd',
            command: 'git status',
            aggregatedOutput: 'result',
          },
        ]),
      ])
    );
    expect(page.records[0].role).toBeNull();
    expect(page.records[0].blocks).toEqual([
      {
        kind: 'tool-call',
        inputOmitted: false,
        toolId: 'cmd',
        name: 'command',
        text: 'git status',
        clipped: false,
      },
      {
        kind: 'tool-result',
        toolId: 'cmd',
        text: 'result',
        clipped: false,
        failed: null,
      },
    ]);
  });

  it('keeps unknown source versions explicit and future records visible without serializing arbitrary payloads', () => {
    const page = ready(
      codex(options, [
        turn('t', [
          { id: 'future', type: 'newProviderItem', token: 'do not render' },
        ]),
      ])
    );
    expect(page.sourceVersion).toBeNull();
    expect(page.observation).toBe('retained');
    expect(page.records[0].blocks).toEqual([
      { kind: 'unsupported', sourceType: 'newProviderItem' },
    ]);
    expect(page.completeness).toBe('partial');
    expect(JSON.stringify(page)).not.toContain('do not render');
  });

  it('distinguishes empty, partial, unknown, malformed, and unreadable addresses', () => {
    expect(ready(claude(options, [])).completeness).toBe('complete');
    expect(
      ready(
        claude(
          { ...options, completeness: 'unknown', olderCursor: 'opaque' },
          []
        )
      ).completeness
    ).toBe('unknown');
    expect(
      ready(
        codex(options, [{ id: 'summary', items: [], itemsView: 'summary' }])
      ).completeness
    ).toBe('partial');
    expect(claude(options, '{incomplete')).toMatchObject({
      status: 'unavailable',
      error: 'invalid-page',
    });
    expect(
      claude(
        {
          ...options,
          identity: {
            ...options.identity,
            providerSessionId: 'x'.repeat(limits.identifier + 1),
          },
        },
        []
      )
    ).toMatchObject({
      status: 'unavailable',
      error: 'invalid-address',
      identity: null,
    });
  });

  it('bounds record and text work and marks clipping without splitting emoji', () => {
    const long = 'x'.repeat(limits.blockText - 1) + '🙂tail';
    const page = ready(
      claude(
        options,
        Array.from({ length: limits.rows + 1 }, (_, index) =>
          message(String(index), long)
        )
      )
    );
    expect(page.records.length).toBeLessThanOrEqual(limits.rows);
    const strings = page.records.flatMap(row =>
      row.blocks.flatMap(block => ('text' in block ? [block.text] : []))
    );
    expect(
      strings.reduce((sum, value) => sum + value.length, 0)
    ).toBeLessThanOrEqual(limits.text);
    expect(strings[0]).toBe('x'.repeat(limits.blockText - 1));
    expect(page.partialReasons).toContain('truncated');
  });

  it('bounds unsupported content iteration as well as output', () => {
    const content: unknown[] = Array.from(
      { length: limits.blocks + 1 },
      () => ({ type: 'image' })
    );
    Object.defineProperty(content, limits.blocks, {
      get: () => {
        throw new Error('read beyond processing bound');
      },
    });
    const page = ready(
      codex(options, [turn('t', [{ id: 'u', type: 'userMessage', content }])])
    );
    expect(page.partialReasons).toContain('truncated');
    expect(page.records[0].blocks.length).toBeLessThanOrEqual(limits.blocks);
  });

  it('does not declare an in-progress source turn complete', () => {
    const page = ready(
      codex(options, [
        {
          ...turn('open', [text('answer', 'partial answer')]),
          status: 'inProgress',
        },
      ])
    );
    expect(page.completeness).toBe('partial');
    expect(page.partialReasons).toContain('incomplete-turn');
    expect(page.observation).toBe('retained');
  });

  it('treats timestamps as optional source evidence without inventing the current time', () => {
    const page = ready(
      claude(options, [
        { ...message('a', 'a'), timestamp: '2026-09-07T00:00:00Z' },
        { ...message('b', 'b'), timestamp: 'invalid' },
      ])
    );
    expect(page.records.map(row => row.at)).toEqual([
      Date.parse('2026-09-07T00:00:00Z'),
      null,
    ]);
  });
});

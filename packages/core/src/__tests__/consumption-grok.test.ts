/**
 * ENG-003 S4 / ENG-008 — Grok Build's local record.
 *
 * Two independent contracts are pinned here:
 *
 * 1. **Path derivation** must reproduce the harness's own
 *    `xai_grok_config::paths::encode_cwd_dirname`, including its 255-byte
 *    threshold and the slug+hash branch that a naive URL-encoder would blow
 *    past. The long fixtures below are the exact `LONG_CWDS` the harness's own
 *    regression test uses.
 * 2. **Usage parsing** must read `turn_completed` from `updates.jsonl`, and
 *    must normalize the ACP wire's FULL input token count into Exawatt's
 *    disjoint fresh/cache-read/cache-write buckets.
 */
import { describe, expect, it } from 'vitest';
import {
  GROK_MAX_DIRNAME_BYTES,
  decodeGrokCwdDirname,
  encodeGrokCwdDirname,
  grokUrlEncode,
} from '../consumption/grok-paths';
import { grokUsage, parseGrokUpdates } from '../consumption/parse-grok';
import { GrokConsumptionAdapter } from '../consumption/adapters';
import { SOURCE_CAPABILITIES } from '../consumption/types';
import type {
  ConsumptionChunk,
  ConsumptionFileRef,
  ConsumptionFileSystem,
} from '../consumption/ports';

/** The harness's own long-cwd regression fixtures (paths.rs `LONG_CWDS`). */
const LONG_CWDS = [
  '/Users/dev/Documents/開発プロジェクト/機能追加/テスト環境/ソースコード/main-branch',
  '/Users/user/Library/Mobile Documents/com~apple~CloudDocs/项目文件/深层嵌套目录/更深层次的/工作区域/project',
  '/Users/user/Library/CloudStorage/OneDrive-대한민국회사/프로젝트/개발환경/소스코드/백엔드/서비스/my-app',
  '/Users/user/Documents/工作文件夹/二零二六年项目/子目录一/子目录二/子目录三/源代码/code',
];

class MemoryFileSystem implements ConsumptionFileSystem {
  constructor(private readonly files: Record<string, string>) {}

  async listFiles(root: string): Promise<ConsumptionFileRef[]> {
    return Object.entries(this.files)
      .filter(([path]) => path.startsWith(root))
      .map(([path, content], index) => ({
        path,
        size: Buffer.byteLength(content, 'utf8'),
        mtimeMs: 1_000 + index,
      }));
  }

  async readFrom(
    path: string,
    fromByte: number
  ): Promise<ConsumptionChunk | null> {
    const content = this.files[path];
    if (content === undefined) return null;
    const buffer = Buffer.from(content, 'utf8').subarray(fromByte);
    return {
      text: buffer.toString('utf8'),
      fromByte,
      toByte: fromByte + buffer.length,
    };
  }
}

function turnCompleted(
  sessionId: string,
  promptId: string,
  usage: Record<string, unknown>,
  timestamp = 1_770_000_000
): string {
  return JSON.stringify({
    timestamp,
    method: '_x.ai/session/update',
    params: {
      sessionId,
      update: {
        sessionUpdate: 'turn_completed',
        prompt_id: promptId,
        stop_reason: 'end_turn',
        usage,
      },
    },
  });
}

const USAGE = {
  // ACP wire: `inputTokens` is the FULL prompt sum, cache buckets INCLUDED.
  inputTokens: 12_000,
  cachedReadTokens: 9_000,
  cacheCreationTokens: 1_000,
  outputTokens: 800,
  reasoningTokens: 300,
  numTurns: 1,
  modelUsage: { 'grok-4.5': { inputTokens: 12_000, outputTokens: 800 } },
};

describe('Grok Build cwd encoding — the harness contract, reproduced', () => {
  it('percent-encodes exactly the bytes Rust urlencoding does', () => {
    // Unreserved (RFC 3986) survive; `encodeURIComponent` would leave
    // `!'()*` alone, which would produce a different directory name.
    expect(grokUrlEncode("aZ0-._~!'()* ")).toBe(
      'aZ0-._~%21%27%28%29%2A%20'
    );
    expect(grokUrlEncode('/Users/jake/Code')).toBe('%2FUsers%2Fjake%2FCode');
    // Uppercase hex, and multi-byte characters encoded byte by byte.
    expect(grokUrlEncode('é')).toBe('%C3%A9');
  });

  it('round-trips an ordinary launch directory', () => {
    const cwd = '/Users/jake/Code/Personal/FullVibeAI/exawatt';
    const encoded = encodeGrokCwdDirname(cwd)!;
    expect(encoded).toBe(
      '%2FUsers%2Fjake%2FCode%2FPersonal%2FFullVibeAI%2Fexawatt'
    );
    expect(decodeGrokCwdDirname(encoded)).toBe(cwd);
  });

  it('round-trips a directory with spaces and unicode', () => {
    const cwd = '/Users/jake/My Projects/café';
    const encoded = encodeGrokCwdDirname(cwd)!;
    // A space is `%20`, never `+` — the harness uses percent-encoding, not
    // form encoding, and a `+` would name a different directory.
    expect(encoded).toContain('%20');
    expect(encoded).not.toContain('+');
    expect(decodeGrokCwdDirname(encoded)).toBe(cwd);
  });

  it('declines to derive the slug+hash form, and never guesses one', () => {
    for (const cwd of LONG_CWDS) {
      expect(grokUrlEncode(cwd).length).toBeGreaterThan(
        GROK_MAX_DIRNAME_BYTES
      );
      // `null` is the honest answer: the harness names this directory with a
      // BLAKE3 digest, and a hash Exawatt recomputed could silently disagree
      // after any upstream change. The `.cwd` file is the recovery path.
      expect(encodeGrokCwdDirname(cwd)).toBeNull();
    }
  });

  it('recovers a long directory from the .cwd file the harness writes', () => {
    const cwd = LONG_CWDS[0];
    // The shape the harness produces: `{slug}-{blake3_hex16}`, never leading
    // `%2F`, so it is unambiguously not the URL-encoded form.
    const dirname = 'main-branch-1a2b3c4d5e6f7a8b';
    expect(decodeGrokCwdDirname(dirname)).toBeNull();
    expect(decodeGrokCwdDirname(dirname, `${cwd}\n`)).toBe(cwd);
  });

  it('treats a directory right at the threshold as short', () => {
    // A path whose encoded form is exactly 255 bytes still uses the readable
    // form — the harness compares with `<=`, not `<`.
    const padding = 'a'.repeat(GROK_MAX_DIRNAME_BYTES - '%2F'.length);
    const cwd = `/${padding}`;
    const encoded = encodeGrokCwdDirname(cwd)!;
    expect(encoded).toHaveLength(GROK_MAX_DIRNAME_BYTES);
    expect(decodeGrokCwdDirname(encoded)).toBe(cwd);
  });
});

describe('parseGrokUpdates', () => {
  it('normalizes the ACP wire into disjoint token buckets', () => {
    const usage = grokUsage(USAGE);
    // 12,000 full − 9,000 cache read − 1,000 cache write = 2,000 fresh.
    expect(usage.inputTokens).toBe(2_000);
    expect(usage.cacheReadTokens).toBe(9_000);
    expect(usage.cacheWriteTokens).toBe(1_000);
    expect(usage.outputTokens).toBe(800);
    // Reasoning is a SUBSET of output, never an addend.
    expect(usage.reasoningTokens).toBe(300);
    expect(usage.webSearches).toBe(0);
    expect(usage.webFetches).toBe(0);
  });

  it('floors an inconsistent record instead of going negative', () => {
    const usage = grokUsage({
      inputTokens: 100,
      cachedReadTokens: 400,
      cacheCreationTokens: 0,
      outputTokens: 10,
      reasoningTokens: 999,
    });
    expect(usage.inputTokens).toBe(0);
    // Reasoning can never exceed the output it is a subset of.
    expect(usage.reasoningTokens).toBe(10);
  });

  it('emits one sample per completed turn, with the source cwd and model', () => {
    const { samples, diagnostics } = parseGrokUpdates(
      [
        turnCompleted('sess-1', 'prompt-a', USAGE),
        turnCompleted('sess-1', 'prompt-b', USAGE, 1_770_000_600),
      ],
      { fallbackSessionId: 'sess-1', fallbackCwd: '/work/exawatt' }
    );
    expect(samples).toHaveLength(2);
    expect(samples[0].source).toBe('grok');
    expect(samples[0].model).toBe('grok-4.5');
    expect(samples[0].cwd).toBe('/work/exawatt');
    expect(samples[0].at).toBe(new Date(1_770_000_000_000).toISOString());
    expect(samples.map(s => s.idempotencyKey)).toEqual([
      'grok:sess-1:prompt-a',
      'grok:sess-1:prompt-b',
    ]);
    expect(diagnostics.samplesEmitted).toBe(2);
    // Effort and delegation are ABSENT for this source, not zero/false.
    expect(samples[0].effort).toBeNull();
    expect(samples[0].delegation).toBeNull();
  });

  it('never double-counts a replayed turn', () => {
    const line = turnCompleted('sess-1', 'prompt-a', USAGE);
    const { samples, diagnostics } = parseGrokUpdates([line, line, line], {
      fallbackSessionId: 'sess-1',
    });
    expect(samples).toHaveLength(1);
    expect(diagnostics.duplicatesMerged).toBe(2);
  });

  it('resumes a tail read without recounting the turns before it', () => {
    const first = parseGrokUpdates([turnCompleted('sess-1', 'a', USAGE)], {
      fallbackSessionId: 'sess-1',
    });
    const second = parseGrokUpdates(
      [turnCompleted('sess-1', 'a', USAGE), turnCompleted('sess-1', 'b', USAGE)],
      { fallbackSessionId: 'sess-1', session: first.session }
    );
    expect(second.samples.map(s => s.idempotencyKey)).toEqual([
      'grok:sess-1:b',
    ]);
  });

  it('ignores every update that is not a completed turn', () => {
    const { samples, diagnostics } = parseGrokUpdates(
      [
        JSON.stringify({
          timestamp: 1,
          method: 'session/update',
          params: {
            sessionId: 'sess-1',
            update: { sessionUpdate: 'agent_message_chunk', text: 'hello' },
          },
        }),
        JSON.stringify({
          timestamp: 2,
          method: '_x.ai/session/update',
          params: {
            sessionId: 'sess-1',
            update: { sessionUpdate: 'tool_call', toolName: 'read_file' },
          },
        }),
        'not json at all',
      ],
      { fallbackSessionId: 'sess-1' }
    );
    expect(samples).toHaveLength(0);
    expect(diagnostics.linesWithoutUsage).toBe(2);
    expect(diagnostics.linesUnparsable).toBe(1);
  });

  it('counts a cancelled turn as reporting no bill, not a zero bill', () => {
    const { samples, diagnostics } = parseGrokUpdates(
      [
        JSON.stringify({
          timestamp: 1,
          method: '_x.ai/session/update',
          params: {
            sessionId: 'sess-1',
            update: {
              sessionUpdate: 'turn_completed',
              prompt_id: 'p',
              stop_reason: 'cancelled',
            },
          },
        }),
      ],
      { fallbackSessionId: 'sess-1' }
    );
    expect(samples).toHaveLength(0);
    expect(diagnostics.linesWithoutUsage).toBe(1);
  });

  it('keeps the session model when a turn spans a model switch', () => {
    const { samples } = parseGrokUpdates(
      [
        turnCompleted('sess-1', 'a', USAGE),
        turnCompleted('sess-1', 'b', {
          ...USAGE,
          modelUsage: { 'grok-4.5': {}, 'grok-code-fast-2': {} },
        }),
      ],
      { fallbackSessionId: 'sess-1' }
    );
    // Two models in one turn: no single id is honest, so the last known one
    // stands rather than an arbitrary key winning.
    expect(samples[1].model).toBe('grok-4.5');
  });
});

describe('GrokConsumptionAdapter', () => {
  const root = '/home/.grok/sessions';
  const shortDir = `${root}/%2Fwork%2Fexawatt`;
  const longDir = `${root}/main-branch-1a2b3c4d5e6f7a8b`;

  it('reads only updates.jsonl, and attributes it to the encoded cwd', async () => {
    const fs = new MemoryFileSystem({
      [`${shortDir}/018f-uuid/updates.jsonl`]: `${turnCompleted('s1', 'p1', USAGE)}\n`,
      // Same directory, different stream: history is not a usage record and
      // parsing it would double-count every turn.
      [`${shortDir}/018f-uuid/chat_history.jsonl`]: `${turnCompleted('s1', 'p1', USAGE)}\n`,
      [`${shortDir}/018f-uuid/summary.json`]: '{}',
    });
    const scan = await new GrokConsumptionAdapter(root).scan(fs);
    expect(scan.samples).toHaveLength(1);
    expect(scan.samples[0].cwd).toBe('/work/exawatt');
    expect(scan.samples[0].providerSessionId).toBe('s1');
    expect(scan.diagnostics.filesSeen).toBe(1);
  });

  it('recovers the long-cwd case through the harness .cwd metadata', async () => {
    const cwd = LONG_CWDS[0];
    const fs = new MemoryFileSystem({
      [`${longDir}/.cwd`]: cwd,
      [`${longDir}/018f-uuid/updates.jsonl`]: `${turnCompleted('s2', 'p1', USAGE)}\n`,
    });
    const scan = await new GrokConsumptionAdapter(root).scan(fs);
    expect(scan.samples).toHaveLength(1);
    expect(scan.samples[0].cwd).toBe(cwd);
  });

  it('still counts spend when the cwd cannot be recovered', async () => {
    const fs = new MemoryFileSystem({
      [`${longDir}/018f-uuid/updates.jsonl`]: `${turnCompleted('s3', 'p1', USAGE)}\n`,
    });
    const scan = await new GrokConsumptionAdapter(root).scan(fs);
    // Absent Project attribution must never become absent consumption.
    expect(scan.samples).toHaveLength(1);
    expect(scan.samples[0].cwd).toBeNull();
    expect(scan.diagnostics.recordsWithoutCwd).toBe(1);
  });

  it('reports no plan window at all — absent, never zero', async () => {
    const fs = new MemoryFileSystem({
      [`${shortDir}/018f-uuid/updates.jsonl`]: `${turnCompleted('s1', 'p1', USAGE)}\n`,
    });
    const scan = await new GrokConsumptionAdapter(root).scan(fs);
    expect(scan.planWindows).toEqual([]);
    expect(scan.windowObservations).toEqual([]);
    expect(SOURCE_CAPABILITIES.grok.planWindows).toBe(false);
    expect(SOURCE_CAPABILITIES.grok.delegation).toBe(false);
    expect(SOURCE_CAPABILITIES.grok.reasoningTokens).toBe(true);
  });

  it('tails an appended stream instead of re-reading it', async () => {
    const first = `${turnCompleted('s1', 'p1', USAGE)}\n`;
    const path = `${shortDir}/018f-uuid/updates.jsonl`;
    const cold = await new GrokConsumptionAdapter(root).scan(
      new MemoryFileSystem({ [path]: first })
    );
    const grown = `${first}${turnCompleted('s1', 'p2', USAGE)}\n`;
    const warm = await new GrokConsumptionAdapter(root).scan(
      new MemoryFileSystem({ [path]: grown }),
      { watermarks: cold.watermarks }
    );
    expect(warm.samples.map(s => s.idempotencyKey)).toEqual([
      'grok:s1:p2',
    ]);
  });
});

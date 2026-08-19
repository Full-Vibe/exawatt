import { createHash } from 'crypto';
import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ContextSummarizer,
  acceptableSubtitle,
  consumeOperatorInput,
  provisionalSubtitle,
  redactContextEvidence,
  type ReentryRecap,
} from './context-summarizer';
import type { PtySessionManager } from './session-manager';
import {
  __resetMainAnalyticsForTests,
  drainMainAnalyticsEvents,
} from '../analytics-bridge';
import {
  COMMUNITY_DISTRIBUTION,
  type DistributionContractV2,
} from '@exawatt/core/distribution';

const OFFICIAL_ENRICHMENT_DISTRIBUTION = {
  ...COMMUNITY_DISTRIBUTION,
  account: {
    supabaseUrl: 'https://account.example.test',
    supabaseAnonKey: 'public-test-key',
    recoveryOrigin: 'https://app.example.test',
  },
  enrichment: {
    contextLabels: {
      url: 'https://services.example.test/v1/context-labels',
      protocolVersion: 1,
    },
    conversationSummaries: {
      url: 'https://services.example.test/v1/conversation-summaries',
      protocolVersion: 1,
    },
    goalVisuals: {
      url: 'https://services.example.test/v1/goal-visuals',
      protocolVersion: 1,
    },
  },
} satisfies DistributionContractV2;

class FakeManager extends EventEmitter {
  private text = new Map<string, string>();
  sessions = [
    {
      id: 'live-1',
      durableSessionId: 'session-1',
      exited: false,
      harness: 'codex',
      projectDir: '/repo/exawatt',
      projectName: 'Exawatt',
    },
  ];
  list() {
    return this.sessions;
  }
  bufferCursor(id: string) {
    return (this.text.get(id) ?? '').length;
  }
  bufferSince(id: string, cursor: number) {
    return { text: (this.text.get(id) ?? '').slice(cursor), truncated: false };
  }
  data(id: string, value: string) {
    this.text.set(id, (this.text.get(id) ?? '') + value);
    this.emit('data', id, value);
  }
}

/**
 * The identity the hosted route derived server-side until 2026-08-19, from the
 * `{ projectKey, label }` the client used to send (BUG-091). The client derives
 * it locally now; reproducing the retired construction here is what proves an
 * operator keeps the goal visuals he already has instead of regenerating them.
 */
function retiredHostedIdentity(projectDir: string, label: string): string {
  const projectKey = `project:${createHash('sha256').update(projectDir, 'utf8').digest('hex')}`;
  const part = (value: string) =>
    value
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase('en-US');
  return createHash('sha256')
    .update(`goal-visual:v2\0${part(projectKey)}\0${part(label)}`, 'utf8')
    .digest('hex');
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('operator instruction capture', () => {
  it('accumulates keystrokes, edits with backspace, and commits only on Enter', () => {
    let state = consumeOperatorInput('', 'Improve titels');
    expect(state.submissions).toEqual([]);
    state = consumeOperatorInput(state.buffer, '\x7f\x7f\x7fles\r');
    expect(state).toEqual({ buffer: '', submissions: ['Improve titles'] });
  });

  it('handles bracketed multiline paste and ignores terminal escape sequences', () => {
    const state = consumeOperatorInput(
      '',
      '\x1b[200~First instruction\nSecond instruction\x1b[201~\x1b[A'
    );
    expect(state.submissions).toEqual(['First instruction']);
    expect(state.buffer).toBe('Second instruction');
  });

  it('redacts secrets and local attachment paths before upload', () => {
    const value = redactContextEvidence(
      'Review /var/folders/xy/T/exawatt-clipboard/a.png with sk-ant-abcdefghijklmnop'
    );
    expect(value).toBe('Review [Attachment] with [REDACTED TOKEN]');
  });
});

describe('provisional and accepted context labels', () => {
  it('uses New agent for image-only tasks instead of a text URI', () => {
    expect(
      provisionalSubtitle('/var/folders/xy/T/exawatt-clipboard/a.png')
    ).toBe('New agent');
    expect(provisionalSubtitle("'/private/var/folders/xy/a.png' ")).toBe(
      'New agent'
    );
    expect(provisionalSubtitle('[Image #1]')).toBe('New agent');
  });

  it('keeps meaningful launch copy and rejects unsafe model shapes', () => {
    expect(provisionalSubtitle('Improve text legibility.')).toBe(
      'Improve text legibility'
    );
    expect(acceptableSubtitle('Improve agent context summaries')).toBe(true);
    for (const value of [
      'KEEP',
      'NO_GOAL',
      "I'm fixing summaries",
      '/tmp/a.png',
      '**Fix summaries**',
    ]) {
      expect(acceptableSubtitle(value), value).toBe(false);
    }
  });
});

describe('hosted Session context ownership', () => {
  let manager: FakeManager;
  let generateLabel: ReturnType<typeof vi.fn>;
  let generateGoalVisual: ReturnType<typeof vi.fn>;
  let service: ContextSummarizer;

  beforeEach(() => {
    manager = new FakeManager();
    generateLabel = vi.fn(async () => ({
      label: 'Improve agent context summaries',
      relationship: 'new_context' as const,
      confidence: 0.95,
    }));
    generateGoalVisual = vi.fn(async () => ({
      identityKey: 'goal-identity',
      dataUrl: 'data:image/jpeg;base64,YWJj',
    }));
    service = new ContextSummarizer({
      generateLabel,
      generateGoalVisual,
      retryBaseMs: 1,
    });
    service.attach(manager as unknown as PtySessionManager);
  });

  it('shows a provisional launch label, then refreshes after authentication', async () => {
    const events: string[] = [];
    service.on('context', (_id, label) => events.push(label));
    service.seedFromTask('session-1', 'Implement cmd+shift+t to reopen tabs');
    expect(generateLabel).not.toHaveBeenCalled();
    service.setAccessToken('jwt');
    await flush();
    expect(generateLabel).toHaveBeenCalledWith(
      expect.objectContaining({
        currentLabel: 'Implement cmd+shift+t to reopen tabs',
        recentInstructions: [
          expect.objectContaining({
            text: 'Implement cmd+shift+t to reopen tabs',
          }),
        ],
      }),
      'jwt'
    );
    expect(events.at(-1)).toBe('Improve agent context summaries');
  });

  it('refreshes on submitted operator instructions, never PTY output', async () => {
    service.setAccessToken('jwt');
    manager.data('live-1', 'lots of provider output '.repeat(100));
    await flush();
    expect(generateLabel).not.toHaveBeenCalled();
    for (const char of 'Improve the stale tab summary')
      service.noteInput('live-1', char);
    expect(generateLabel).not.toHaveBeenCalled();
    service.noteInput('live-1', '\r');
    await flush();
    expect(generateLabel).toHaveBeenCalledOnce();
  });

  it('forces same-context responses to retain the exact current label', async () => {
    generateLabel.mockResolvedValue({
      label: 'Fix postal validation',
      relationship: 'same_context',
      confidence: 0.9,
    });
    service.restore('session-1', 'MVP of Widget Checkout');
    service.noteInput('live-1', 'Fix postal validation\r');
    service.setAccessToken('jwt');
    await flush();
    expect(service.getSummary('session-1')).toBe('MVP of Widget Checkout');
    expect(generateGoalVisual).toHaveBeenCalledOnce();
  });

  it('sends one opaque identity and no operator-authored text', async () => {
    // BUG-091. The request used to carry the accepted label, and `correct()`
    // queues a visual after an operator correction, so text the operator typed
    // himself crossed the boundary. What leaves now is a digest.
    service.setAccessToken('jwt');
    service.noteInput('live-1', 'Raw operator wording that must stay local\r');
    await vi.waitFor(() => expect(generateGoalVisual).toHaveBeenCalledOnce());
    const [request, token] = generateGoalVisual.mock.calls[0];
    expect(request).toEqual({
      schemaVersion: 1,
      identityKey: retiredHostedIdentity(
        '/repo/exawatt',
        'Improve agent context summaries'
      ),
    });
    expect(token).toBe('jwt');
    const serializedRequest = JSON.stringify(request);
    expect(Object.keys(request)).toEqual(['schemaVersion', 'identityKey']);
    for (const operatorText of [
      'Raw operator wording',
      'Improve agent context summaries',
      '/repo/exawatt',
      'Exawatt',
      'label',
      'projectKey',
    ]) {
      expect(serializedRequest).not.toContain(operatorText);
    }
    expect(service.getGoalVisual('session-1')).toEqual({
      identityKey: 'goal-identity',
      revision: 1,
      state: 'ready',
      dataUrl: 'data:image/jpeg;base64,YWJj',
    });
  });

  it('preserves a ready visual for later same-context classifications', async () => {
    service.setAccessToken('jwt');
    service.noteInput('live-1', 'First work\r');
    await vi.waitFor(() => expect(generateGoalVisual).toHaveBeenCalledOnce());
    generateLabel.mockResolvedValue({
      label: 'Different wording ignored',
      relationship: 'same_context',
      confidence: 0.9,
    });
    service.noteInput('live-1', 'More of the same work\r');
    await vi.waitFor(() => expect(generateLabel).toHaveBeenCalledTimes(2));
    expect(generateGoalVisual).toHaveBeenCalledOnce();
    expect(service.getGoalVisual('session-1')?.revision).toBe(1);
  });

  it('coalesces a stale image response when the goal changes again', async () => {
    let resolveFirst!: (value: {
      identityKey: string;
      dataUrl: string;
    }) => void;
    generateGoalVisual.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveFirst = resolve;
        })
    );
    service.setAccessToken('jwt');
    service.noteInput('live-1', 'First goal\r');
    await vi.waitFor(() => expect(generateGoalVisual).toHaveBeenCalledOnce());
    generateLabel.mockResolvedValue({
      label: 'Second accepted goal',
      relationship: 'new_context',
      confidence: 1,
    });
    service.noteInput('live-1', 'Second goal\r');
    await vi.waitFor(() =>
      expect(service.getGoalVisual('session-1')?.revision).toBe(2)
    );
    resolveFirst({
      identityKey: 'stale-goal',
      dataUrl: 'data:image/jpeg;base64,c3RhbGU=',
    });
    await vi.waitFor(() => expect(generateGoalVisual).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(service.getGoalVisual('session-1')).toMatchObject({
        identityKey: 'goal-identity',
        revision: 2,
        state: 'ready',
      })
    );
  });

  it('regenerates after an operator correction and falls back on failure', async () => {
    generateGoalVisual.mockRejectedValue(new Error('offline'));
    service.setAccessToken('jwt');
    service.correct('session-1', 'Corrected human goal');
    await vi.waitFor(() => expect(generateGoalVisual).toHaveBeenCalledOnce());
    // The words in a correction are the operator's own. They stay on the
    // machine even though a correction is exactly what queues this request
    // (BUG-091).
    expect(JSON.stringify(generateGoalVisual.mock.calls[0][0])).not.toContain(
      'Corrected human goal'
    );
    expect(generateGoalVisual.mock.calls[0][0]).toEqual({
      schemaVersion: 1,
      identityKey: retiredHostedIdentity(
        '/repo/exawatt',
        'Corrected human goal'
      ),
    });
    await vi.waitFor(() =>
      expect(service.getGoalVisual('session-1')).toMatchObject({
        revision: 1,
        state: 'fallback',
        dataUrl: null,
      })
    );
  });

  it('does not regenerate when correction copy is unchanged', async () => {
    service.restore('session-1', 'Corrected human goal');
    service.setAccessToken('jwt');
    expect(service.correct('session-1', 'Corrected human goal')).toBe(
      'Corrected human goal'
    );
    await flush();
    expect(generateGoalVisual).not.toHaveBeenCalled();
  });

  it('retries one transient visual failure, then accepts the result', async () => {
    vi.useFakeTimers();
    generateGoalVisual
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        identityKey: 'retried-goal',
        dataUrl: 'data:image/jpeg;base64,YWJj',
      });
    service.setAccessToken('jwt');
    service.correct('session-1', 'Corrected human goal');
    await flush();
    expect(service.getGoalVisual('session-1')?.state).toBe('fallback');
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();
    expect(generateGoalVisual).toHaveBeenCalledTimes(2);
    expect(service.getGoalVisual('session-1')).toMatchObject({
      identityKey: 'retried-goal',
      revision: 1,
      state: 'ready',
    });
    vi.useRealTimers();
  });

  it('restores only bounded ready visuals and sheds transitional state', () => {
    const ready = service.restoreGoalVisual('session-1', {
      identityKey: 'persisted-goal',
      revision: 3,
      state: 'ready',
      dataUrl: 'data:image/webp;base64,YWJj',
    });
    expect(ready).toMatchObject({ state: 'ready', revision: 3 });
    expect(
      service.restoreGoalVisual('session-2', {
        identityKey: 'pending-goal',
        revision: 2,
        state: 'generating',
      })
    ).toMatchObject({ state: 'fallback', dataUrl: null });
    expect(
      service.restoreGoalVisual('session-3', {
        identityKey: 'bad-goal',
        revision: 1,
        state: 'ready',
        dataUrl: 'https://public.example/image.jpg',
      })
    ).toBeNull();
  });

  it('lets hosted inference sharpen a provisional launch instruction', async () => {
    generateLabel.mockResolvedValue({
      label: 'Improve agent context summaries',
      relationship: 'same_context',
      confidence: 0.95,
    });
    service.seedFromTask(
      'session-1',
      'Please investigate and improve our stale agent title summarization system'
    );
    service.setAccessToken('jwt');
    await flush();
    expect(generateLabel).toHaveBeenCalledWith(
      expect.objectContaining({ currentLabelSource: 'provisional' }),
      'jwt'
    );
    expect(service.getSummary('session-1')).toBe(
      'Improve agent context summaries'
    );
  });

  it('discards an older response when a new instruction arrives in flight', async () => {
    let resolveFirst!: (value: {
      label: string;
      relationship: 'new_context';
      confidence: number;
    }) => void;
    generateLabel.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveFirst = resolve;
        })
    );
    service.setAccessToken('jwt');
    service.noteInput('live-1', 'First topic\r');
    await Promise.resolve();
    service.noteInput('live-1', 'Improve agent context summaries\r');
    resolveFirst({
      label: 'Stale first topic',
      relationship: 'new_context',
      confidence: 1,
    });
    await vi.waitFor(() => expect(generateLabel).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(service.getSummary('session-1')).toBe(
        'Improve agent context summaries'
      )
    );
  });

  it('retains the last good label through endpoint failure and retries', async () => {
    vi.useFakeTimers();
    generateLabel
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        label: 'Improve agent context summaries',
        relationship: 'new_context',
        confidence: 0.8,
      });
    service.restore('session-1', 'Implement cmd+shift+t to reopen tabs');
    service.setAccessToken('jwt');
    service.noteInput('live-1', 'Improve summaries\r');
    await flush();
    expect(service.getSummary('session-1')).toBe(
      'Implement cmd+shift+t to reopen tabs'
    );
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(service.getSummary('session-1')).toBe(
      'Improve agent context summaries'
    );
    vi.useRealTimers();
  });

  it('applies an operator correction immediately and invalidates in-flight output', async () => {
    let resolve!: (value: {
      label: string;
      relationship: 'new_context';
      confidence: number;
    }) => void;
    generateLabel.mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        })
    );
    service.setAccessToken('jwt');
    service.noteInput('live-1', 'Topic\r');
    await Promise.resolve();
    expect(
      service.correct('session-1', 'Improve agent context summaries')
    ).toBe('Improve agent context summaries');
    resolve({
      label: 'Stale model label',
      relationship: 'new_context',
      confidence: 1,
    });
    await flush();
    expect(service.getSummary('session-1')).toBe(
      'Improve agent context summaries'
    );
    expect(service.correct('session-1', '/tmp/bad.png')).toBeNull();
  });

  it('cancels a failed request retry after an authoritative correction', async () => {
    vi.useFakeTimers();
    generateLabel.mockRejectedValueOnce(new Error('offline'));
    service.setAccessToken('jwt');
    service.noteInput('live-1', 'Old evidence\r');
    await flush();
    expect(generateLabel).toHaveBeenCalledOnce();
    service.correct('session-1', 'Corrected human label');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(generateLabel).toHaveBeenCalledOnce();
    expect(service.getSummary('session-1')).toBe('Corrected human label');
    vi.useRealTimers();
  });
});

describe('distribution-owned enrichment capability', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps local labels and deterministic visuals without auth or fetch in community builds', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('community enrichment attempted network I/O');
    });
    vi.stubGlobal('fetch', fetchMock);
    const manager = new FakeManager();
    const service = new ContextSummarizer({
      distribution: COMMUNITY_DISTRIBUTION,
    });
    service.attach(manager as unknown as PtySessionManager);

    service.setAccessToken('token-that-must-not-enable-a-capability');
    service.seedFromTask('session-1', 'Keep community enrichment local');
    service.noteInput('live-1', 'Evidence that must stay on this device\r');
    service.correct('session-1', 'Local deterministic goal');
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(service.getSummary('session-1')).toBe('Local deterministic goal');
    expect(service.getGoalVisual('session-1')).toMatchObject({
      identityKey: expect.stringMatching(/^fallback:[a-f0-9]{32}$/),
      revision: 1,
      state: 'fallback',
      dataUrl: null,
    });
    service.stop();
  });

  it('uses the exact official context-label and goal-visual endpoints', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/context-labels')) {
        return new Response(
          JSON.stringify({
            label: 'Configured service boundary',
            relationship: 'new_context',
            confidence: 0.98,
          })
        );
      }
      if (url.endsWith('/goal-visuals')) {
        return new Response(
          JSON.stringify({
            identityKey: 'configured-goal-identity',
            dataUrl: 'data:image/jpeg;base64,YWJj',
          })
        );
      }
      throw new Error(`unexpected enrichment URL ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const manager = new FakeManager();
    const service = new ContextSummarizer({
      distribution: OFFICIAL_ENRICHMENT_DISTRIBUTION,
    });
    service.attach(manager as unknown as PtySessionManager);
    service.setAccessToken('official-token');
    service.noteInput('live-1', 'Use the configured service boundary\r');

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      'https://services.example.test/v1/context-labels',
      'https://services.example.test/v1/goal-visuals',
    ]);
    expect(service.getGoalVisual('session-1')).toMatchObject({
      identityKey: 'configured-goal-identity',
      state: 'ready',
    });
    service.stop();
  });
});

/**
 * ENG-030 OS1.5. Decision `0031` requires an independent user control that
 * *prevents hosted feature calls* — not one that merely stores a boolean. Each
 * test below fails if enforcement moves back to the call site, and the cache /
 * last-good assertions pin the "deterministic local fallback" half of the same
 * decision.
 */
describe('hosted context labels are independently controllable', () => {
  let manager: FakeManager;
  let generateLabel: ReturnType<typeof vi.fn>;
  let generateGoalVisual: ReturnType<typeof vi.fn>;
  let service: ContextSummarizer;

  beforeEach(() => {
    manager = new FakeManager();
    generateLabel = vi.fn(async () => ({
      label: 'Improve agent context summaries',
      relationship: 'new_context' as const,
      confidence: 0.95,
    }));
    generateGoalVisual = vi.fn(async () => ({
      identityKey: 'goal-identity',
      dataUrl: 'data:image/jpeg;base64,YWJj',
    }));
    service = new ContextSummarizer({
      generateLabel,
      generateGoalVisual,
      retryBaseMs: 1,
    });
    service.attach(manager as unknown as PtySessionManager);
  });

  it('calls the endpoint by default, because the preference is absent', async () => {
    service.setAccessToken('jwt');
    service.noteInput('live-1', 'Improve the stale tab summary\r');
    await flush();
    expect(generateLabel).toHaveBeenCalledOnce();
  });

  it('assembles no operator evidence and sends nothing while switched off', async () => {
    service.setContextLabelsEnabled(false);
    service.setAccessToken('jwt');
    service.seedFromTask('session-1', 'Implement cmd+shift+t to reopen tabs');
    service.noteInput('live-1', 'A prompt that must never leave the device\r');
    await flush();
    expect(generateLabel).not.toHaveBeenCalled();
    // The launch label is derived locally and stays: turning a hosted feature
    // off must not take the deterministic fallback with it.
    expect(service.getSummary('session-1')).toBe(
      'Implement cmd+shift+t to reopen tabs'
    );
  });

  it('restores a persisted label while switched off', () => {
    service.setContextLabelsEnabled(false);
    service.setAccessToken('jwt');
    expect(service.restore('session-1', 'MVP of Widget Checkout')).toBe(
      'MVP of Widget Checkout'
    );
    expect(generateLabel).not.toHaveBeenCalled();
  });

  it('keeps the accepted label and generated visual when switched off mid-session', async () => {
    service.setAccessToken('jwt');
    service.noteInput('live-1', 'First work\r');
    await vi.waitFor(() => expect(generateGoalVisual).toHaveBeenCalledOnce());
    expect(service.getSummary('session-1')).toBe(
      'Improve agent context summaries'
    );

    service.setContextLabelsEnabled(false);
    service.noteInput('live-1', 'More work after the switch\r');
    await flush();

    expect(generateLabel).toHaveBeenCalledOnce();
    expect(service.getSummary('session-1')).toBe(
      'Improve agent context summaries'
    );
    expect(service.getGoalVisual('session-1')).toMatchObject({
      revision: 1,
      state: 'ready',
    });
  });

  it('discards a response that lands after the switch went off', async () => {
    let resolveFirst!: (value: {
      label: string;
      relationship: 'new_context';
      confidence: number;
    }) => void;
    generateLabel.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveFirst = resolve;
        })
    );
    service.restore('session-1', 'Implement cmd+shift+t to reopen tabs');
    service.setAccessToken('jwt');
    service.noteInput('live-1', 'Topic\r');
    await Promise.resolve();
    expect(generateLabel).toHaveBeenCalledOnce();

    service.setContextLabelsEnabled(false);
    resolveFirst({
      label: 'Label the operator opted out of',
      relationship: 'new_context',
      confidence: 1,
    });
    await flush();

    expect(service.getSummary('session-1')).toBe(
      'Implement cmd+shift+t to reopen tabs'
    );
  });

  it('cancels a queued failure retry instead of calling again', async () => {
    vi.useFakeTimers();
    generateLabel.mockRejectedValue(new Error('offline'));
    service.setAccessToken('jwt');
    service.noteInput('live-1', 'Old evidence\r');
    await flush();
    expect(generateLabel).toHaveBeenCalledOnce();

    service.setContextLabelsEnabled(false);
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(generateLabel).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('resumes on the next instruction after being switched back on', async () => {
    service.setAccessToken('jwt');
    service.setContextLabelsEnabled(false);
    service.noteInput('live-1', 'Hidden while the control was off\r');
    await flush();
    expect(generateLabel).not.toHaveBeenCalled();

    service.setContextLabelsEnabled(true);
    service.noteInput('live-1', 'Improve the stale tab summary\r');
    await flush();

    expect(generateLabel).toHaveBeenCalledOnce();
    const [evidence] = generateLabel.mock.calls[0];
    expect(evidence.recentInstructions).toEqual([
      expect.objectContaining({ text: 'Improve the stale tab summary' }),
    ]);
    expect(JSON.stringify(evidence)).not.toContain('Hidden while the control');
  });
});

describe('goal visuals are independently controllable', () => {
  let manager: FakeManager;
  let generateLabel: ReturnType<typeof vi.fn>;
  let generateGoalVisual: ReturnType<typeof vi.fn>;
  let service: ContextSummarizer;

  beforeEach(() => {
    manager = new FakeManager();
    generateLabel = vi.fn(async () => ({
      label: 'Improve agent context summaries',
      relationship: 'new_context' as const,
      confidence: 0.95,
    }));
    generateGoalVisual = vi.fn(async () => ({
      identityKey: 'goal-identity',
      dataUrl: 'data:image/jpeg;base64,YWJj',
    }));
    service = new ContextSummarizer({
      generateLabel,
      generateGoalVisual,
      retryBaseMs: 1,
    });
    service.attach(manager as unknown as PtySessionManager);
  });

  it('labels Sessions without ever calling the image provider when off', async () => {
    service.setGoalVisualsEnabled(false);
    service.setAccessToken('jwt');
    service.noteInput('live-1', 'First work\r');
    await vi.waitFor(() => expect(generateLabel).toHaveBeenCalledOnce());
    await flush();
    expect(generateGoalVisual).not.toHaveBeenCalled();
    expect(service.getSummary('session-1')).toBe(
      'Improve agent context summaries'
    );
  });

  it('preserves an already generated image and stops requesting new ones', async () => {
    service.setAccessToken('jwt');
    service.noteInput('live-1', 'First work\r');
    await vi.waitFor(() => expect(generateGoalVisual).toHaveBeenCalledOnce());

    service.setGoalVisualsEnabled(false);
    service.correct('session-1', 'A different human goal');
    await flush();

    expect(generateGoalVisual).toHaveBeenCalledOnce();
    expect(service.getGoalVisual('session-1')).toMatchObject({
      identityKey: 'goal-identity',
      revision: 1,
      state: 'ready',
    });
  });

  it('resumes generation for labelled Sessions when switched back on', async () => {
    service.setGoalVisualsEnabled(false);
    service.setAccessToken('jwt');
    service.noteInput('live-1', 'First work\r');
    await vi.waitFor(() => expect(generateLabel).toHaveBeenCalledOnce());
    expect(generateGoalVisual).not.toHaveBeenCalled();

    service.setGoalVisualsEnabled(true);

    await vi.waitFor(() => expect(generateGoalVisual).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(service.getGoalVisual('session-1')).toMatchObject({
        state: 'ready',
      })
    );
  });
});

/**
 * ENG-030 OS1.5b. Main-process hosted-call failures are counted through the
 * analytics bridge — but only genuine attempt-and-fail. A feature the
 * operator switched off never attempts, so it never counts.
 */
describe('main-process hosted-call failures are counted', () => {
  let manager: FakeManager;

  beforeEach(() => {
    __resetMainAnalyticsForTests();
    manager = new FakeManager();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetMainAnalyticsForTests();
  });

  it('queues the HTTP status when the context-label endpoint refuses', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new ContextSummarizer({
      distribution: OFFICIAL_ENRICHMENT_DISTRIBUTION,
      retryBaseMs: 60_000,
    });
    service.attach(manager as unknown as PtySessionManager);
    service.setAccessToken('jwt');
    service.noteInput('live-1', 'Improve the stale tab summary\r');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await flush();
    expect(drainMainAnalyticsEvents()).toEqual([
      {
        name: 'hosted_call_failed',
        service: 'context_labels',
        failure: null,
        statusCode: 503,
      },
    ]);
    service.stop();
  });

  it('classifies a transport failure as network, with no status', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    vi.stubGlobal('fetch', fetchMock);
    const service = new ContextSummarizer({
      distribution: OFFICIAL_ENRICHMENT_DISTRIBUTION,
      retryBaseMs: 60_000,
    });
    service.attach(manager as unknown as PtySessionManager);
    service.setAccessToken('jwt');
    service.noteInput('live-1', 'Improve the stale tab summary\r');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await flush();
    expect(drainMainAnalyticsEvents()).toEqual([
      {
        name: 'hosted_call_failed',
        service: 'context_labels',
        failure: 'network',
        statusCode: null,
      },
    ]);
    service.stop();
  });

  it('never counts context labels the operator switched off', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new ContextSummarizer({
      distribution: OFFICIAL_ENRICHMENT_DISTRIBUTION,
      retryBaseMs: 60_000,
    });
    service.attach(manager as unknown as PtySessionManager);
    service.setContextLabelsEnabled(false);
    service.setAccessToken('jwt');
    service.noteInput('live-1', 'A prompt that must never leave the device\r');
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(drainMainAnalyticsEvents()).toEqual([]);
    service.stop();
  });

  it('queues the HTTP status when the goal-visual endpoint fails', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new ContextSummarizer({
      distribution: OFFICIAL_ENRICHMENT_DISTRIBUTION,
      generateLabel: async () => ({
        label: 'Improve agent context summaries',
        relationship: 'new_context' as const,
        confidence: 0.9,
      }),
      retryBaseMs: 60_000,
    });
    service.attach(manager as unknown as PtySessionManager);
    service.setAccessToken('jwt');
    service.noteInput('live-1', 'First work\r');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await flush();
    expect(drainMainAnalyticsEvents()).toEqual([
      {
        name: 'hosted_call_failed',
        service: 'goal_visuals',
        failure: null,
        statusCode: 500,
      },
    ]);
    service.stop();
  });

  it('never counts goal visuals the operator switched off', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new ContextSummarizer({
      distribution: OFFICIAL_ENRICHMENT_DISTRIBUTION,
      generateLabel: async () => ({
        label: 'Improve agent context summaries',
        relationship: 'new_context' as const,
        confidence: 0.9,
      }),
      retryBaseMs: 60_000,
    });
    service.attach(manager as unknown as PtySessionManager);
    service.setGoalVisualsEnabled(false);
    service.setAccessToken('jwt');
    service.noteInput('live-1', 'First work\r');
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(drainMainAnalyticsEvents()).toEqual([]);
    service.stop();
  });
});

/**
 * ENG-030 OS1.5. The recap sends the most, least redacted, in the product —
 * raw scrollback to the operator's own `claude` CLI — so its switch must
 * PREVENT the work at the boundary: no scrollback read, no process spawned,
 * in-flight output discarded, `EXAWATT_SUMMARIES=0` still an override.
 */
describe('the re-entry recap is independently controllable', () => {
  function recapRig(
    summarize?: (prompt: string, maxChars: number) => Promise<string | null>
  ) {
    const state = { now: 100_000 };
    const manager = new FakeManager();
    const summarizeFn = vi.fn(
      summarize ?? (async () => 'Tests passed; approval is waiting.')
    );
    const service = new ContextSummarizer({
      recapAwayMs: 10_000,
      recapMinChars: 20,
      now: () => state.now,
      summarize: summarizeFn,
    });
    service.attach(manager as unknown as PtySessionManager);
    const recaps: ReentryRecap[] = [];
    service.on('recap', (recap: ReentryRecap) => recaps.push(recap));
    return { manager, service, summarize: summarizeFn, recaps, state };
  }

  it('reads no scrollback and spawns nothing while switched off', async () => {
    const { manager, service, summarize, recaps, state } = recapRig();
    const bufferSince = vi.spyOn(manager, 'bufferSince');
    service.setReentryRecapEnabled(false);
    service.setWindowFocused(true);
    service.setFocus('live-1');
    service.setWindowFocused(false);
    state.now += 12_000;
    manager.data('live-1', 'new tests passed and approval is waiting\n');
    service.setWindowFocused(true);
    await flush();
    expect(bufferSince).not.toHaveBeenCalled();
    expect(summarize).not.toHaveBeenCalled();
    expect(recaps).toEqual([]);
  });

  it('clears an away checkpoint recorded before the switch went off', async () => {
    const { manager, service, summarize, recaps, state } = recapRig();
    service.setWindowFocused(true);
    service.setFocus('live-1');
    service.setWindowFocused(false); // checkpoint recorded while still enabled
    state.now += 12_000;
    manager.data('live-1', 'new tests passed and approval is waiting\n');
    service.setReentryRecapEnabled(false); // mid-away
    service.setWindowFocused(true);
    await flush();
    expect(summarize).not.toHaveBeenCalled();
    expect(recaps).toEqual([]);
  });

  it('discards in-flight recap output when switched off mid-call', async () => {
    let resolveRecap!: (value: string) => void;
    const { manager, service, summarize, recaps, state } = recapRig(
      () =>
        new Promise<string | null>(resolve => {
          resolveRecap = resolve;
        })
    );
    service.setWindowFocused(true);
    service.setFocus('live-1');
    service.setWindowFocused(false);
    state.now += 12_000;
    manager.data('live-1', 'new tests passed and approval is waiting\n');
    service.setWindowFocused(true);
    await flush();
    expect(summarize).toHaveBeenCalledOnce();

    service.setReentryRecapEnabled(false);
    resolveRecap('Late recap the operator opted out of');
    await flush();
    expect(recaps).toEqual([]);
  });

  it('resumes on the next away/return cycle after being switched back on', async () => {
    const { manager, service, summarize, recaps, state } = recapRig();
    service.setReentryRecapEnabled(false);
    service.setWindowFocused(true);
    service.setFocus('live-1');
    service.setWindowFocused(false);
    state.now += 12_000;
    manager.data('live-1', 'output the operator opted out of hearing about\n');
    service.setWindowFocused(true);
    await flush();
    expect(summarize).not.toHaveBeenCalled();

    service.setReentryRecapEnabled(true);
    service.setWindowFocused(false);
    state.now += 12_000;
    manager.data('live-1', 'new tests passed and approval is waiting\n');
    service.setWindowFocused(true);
    await flush();
    expect(summarize).toHaveBeenCalledOnce();
    expect(recaps).toMatchObject([{ id: 'live-1', awayMs: 12_000 }]);
    // The switched-off period was never checkpointed, so its output is not
    // in the prompt either.
    const prompt = summarize.mock.calls[0][0] as string;
    expect(prompt).not.toContain('opted out of hearing about');
  });

  it('keeps EXAWATT_SUMMARIES=0 as the environment override', async () => {
    process.env.EXAWATT_SUMMARIES = '0';
    try {
      const { manager, service, summarize, recaps, state } = recapRig();
      service.setReentryRecapEnabled(true);
      service.setWindowFocused(true);
      service.setFocus('live-1');
      service.setWindowFocused(false);
      state.now += 12_000;
      manager.data('live-1', 'new tests passed and approval is waiting\n');
      service.setWindowFocused(true);
      await flush();
      expect(summarize).not.toHaveBeenCalled();
      expect(recaps).toEqual([]);
    } finally {
      delete process.env.EXAWATT_SUMMARIES;
    }
  });
});

describe('re-entry recap remains a separate delta feature', () => {
  it('summarizes only output produced while away', async () => {
    let now = 100_000;
    const manager = new FakeManager();
    const summarize = vi.fn(async () => 'Tests passed; approval is waiting.');
    const service = new ContextSummarizer({
      recapAwayMs: 10_000,
      recapMinChars: 20,
      now: () => now,
      summarize,
    });
    service.attach(manager as unknown as PtySessionManager);
    service.setWindowFocused(true);
    service.setFocus('live-1');
    manager.data('live-1', 'old output already seen\n');
    service.setWindowFocused(false);
    now += 12_000;
    manager.data(
      'live-1',
      '\x1b[32mnew tests passed and approval is waiting\x1b[0m'
    );
    const recap = new Promise(resolve => service.once('recap', resolve));
    service.setWindowFocused(true);
    await expect(recap).resolves.toMatchObject({
      id: 'live-1',
      awayMs: 12_000,
    });
    const prompt = summarize.mock.calls[0][0] as string;
    expect(prompt).toContain('new tests passed');
    expect(prompt).not.toContain('old output');
  });
});

/**
 * BUG-025. Main has two identity spaces and, until `session-forgotten`, one
 * lifecycle hook bound to the wrong one. The generic residue check below is
 * the part that matters long-term: it fails for ANY Session-keyed store that
 * outlives a forgotten Session, including one added years from now, so the
 * cheapest way to keep it green is to declare the store through
 * `SessionScopedState` rather than as a bare `Map`.
 */
function sessionKeyedResidue(
  owner: object,
  durableSessionId: string
): string[] {
  return Object.entries(owner)
    .filter(
      ([, value]) =>
        (value instanceof Map || value instanceof Set) &&
        value.has(durableSessionId)
    )
    .map(([name]) => name);
}

describe('a forgotten Session leaves nothing behind in main', () => {
  let manager: FakeManager;
  let generateLabel: ReturnType<typeof vi.fn>;
  let generateGoalVisual: ReturnType<typeof vi.fn>;
  let service: ContextSummarizer;
  // A real goal visual is a ~265 KB JPEG data URL; this is the same shape.
  const jpeg = `data:image/jpeg;base64,${'YWJj'.repeat(16)}`;

  beforeEach(() => {
    manager = new FakeManager();
    generateLabel = vi.fn(async () => ({
      label: 'Improve agent context summaries',
      relationship: 'new_context' as const,
      confidence: 0.95,
    }));
    generateGoalVisual = vi.fn(async () => ({
      identityKey: 'goal-identity',
      dataUrl: jpeg,
    }));
    service = new ContextSummarizer({
      generateLabel,
      generateGoalVisual,
      retryBaseMs: 1,
    });
    service.attach(manager as unknown as PtySessionManager);
  });

  it('releases every Session-keyed store, including ones added later', async () => {
    service.setAccessToken('jwt');
    service.seedFromTask('session-1', 'Implement reopen closed tab');
    service.noteInput('live-1', 'Also fix the stale subtitle\r');
    await vi.waitFor(() =>
      expect(service.getGoalVisual('session-1')?.state).toBe('ready')
    );
    expect(service.getSummary('session-1')).toBe(
      'Improve agent context summaries'
    );
    expect(sessionKeyedResidue(service, 'session-1').length).toBeGreaterThan(0);

    manager.emit('session-forgotten', 'session-1');

    expect(service.getSummary('session-1')).toBeNull();
    expect(service.getGoalVisual('session-1')).toBeNull();
    expect(sessionKeyedResidue(service, 'session-1')).toEqual([]);
  });

  it('keeps a still-running PTY out of the Session release path', async () => {
    service.setAccessToken('jwt');
    service.seedFromTask('session-1', 'Implement reopen closed tab');
    await vi.waitFor(() =>
      expect(service.getGoalVisual('session-1')?.state).toBe('ready')
    );
    // One PTY process ended; the Session can run again under a new one.
    manager.emit('exit', 'live-1');
    expect(service.getSummary('session-1')).toBe(
      'Improve agent context summaries'
    );
    expect(service.getGoalVisual('session-1')?.state).toBe('ready');
  });

  it('does not let an in-flight label failure resurrect a forgotten Session', async () => {
    vi.useFakeTimers();
    try {
      let failFirst!: (error: Error) => void;
      generateLabel.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            failFirst = reject;
          })
      );
      service.setAccessToken('jwt');
      service.seedFromTask('session-1', 'Implement reopen closed tab');
      await vi.waitFor(() => expect(generateLabel).toHaveBeenCalledOnce());
      manager.emit('session-forgotten', 'session-1');
      failFirst(new Error('offline'));
      await flush();
      await vi.advanceTimersByTimeAsync(60_000);
      await flush();
      expect(generateLabel).toHaveBeenCalledOnce();
      expect(sessionKeyedResidue(service, 'session-1')).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let an in-flight visual response resurrect a forgotten Session', async () => {
    let resolveVisual!: (value: {
      identityKey: string;
      dataUrl: string;
    }) => void;
    generateGoalVisual.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveVisual = resolve;
        })
    );
    service.setAccessToken('jwt');
    service.seedFromTask('session-1', 'Implement reopen closed tab');
    await vi.waitFor(() => expect(generateGoalVisual).toHaveBeenCalledOnce());
    manager.emit('session-forgotten', 'session-1');
    resolveVisual({ identityKey: 'late-goal', dataUrl: jpeg });
    await flush();
    expect(service.getGoalVisual('session-1')).toBeNull();
    expect(sessionKeyedResidue(service, 'session-1')).toEqual([]);
  });
});

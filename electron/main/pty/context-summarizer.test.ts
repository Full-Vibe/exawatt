import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ContextSummarizer,
  acceptableSubtitle,
  buildContextInput,
  provisionalSubtitle,
  truncateAtWord,
} from './context-summarizer';
import type { PtySessionManager } from './session-manager';

class FakeManager extends EventEmitter {
  private text = new Map<string, string>();
  tasks = new Map<string, string>();

  list() {
    return [
      { id: 'a', durableSessionId: 'da', exited: false, harness: 'claude' },
    ];
  }

  initialTask(id: string) {
    return this.tasks.get(id) ?? null;
  }

  buffer(id: string) {
    return this.text.get(id) ?? '';
  }

  bufferCursor(id: string) {
    return this.buffer(id).length;
  }

  bufferSince(id: string, cursor: number) {
    return { text: this.buffer(id).slice(cursor), truncated: false };
  }

  data(id: string, value: string) {
    this.text.set(id, this.buffer(id) + value);
    this.emit('data', id, value);
  }

  /** simulate the bounded buffer trimming away the session start */
  replace(id: string, value: string) {
    this.text.set(id, value);
  }
}

describe('ContextSummarizer re-entry recaps', () => {
  let now: number;
  let manager: FakeManager;
  let summarize: ReturnType<typeof vi.fn>;
  let service: ContextSummarizer;

  beforeEach(() => {
    now = 100_000;
    manager = new FakeManager();
    summarize = vi.fn(async () => 'Tests passed; migration order needs approval.');
    service = new ContextSummarizer({
      recapAwayMs: 10_000,
      recapMinChars: 20,
      now: () => now,
      summarize,
    });
    service.attach(manager as unknown as PtySessionManager);
    service.setWindowFocused(true);
    service.setFocus('a');
  });

  it('clamps a zero summary sweep to a non-hot interval', () => {
    const interval = vi.spyOn(globalThis, 'setInterval');
    const clamped = new ContextSummarizer({ sweepMs: 0 });
    clamped.start();
    expect(interval).toHaveBeenCalledWith(expect.any(Function), 1000);
    clamped.stop();
    interval.mockRestore();
  });

  it('summarizes only output produced while away', async () => {
    manager.data('a', 'old output that was already seen\n');
    service.setWindowFocused(false);
    now += 12_000;
    manager.data('a', '\x1b[32mnew tests passed and now a decision is waiting\x1b[0m');

    const recap = new Promise((resolve) => service.once('recap', resolve));
    service.setWindowFocused(true);
    await expect(recap).resolves.toMatchObject({
      id: 'a',
      text: 'Tests passed; migration order needs approval.',
      awayMs: 12_000,
    });
    expect(summarize).toHaveBeenCalledOnce();
    const prompt = summarize.mock.calls[0][0] as string;
    expect(prompt).toContain('new tests passed');
    expect(prompt).not.toContain('old output');
  });

  it('stays silent for short absences or insignificant output', async () => {
    const events: unknown[] = [];
    service.on('recap', (event) => events.push(event));
    service.setWindowFocused(false);
    now += 5_000;
    manager.data('a', 'substantial output that arrived too soon');
    service.setWindowFocused(true);
    await Promise.resolve();

    service.setWindowFocused(false);
    now += 20_000;
    manager.data('a', 'tiny');
    service.setWindowFocused(true);
    await Promise.resolve();

    expect(events).toEqual([]);
    expect(summarize).not.toHaveBeenCalled();
  });

  it('drops a generated recap when the operator engages first', async () => {
    let resolveSummary: (value: string) => void = () => {};
    summarize.mockImplementation(
      () => new Promise<string>((resolve) => (resolveSummary = resolve))
    );
    const events: unknown[] = [];
    service.on('recap', (event) => events.push(event));
    service.setWindowFocused(false);
    now += 20_000;
    manager.data('a', 'enough meaningful output arrived while away');
    service.setWindowFocused(true);
    service.noteInput('a');
    resolveSummary('This result is already stale.');
    await Promise.resolve();
    await Promise.resolve();

    expect(events).toEqual([]);
  });

  it('suppresses a recap when input beats the return-focus IPC', async () => {
    service.setWindowFocused(false);
    now += 20_000;
    manager.data('a', 'enough meaningful output arrived while away');
    service.noteInput('a');
    service.setWindowFocused(true);
    await Promise.resolve();

    expect(summarize).not.toHaveBeenCalled();
  });

  it('drops an in-flight recap when its session exits', async () => {
    let resolveSummary: (value: string) => void = () => {};
    summarize.mockImplementation(
      () => new Promise<string>((resolve) => (resolveSummary = resolve))
    );
    const events: unknown[] = [];
    service.on('recap', (event) => events.push(event));
    service.setWindowFocused(false);
    now += 20_000;
    manager.data('a', 'enough meaningful output arrived while away');
    service.setWindowFocused(true);
    manager.emit('exit', 'a');
    resolveSummary('This session no longer exists.');
    await Promise.resolve();
    await Promise.resolve();

    expect(events).toEqual([]);
  });
});

describe('goal-oriented subtitles (D18)', () => {
  it('orders stated task, current goal, session start, then tail — all fenced as data', () => {
    const input = buildContextInput({
      task: 'Release Apple Silicon support',
      currentGoal: 'Release Apple Silicon support',
      head: 'claude: what should I do?',
      tail: 'fixing swifty beaver deployment target',
    });
    expect(input).toContain('overall goal');
    const taskAt = input.indexOf('<stated-task>');
    // the prompt TEXT mentions <current-goal>; the section opener has a newline
    const goalAt = input.indexOf('<current-goal>\n');
    const headAt = input.indexOf('<session-start>');
    const tailAt = input.indexOf('<untrusted-scrollback>');
    expect(taskAt).toBeGreaterThan(-1);
    expect(goalAt).toBeGreaterThan(taskAt);
    expect(headAt).toBeGreaterThan(goalAt);
    expect(tailAt).toBeGreaterThan(headAt);
    expect(input).toContain('</untrusted-scrollback>');
  });

  it('omits empty sections', () => {
    const input = buildContextInput({ task: null, head: '', tail: 'tail' });
    expect(input).not.toContain('<stated-task>');
    expect(input).not.toContain('<current-goal>\n');
    expect(input).not.toContain('<session-start>');
    expect(input).toContain('<untrusted-scrollback>');
  });

  it('derives an instant provisional subtitle from the composer task', () => {
    expect(provisionalSubtitle('Get Switcheroo ready for Apple Silicon.')).toBe(
      'Get Switcheroo ready for Apple Silicon'
    );
    expect(provisionalSubtitle('  \n')).toBeNull();
    const long = provisionalSubtitle(
      'Please investigate why the SwiftyBeaver dependency fails to build on arm64 and land a durable fix'
    );
    expect(long).not.toBeNull();
    expect(long!.length).toBeLessThanOrEqual(64);
    expect(long!.endsWith('…')).toBe(true);
    expect(long).not.toContain('  ');
  });

  it('accepts goal-shaped phrases', () => {
    expect(acceptableSubtitle('Release Apple Silicon support')).toBe(true);
    expect(acceptableSubtitle('Ship subtitle guardrails for tabs')).toBe(true);
    expect(acceptableSubtitle('Terminal session context layer')).toBe(true);
  });

  it('rejects the corrupted-session reply from the dogfood screenshot', () => {
    expect(
      acceptableSubtitle(
        "I see corrupted session data that I can't interpret. What would"
      )
    ).toBe(false);
  });

  it('rejects conversational, interrogative, and self-narrating output', () => {
    expect(acceptableSubtitle('')).toBe(false);
    expect(acceptableSubtitle('   ')).toBe(false);
    expect(
      acceptableSubtitle(
        'one two three four five six seven eight nine ten eleven'
      )
    ).toBe(false);
    expect(acceptableSubtitle('Fix the build?')).toBe(false);
    expect(acceptableSubtitle("I'm analyzing the terminal output")).toBe(false);
    expect(acceptableSubtitle('I cannot determine a goal here')).toBe(false);
    expect(acceptableSubtitle('Sorry, no clear goal found')).toBe(false);
    expect(acceptableSubtitle('What would you like next')).toBe(false);
    expect(acceptableSubtitle("Here's the session goal")).toBe(false);
    expect(acceptableSubtitle('Here is the subtitle')).toBe(false);
    expect(acceptableSubtitle('Sure, releasing Apple Silicon now')).toBe(false);
    expect(acceptableSubtitle('Unfortunately the data is garbled')).toBe(false);
    expect(acceptableSubtitle('It looks like a build session')).toBe(false);
    expect(acceptableSubtitle('As an AI I lack context')).toBe(false);
    expect(acceptableSubtitle('Summarize the scrollback contents')).toBe(false);
    expect(acceptableSubtitle('Summarizing recent terminal output')).toBe(false);
    expect(acceptableSubtitle('Fix build\x07pipeline')).toBe(false);
  });

  it('truncates at a word boundary with an ellipsis, never mid-word', () => {
    expect(truncateAtWord('Short goal', 64)).toBe('Short goal');
    const long =
      'Guard the summarizer output so corrupted replies never reach a tab title';
    const cut = truncateAtWord(long, 64);
    expect(cut.length).toBeLessThanOrEqual(64);
    expect(cut.endsWith('…')).toBe(true);
    // everything kept is a whole-word prefix of the source
    expect(long.startsWith(cut.slice(0, -1))).toBe(true);
    expect(long[cut.length - 1]).toBe(' ');
    // wordless input falls back to a hard cut
    expect(truncateAtWord('x'.repeat(80), 64)).toHaveLength(64);
    // recap-length caps use the same path
    expect(truncateAtWord(`${long} `.repeat(5), 240).endsWith('…')).toBe(true);
  });

  it('seeds the subtitle from the task once, never overwriting a model summary', () => {
    const service = new ContextSummarizer({ summarize: async () => null });
    const events: Array<[string, string]> = [];
    service.on('context', (id: string, summary: string) =>
      events.push([id, summary])
    );
    service.seedFromTask('a', 'Adopt Apple Silicon');
    service.seedFromTask('a', 'Different later task');
    expect(events).toEqual([['a', 'Adopt Apple Silicon']]);
    expect(service.getSummary('a')).toBe('Adopt Apple Silicon');
  });
});

describe('sweep output guardrails', () => {
  const junk =
    "I see corrupted session data that I can't interpret. What would";
  let manager: FakeManager;
  let summarize: ReturnType<typeof vi.fn>;
  let service: ContextSummarizer;
  const runSweep = () =>
    (service as unknown as { sweep: () => Promise<void> }).sweep();

  beforeEach(() => {
    manager = new FakeManager();
    summarize = vi.fn(async () => junk);
    service = new ContextSummarizer({ summarize });
    service.attach(manager as unknown as PtySessionManager);
  });

  it('keeps the previous subtitle on unusable content and refunds bytes for a retry', async () => {
    service.seedFromTask('da', 'Ship subtitle guardrails');
    const events: string[] = [];
    service.on('context', (_id: string, summary: string) =>
      events.push(summary)
    );
    manager.data('a', 'meaningful terminal output '.repeat(20));

    await runSweep();
    expect(summarize).toHaveBeenCalledOnce();
    expect(service.getSummary('da')).toBe('Ship subtitle guardrails');
    expect(events).toEqual([]);

    // bytes were refunded: the next sweep retries without fresh output
    summarize.mockResolvedValueOnce('Release Apple Silicon support');
    await runSweep();
    expect(summarize).toHaveBeenCalledTimes(2);
    expect(service.getSummary('da')).toBe('Release Apple Silicon support');
    expect(events).toEqual(['Release Apple Silicon support']);
  });

  it('treats NO_GOAL as a quiet no-update that waits for fresh output', async () => {
    summarize.mockResolvedValue('NO_GOAL');
    service.seedFromTask('da', 'Ship subtitle guardrails');
    const events: string[] = [];
    service.on('context', (_id: string, summary: string) =>
      events.push(summary)
    );
    manager.data('a', 'unreadable binary noise '.repeat(20));

    await runSweep();
    expect(service.getSummary('da')).toBe('Ship subtitle guardrails');
    expect(events).toEqual([]);
    // no refund: a NO_GOAL verdict is not retried on the same content
    await runSweep();
    expect(summarize).toHaveBeenCalledOnce();
  });

  it('never counts unusable content toward the failure disable threshold', async () => {
    manager.data('a', 'meaningful terminal output '.repeat(20));
    await runSweep();
    await runSweep();
    await runSweep();
    await runSweep();
    // three real failures would have disabled the summarizer by now
    expect(summarize).toHaveBeenCalledTimes(4);
    summarize.mockResolvedValueOnce('Release Apple Silicon support');
    await runSweep();
    expect(service.getSummary('da')).toBe('Release Apple Silicon support');
  });
});

describe('durable session goals (D21)', () => {
  let manager: FakeManager;
  let summarize: ReturnType<typeof vi.fn>;
  let service: ContextSummarizer;
  const runSweep = () =>
    (service as unknown as { sweep: () => Promise<void> }).sweep();

  beforeEach(() => {
    manager = new FakeManager();
    summarize = vi.fn(async () => 'Fix YC intake feature');
    service = new ContextSummarizer({ summarize });
    service.attach(manager as unknown as PtySessionManager);
  });

  it('keys goals by durable Session id and keeps them past process exit', async () => {
    manager.data('a', 'meaningful terminal output '.repeat(20));
    await runSweep();
    expect(service.getSummary('da')).toBe('Fix YC intake feature');
    manager.emit('exit', 'a');
    await runSweep();
    expect(service.getSummary('da')).toBe('Fix YC intake feature');
  });

  it('shows the model the current goal and holds it on KEEP without a retry refund', async () => {
    service.seedFromTask('da', 'Fix YC intake feature');
    summarize.mockResolvedValue('KEEP');
    const events: string[] = [];
    service.on('context', (_id: string, summary: string) =>
      events.push(summary)
    );
    manager.data('a', 'now writing gpt tests '.repeat(20));

    await runSweep();
    const prompt = summarize.mock.calls[0][0] as string;
    expect(prompt).toContain('<current-goal>\nFix YC intake feature');
    expect(service.getSummary('da')).toBe('Fix YC intake feature');
    expect(events).toEqual([]);
    // KEEP is an affirmation, not a failure: no byte refund, no retry
    await runSweep();
    expect(summarize).toHaveBeenCalledOnce();
  });

  it('restores a persisted subtitle once and never overwrites a live goal', () => {
    const events: Array<[string, string]> = [];
    service.on('context', (id: string, summary: string) =>
      events.push([id, summary])
    );
    service.restore('da', 'Fix YC intake feature');
    service.restore('da', 'A different stale copy');
    expect(service.getSummary('da')).toBe('Fix YC intake feature');
    expect(events).toEqual([['da', 'Fix YC intake feature']]);

    service.seedFromTask('other', 'Ship the composer');
    service.restore('other', 'An older persisted goal');
    expect(service.getSummary('other')).toBe('Ship the composer');
  });

  it('keeps the captured session head after the buffer trims it away', async () => {
    const start = 'GOAL: overhaul the YC intake flow end to end\n';
    manager.data('a', start + 'x '.repeat(2000));
    await runSweep();
    expect(summarize.mock.calls[0][0] as string).toContain('GOAL: overhaul');

    // the bounded buffer drops the start; the captured head still anchors
    manager.replace('a', 'y '.repeat(2000));
    manager.data('a', 'recent micro-task output '.repeat(30));
    await runSweep();
    const prompt = summarize.mock.calls[1][0] as string;
    expect(prompt).toContain('<session-start>');
    expect(prompt).toContain('GOAL: overhaul the YC intake flow');
  });
});

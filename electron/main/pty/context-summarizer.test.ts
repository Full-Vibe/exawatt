import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ContextSummarizer,
  buildContextInput,
  provisionalSubtitle,
} from './context-summarizer';
import type { PtySessionManager } from './session-manager';

class FakeManager extends EventEmitter {
  private text = new Map<string, string>();
  tasks = new Map<string, string>();

  list() {
    return [{ id: 'a', exited: false, harness: 'claude' }];
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
  it('orders stated task, session start, then tail — all fenced as data', () => {
    const input = buildContextInput({
      task: 'Release Apple Silicon support',
      head: 'claude: what should I do?',
      tail: 'fixing swifty beaver deployment target',
    });
    expect(input).toContain('overall goal');
    const taskAt = input.indexOf('<stated-task>');
    const headAt = input.indexOf('<session-start>');
    const tailAt = input.indexOf('<untrusted-scrollback>');
    expect(taskAt).toBeGreaterThan(-1);
    expect(headAt).toBeGreaterThan(taskAt);
    expect(tailAt).toBeGreaterThan(headAt);
    expect(input).toContain('</untrusted-scrollback>');
  });

  it('omits empty sections', () => {
    const input = buildContextInput({ task: null, head: '', tail: 'tail' });
    expect(input).not.toContain('<stated-task>');
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

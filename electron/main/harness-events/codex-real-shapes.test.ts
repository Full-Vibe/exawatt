/**
 * Codex turn truth replayed from the installed app-server's own frames
 * (ENG-016 BUG-257 / BUG-264).
 *
 * Every frame below is shaped as codex-cli 0.160.1 answered a read-only probe
 * of the operator's real threads on 2026-10-05: `thread/turns/list` rows with
 * `itemsView: 'summary'`, `thread/items/list` rows that carry `turnId` beside
 * the item, `subAgentActivity` items whose newest kind for a finished child
 * is `completed`, `contextCompaction` items, the `agentMessage` a queued
 * question travels as (`delivery: 'async'`, `questions`), and the typed reply
 * envelope the TUI writes as a `userMessage`. The fixture that stood in for
 * this boundary before only ever emitted `started` and `interrupted`, so the
 * suite was green while the real shapes were refused (fakes more capable than
 * reality).
 *
 * Driven through the production pipeline: the real JSON-RPC client, the real
 * observer, the delegation and attention monitors wired by the same
 * `wireReportedTurnTruth` the app runs, read out through the render
 * derivation the tab strip uses. The assertions are about the light the
 * operator sees.
 */
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  PtyAttentionRecord,
  PtySessionRecord,
} from '@exawatt/core/desktop-bridge';
import { AttentionMonitor } from '../pty/attention-monitor';
import type { PtySessionManager } from '../pty/session-manager';
import {
  CodexAppServerClient,
  CodexDelegationObserver,
} from './codex-app-server';
import {
  DelegationMonitor,
  type DelegationReportSink,
} from './delegation-monitor';
import { DelegationObservations } from './delegation-observation';
import { wireReportedTurnTruth } from './turn-truth';
import {
  sessionDelegationBusy,
  sessionGlyphState,
  sessionReportedBlocked,
  sessionStatusLightState,
} from '../../../src/components/workspace/session-status';

const PTY = 'pty-codex';
const ROOT = '01a0f358-246d-78c1-84a5-0ecb7e0f52c1';
const CWD = '/Users/operator/Code/project';
/** Turns of the real thread, oldest to newest (UUIDv7 ids). */
const T_OLDER = '01a0f38e-08e5-74b0-a768-f17505b1d8d4';
const T_OLD = '01a0f3b2-cacb-75b0-859d-0e9adda316ad';
const T1 = '01a108aa-fe9a-7813-905d-348204f7f43c';
const T2 = '01a109f0-4d20-70e0-af32-1673b0545c68';
const CHILD_A = '01a0f393-7921-7ac3-82ef-a0500d33b075';
const CHILD_B = '01a0f3b3-2741-70b2-b955-3375544a445e';
/** A question the operator never answered in the typed envelope (turn T_OLDER). */
const OLD_UNANSWERED = 'call_PnwVa9WWHsah0G76zFyqSD7m';
const OLD_ANSWERED = 'call_fQI3ERQschvNEMvXGXYX2iIZ';
const QUESTION = 'call_adbuBBltfrkHCHc54vM1ZgND';
const QUESTION_2 = 'call_RAMlKkaeh47WHujA7QJz2PeT';

type Json = Record<string, unknown>;

const summary = (turnId: string) => [
  {
    type: 'userMessage',
    id: `${turnId.slice(0, 8)}-0169-7221-864e-aeb8718699ed`,
    clientId: '8115cd0a-f7c7-4f5d-9ca8-066828efbe8e',
    content: [{ type: 'text', text: 'Review the plan.', text_elements: [] }],
  },
  {
    type: 'agentMessage',
    id: 'msg_0beca1250b5b203d016ac2c08b4be887d0b9388f07f45cc013',
    text: 'Implemented and live.',
  },
];

function turnRow(
  id: string,
  status: 'completed' | 'interrupted' | 'inProgress',
  startedAt: number,
  completedAt: number | null
): Json {
  return {
    id,
    items: summary(id),
    itemsView: 'summary',
    status,
    error: null,
    startedAt,
    completedAt,
    durationMs: completedAt === null ? null : (completedAt - startedAt) * 1000,
  };
}

function childThread(id: string, agentPath: string, createdAt: number): Json {
  return {
    id,
    environments: null,
    extra: null,
    sessionId: id,
    forkedFromId: null,
    parentThreadId: ROOT,
    preview: '',
    ephemeral: false,
    section: null,
    sectionEnteredAt: null,
    projectId: null,
    historyMode: 'paginated',
    modelProvider: 'openai',
    model: 'gpt-6-astra',
    reasoningEffort: 'high',
    createdAt,
    updatedAt: createdAt,
    recencyAt: createdAt,
    status: { type: 'notLoaded' },
    path: `/Users/operator/.codex/sessions/2026/09/30/rollout-${id}.jsonl`,
    cwd: CWD,
    cliVersion: '0.158.0',
    originator: 'codex-tui',
    source: {
      subAgent: {
        thread_spawn: {
          parent_thread_id: ROOT,
          depth: 1,
          agent_path: agentPath,
          agent_nickname: 'Hooke',
          agent_role: null,
        },
      },
    },
    canAcceptDirectInput: null,
    threadSource: null,
    agentNickname: 'Hooke',
    agentRole: null,
    gitInfo: null,
    name: null,
    daybreakEnabled: null,
  };
}

const row = (turnId: string, item: Json, at: number) => ({
  turnId,
  item,
  startedAtMs: at,
  completedAtMs: at,
});
const reasoning = (n: number) => ({
  type: 'reasoning',
  id: `rs_0beca1250b5b203d016ac311b8c53487d0a489299ace393${n}`,
  summary: [],
  content: [],
});
const compaction = () => ({
  type: 'contextCompaction',
  id: '01a10a17-86dd-7be0-8135-72aa3ea136af',
});
const activity = (
  kind: 'interacted' | 'completed',
  childId: string,
  agentPath: string
) => ({
  type: 'subAgentActivity',
  id:
    kind === 'completed'
      ? `subagent-completed-01a109f0-b7b5-7760-a773-${childId.slice(-12)}`
      : `call_EnQrp75q1pIHzhQlvDGGb8Xd${childId.slice(-4)}`,
  kind,
  agentThreadId: childId,
  agentPath,
});
const asyncQuestion = (id: string) => ({
  type: 'agentMessage',
  id,
  text: 'Should the announcement go to likely Arabic speakers first?\n- Start with saved-language Arabic\n- Everyone, in English',
  phase: 'final',
  memoryCitation: null,
  delivery: 'async',
  questions: [
    {
      title: 'Should the announcement go to likely Arabic speakers first?',
      options: ['Start with saved-language Arabic', 'Everyone, in English'],
    },
  ],
});
const typedReply = (id: string, index: number) => ({
  type: 'userMessage',
  id: '01a0f36a-26bf-7cb1-8473-32b58c68f48a',
  clientId: 'a343c624-da72-4258-9cb3-dd196d125aac',
  content: [
    {
      type: 'text',
      text: `<send_user_message_question_reply>\n${JSON.stringify([
        {
          answer: 'Start with saved-language Arabic',
          question:
            'Should the announcement go to likely Arabic speakers first?',
          questionItemId: JSON.stringify([
            'request_user_input_async',
            id,
            index,
          ]),
        },
      ])}\n</send_user_message_question_reply>`,
      text_elements: [],
    },
  ],
});

/** The thread as the app-server would answer for it; mutated between polls. */
class World {
  clock = 1_791_168_000;
  rootTurns: Json[] = []; // newest first
  rootItems: Array<ReturnType<typeof row>> = []; // newest first
  children = new Map<string, { thread: Json; path: string; turns: Json[] }>();

  completedTurn(id: string, withItems: Json[] = []): void {
    const started = this.tick();
    for (const item of withItems)
      this.rootItems.unshift(row(id, item, started));
    this.rootTurns.unshift(turnRow(id, 'completed', started, this.tick()));
  }
  liveTurn(id: string): void {
    const started = this.tick();
    // A TUI-owned open turn reads interrupted with no completion timestamp
    // from a separate app-server (measured 0.160.0, 0.160.1).
    this.rootTurns.unshift(turnRow(id, 'interrupted', started, null));
    this.rootItems.unshift(row(id, reasoning(started), started * 1000));
  }
  complete(id: string): void {
    const turn = this.rootTurns.find(t => t.id === id)!;
    turn.status = 'completed';
    turn.completedAt = this.tick();
  }
  item(turnId: string, item: Json): void {
    this.rootItems.unshift(row(turnId, item, this.tick() * 1000));
  }
  spawn(turnId: string, childId: string, agentPath: string): void {
    const created = this.tick();
    this.children.set(childId, {
      thread: childThread(childId, agentPath, created),
      path: agentPath,
      turns: [
        turnRow(
          `${childId.slice(0, 8)}-c0ff-7ee0-8000-000000000001`,
          'interrupted',
          created,
          null
        ),
      ],
    });
    this.item(turnId, activity('interacted', childId, agentPath));
  }
  childDone(turnId: string, childId: string): void {
    const child = this.children.get(childId)!;
    child.turns[0].status = 'completed';
    child.turns[0].completedAt = this.tick();
    this.item(turnId, activity('completed', childId, child.path));
  }
  private tick(): number {
    this.clock += 7;
    return this.clock;
  }
}

/** A stdio app-server answering 0.160.1-shaped frames from the world. */
function fakeCodexAppServer(world: World): ChildProcessWithoutNullStreams {
  const process = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    killed: false,
    kill() {
      this.killed = true;
      return true;
    },
  });
  let buffer = '';
  const answer = (method: string, params: Json): Json => {
    if (method === 'initialize')
      return {
        userAgent:
          'exawatt-delegation/0.160.1 (Mac OS 26.6.2; arm64) Exawatt (exawatt-delegation; 1)',
        codexHome: '/Users/operator/.codex',
        platformFamily: 'unix',
        platformOs: 'macos',
      };
    if (method === 'thread/list') {
      expect(params.ancestorThreadId).toBe(ROOT);
      return {
        data: [...world.children.values()].map(child => child.thread),
        nextCursor: null,
      };
    }
    if (method === 'thread/turns/list') {
      const turns =
        params.threadId === ROOT
          ? world.rootTurns
          : (world.children.get(String(params.threadId))?.turns ?? []);
      return { data: turns.slice(0, Number(params.limit)), nextCursor: null };
    }
    if (method === 'thread/items/list') {
      expect(params.threadId).toBe(ROOT);
      return {
        data: world.rootItems.slice(0, Number(params.limit)),
        nextCursor: null,
      };
    }
    throw new Error(`unexpected method ${method}`);
  };
  process.stdin.on('data', bytes => {
    // Concurrent reads coalesce into one chunk; frames are newline-delimited.
    buffer += String(bytes);
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const request = JSON.parse(line);
      if (request.id === undefined) continue;
      process.stdout.write(
        `${JSON.stringify({ id: request.id, result: answer(request.method, request.params ?? {}) })}\n`
      );
    }
  });
  return process as unknown as ChildProcessWithoutNullStreams;
}

class FakeManager extends EventEmitter {
  sessions = [{ id: PTY, harness: 'codex', startedAt: 0, exited: false }];
  list() {
    return this.sessions.map(s => ({ ...s }));
  }
}

const session: PtySessionRecord = {
  id: PTY,
  durableSessionId: 'durable-codex',
  harness: 'codex',
  title: 'Codex',
  cwd: CWD,
  projectDir: CWD,
  projectName: 'project',
  cols: 120,
  rows: 40,
  startedAt: 1,
  exited: false,
  exitCode: null,
  lastDataAt: 1,
  harnessSessionId: ROOT,
};

function rig() {
  let clock = 1_791_227_000_000;
  const world = new World();
  const manager = new FakeManager();
  const delegation = new DelegationMonitor();
  const attention = new AttentionMonitor({
    quietMs: 4000,
    minBurstBytes: 600,
    spawnGraceMs: 0,
    now: () => clock,
  });
  attention.attach(manager as unknown as PtySessionManager);
  const alerts: PtyAttentionRecord[] = [];
  attention.on('alert', (_id, record) => alerts.push(record));
  wireReportedTurnTruth({
    attention,
    delegation,
    now: () => clock,
    harnessOf: () => 'codex',
  });
  attention.setWindowFocused(true);
  attention.setFocus('another-tab');
  const sink: DelegationReportSink = {
    report: (id, event) => delegation.report(id, event),
    reconcileReportedChildren: (id, children, completed) =>
      delegation.reconcileReportedChildren(id, children, completed),
    clearReportedChildren: id => delegation.clearReportedChildren(id),
  };
  const client = new CodexAppServerClient(async () =>
    fakeCodexAppServer(world)
  );
  const observer = new CodexDelegationObserver({
    clientFactory: () => client,
    sink,
    autoPoll: false,
    observations: new DelegationObservations(),
  });
  observer.observe(session);
  /** What the tab strip, the ⌘K row and exposé all render from. */
  const light = () => {
    const reported = delegation.getLive(PTY);
    return sessionStatusLightState({
      state: sessionGlyphState({
        working: attention.isWorking(PTY),
        agent: true,
        started: true,
        delegatedBusy: sessionDelegationBusy(reported),
        blocked: sessionReportedBlocked(reported),
        ownTurn: reported?.ownTurn,
      }),
      attention: attention.get(PTY),
    });
  };
  return {
    world,
    observer,
    delegation,
    attention,
    alerts,
    light,
    poll: () => observer.pollNow(),
    /** The TUI redrawing its "Working (4m 44s)" line, once a second. */
    redraw: (seconds: number) => {
      for (let s = 0; s < seconds; s += 1) {
        clock += 1000;
        manager.emit('data', PTY, 'x'.repeat(240));
        attention.sweepNow();
      }
    },
    silence: (ms: number) => {
      clock += ms;
      attention.sweepNow();
    },
    /** The operator presses Enter on a prompt. */
    engage: () => attention.noteEngaged(PTY),
  };
}

describe('Codex turn truth from 0.160.1 frames', () => {
  const rigs: ReturnType<typeof rig>[] = [];
  afterEach(() => {
    for (const r of rigs) r.observer.drop(PTY);
    rigs.length = 0;
  });
  const start = () => {
    const r = rig();
    rigs.push(r);
    return r;
  };

  it('never shows the finished glyph while the TUI reads Working or Compacting (BUG-257)', async () => {
    const r = start();
    r.world.completedTurn(T_OLD);
    await r.poll();
    expect(r.attention.get(PTY)).toBeNull();

    // The operator's prompt: the TUI-owned turn reads interrupted/null.
    r.engage();
    r.world.liveTurn(T1);
    await r.poll();
    r.redraw(2);
    expect(r.delegation.get(PTY)?.ownTurn).toBe('unknown');
    expect(r.light()).toBe('active');

    // Fan-out: two children, each a live TUI-owned thread.
    r.world.spawn(T1, CHILD_A, '/root/email_recovery');
    r.world.spawn(T1, CHILD_B, '/root/review_auth');
    await r.poll();
    r.redraw(3);
    expect(r.delegation.get(PTY)?.children.map(c => c.id)).toEqual([
      CHILD_A,
      CHILD_B,
    ]);
    expect(r.light()).toBe('active');

    // Child A finishes a step: its turn completes and the parent's activity
    // stream says `completed`. The parent is still working.
    r.world.childDone(T1, CHILD_A);
    await r.poll();
    r.redraw(2);
    expect(r.delegation.get(PTY)?.children.map(c => c.id)).toEqual([CHILD_B]);
    expect(r.attention.get(PTY)).toBeNull();
    expect(r.light()).toBe('active');

    // "Compacting context (28s)": a mid-turn state, not a boundary.
    r.world.item(T1, compaction());
    await r.poll();
    r.redraw(2);
    expect(r.attention.get(PTY)).toBeNull();
    expect(r.light()).toBe('active');

    // The last live child finishes while the parent works on. This is the
    // operator's three screenshots: before, the last child's end delivered a
    // "withheld result" for a parent whose own turn the source had never
    // reported, and the settled latch then ignored every byte of "Working".
    r.world.childDone(T1, CHILD_B);
    await r.poll();
    expect(r.delegation.get(PTY)?.children).toEqual([]);
    expect(r.attention.get(PTY)).toBeNull();
    r.redraw(5);
    expect(r.light()).toBe('active');
    expect(r.alerts).toEqual([]);

    // A long think with no bytes: unknown stays unknown, never a result.
    r.silence(30_000);
    expect(r.attention.get(PTY)).toBeNull();
    expect(r.light()).not.toBe('result');

    // Only the source's own completion is a result.
    r.world.complete(T1);
    await r.poll();
    expect(r.attention.get(PTY)?.kind).toBe('turn-end');
    expect(r.light()).toBe('result');
    expect(r.alerts.map(alert => alert.kind)).toEqual(['turn-end']);
  });

  it('raises a queued question as needs-you without ending the turn, and releases it with its turn (BUG-264)', async () => {
    const r = start();
    r.world.completedTurn(T_OLD);
    await r.poll();
    r.engage();
    r.world.liveTurn(T2);
    await r.poll();
    r.redraw(2);
    expect(r.light()).toBe('active');

    // "Queued follow-up inputs · 1 question · shift+← to answer" under a live
    // "Working (4m 59s)": waiting while working.
    r.world.item(T2, asyncQuestion(QUESTION));
    await r.poll();
    expect(r.delegation.getLive(PTY)).toMatchObject({
      ownTurn: 'unknown',
      blockedOn: 'question',
      request: 'working',
      requestId: `${QUESTION}:0`,
    });
    expect(r.attention.get(PTY)).toMatchObject({
      kind: 'blocked',
      request: 'working',
      requestId: `${QUESTION}:0`,
    });
    expect(r.light()).toBe('needs-you');
    // The amber marker and the bell are one transition (BUG-265): one alert,
    // and a repeated snapshot is not a second one.
    expect(r.alerts).toHaveLength(1);
    await r.poll();
    r.redraw(3);
    expect(r.alerts).toHaveLength(1);
    expect(r.light()).toBe('needs-you');
    // The Agent is still working underneath; focusing changes nothing.
    r.attention.setFocus(PTY);
    expect(r.light()).toBe('needs-you');
    r.attention.setFocus('another-tab');

    // The operator answers through the TUI: the typed envelope resolves
    // exactly this question.
    r.world.item(T2, typedReply(QUESTION, 0));
    await r.poll();
    expect(r.attention.get(PTY)).toBeNull();
    expect(r.light()).toBe('active');

    // A second question, then the turn completes before anyone answers: the
    // TUI clears its queue with the turn, so the question is gone and the
    // result is what remains.
    r.world.item(T2, asyncQuestion(QUESTION_2));
    await r.poll();
    expect(r.light()).toBe('needs-you');
    expect(r.alerts).toHaveLength(2);
    r.world.complete(T2);
    await r.poll();
    expect(r.delegation.getLive(PTY)).toBeNull();
    expect(r.attention.get(PTY)).toMatchObject({ kind: 'turn-end' });
    expect(r.attention.get(PTY)?.records ?? [r.attention.get(PTY)]).toEqual([
      expect.objectContaining({ kind: 'turn-end' }),
    ]);
    expect(r.light()).toBe('result');
  });

  it('attaching to a Session with unanswered questions in finished turns raises nothing (the three amber tabs)', async () => {
    // 2026-10-05: three Codex tabs lit amber at app start for questions asked
    // days earlier that the operator had moved past; the TUI had dropped
    // them with their turns.
    const r = start();
    r.world.completedTurn(T_OLDER, [asyncQuestion(OLD_UNANSWERED)]);
    r.world.completedTurn(T_OLD, [
      asyncQuestion(OLD_ANSWERED),
      typedReply(OLD_ANSWERED, 0),
    ]);
    await r.poll();
    await r.poll();
    expect(r.delegation.getLive(PTY)).toBeNull();
    expect(r.attention.get(PTY)).toBeNull();
    expect(r.alerts).toEqual([]);
    expect(r.light()).not.toBe('needs-you');
  });
});

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import type {
  RoadmapDeliveryCandidate,
  RoadmapDeliveryRead,
  RoadmapDeliveryTicket,
} from '@exawatt/core/desktop-bridge';

/**
 * Delivery queue reader for the roadmap lens (ENG-017 S16).
 *
 * `pnpm agent:land` keeps its state under `<git-common-dir>/exawatt-delivery/`
 * (ENG-022): one JSON file per ticket in `queue/`, and an append-only
 * `metrics.jsonl`. This module reads both and never writes: the queue is the
 * landing scripts' state, and the lens is a projection of it.
 *
 * Honesty: a repository without a readable queue is `unavailable`, which the
 * lens renders as nothing at all. Zero tickets in a readable queue is a
 * different claim and is reported as such.
 */

const execFileAsync = promisify(execFile);

/** Newest ticket files read per poll. The queue is FIFO, so every ticket
 *  still in flight is among the newest; everything older is history. */
export const TICKET_READ_BOUND = 64;
/** How far back a terminal ticket is still reported. The lens shows landed
 *  and failed state on items for a while after the fact; older history only
 *  costs git calls for subjects nobody will see. */
export const TERMINAL_HISTORY_MS = 3 * 60 * 60_000;
/** Bytes of `metrics.jsonl` read from the end: about a thousand events. */
export const METRICS_TAIL_BYTES = 256 * 1024;
/** A pre-admission floor that has recorded no check for this long is not
 *  running any more; the landing crashed or was abandoned. */
export const CANDIDATE_FRESH_MS = 10 * 60_000;

const TICKET_STATUSES = new Set<RoadmapDeliveryTicket['status']>([
  'queued',
  'integrating',
  'integrated',
  'failed',
]);

/** One commit range whose oldest subject names the owning item. A candidate
 *  has no recorded base; its range starts at `origin/master`. */
export interface SubjectRange {
  base: string | null;
  sha: string;
}

interface DeliveryStateSource {
  stateRoot: string;
  subjectFor: (range: SubjectRange) => Promise<string | null>;
  now?: () => number;
}

interface MetricsEvent {
  type: string;
  at: number;
  ticketId?: string;
  candidateSha?: string;
  phase?: string;
  id?: string;
  status?: string;
  completedAt?: string;
}

interface RawCheck {
  id?: unknown;
  phase?: unknown;
  completedAt?: unknown;
}

interface RawTicket {
  id: string;
  number: number;
  status: RoadmapDeliveryTicket['status'];
  branch: string;
  lane: string;
  baseSha: string | null;
  candidateSha: string;
  attemptSha: string | null;
  checks: RawCheck[];
  hold: unknown;
  admittedAt: number;
  headAt: number | null;
  terminalAt: number | null;
  integratedSha: string | null;
  failureReason: string | null;
}

function millis(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseTicket(raw: unknown): RawTicket | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const id = text(record.id);
  const branch = text(record.branch);
  const candidateSha = text(record.candidateSha);
  const admittedAt = millis(record.admittedAt);
  const status = record.status;
  if (
    !id ||
    !branch ||
    !candidateSha ||
    admittedAt === null ||
    !Number.isInteger(record.number) ||
    typeof status !== 'string' ||
    !TICKET_STATUSES.has(status as RoadmapDeliveryTicket['status'])
  ) {
    return null;
  }
  const result =
    record.result && typeof record.result === 'object'
      ? (record.result as Record<string, unknown>)
      : {};
  return {
    id,
    number: record.number as number,
    status: status as RoadmapDeliveryTicket['status'],
    branch,
    lane: text(record.lane) ?? 'worktree',
    baseSha: text(record.baseSha),
    candidateSha,
    attemptSha: text(record.attemptSha),
    checks: Array.isArray(record.checks) ? (record.checks as RawCheck[]) : [],
    hold: record.hold,
    admittedAt,
    headAt: millis(record.headAt),
    terminalAt: millis(record.terminalAt),
    integratedSha: text(result.integratedSha),
    failureReason: text(result.reason),
  };
}

function parseEvent(line: string): MetricsEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  const type = text(record.type);
  const at = millis(record.at);
  if (!type || at === null) return null;
  return {
    type,
    at,
    ticketId: text(record.ticketId) ?? undefined,
    candidateSha: text(record.candidateSha) ?? undefined,
    phase: text(record.phase) ?? undefined,
    id: text(record.id) ?? undefined,
    status: text(record.status) ?? undefined,
    completedAt: text(record.completedAt) ?? undefined,
  };
}

/** The tail of `metrics.jsonl` as events, oldest first. `at` is null when the
 *  file could not be read; an empty file reads as an empty tail with a time. */
async function readMetricsTail(
  stateRoot: string
): Promise<{ events: MetricsEvent[]; at: number | null }> {
  const metricsPath = path.join(stateRoot, 'metrics.jsonl');
  let handle: fs.promises.FileHandle;
  try {
    handle = await fs.promises.open(metricsPath, 'r');
  } catch {
    return { events: [], at: null };
  }
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - METRICS_TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const lines = buffer.toString('utf8').split('\n');
    // a tail that starts mid-file begins inside some line; drop that fragment
    if (start > 0) lines.shift();
    const events = lines
      .filter(line => line.length > 0)
      .map(parseEvent)
      .filter((event): event is MetricsEvent => event !== null);
    const newest = events.reduce((max, event) => Math.max(max, event.at), 0);
    return { events, at: newest > 0 ? newest : null };
  } catch {
    return { events: [], at: null };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** A rebase-phase check the metrics tail reports for this ticket and the
 *  ticket itself has not recorded is a floor still running at the head. */
function ticketIsChecking(ticket: RawTicket, events: MetricsEvent[]): boolean {
  if (ticket.status !== 'integrating') return false;
  const recorded = new Set(
    ticket.checks
      .filter(check => check.phase === 'rebase')
      .map(check => `${String(check.id)}@${String(check.completedAt)}`)
  );
  return events.some(
    event =>
      event.type === 'floor_check' &&
      event.ticketId === ticket.id &&
      event.phase === 'rebase' &&
      !recorded.has(`${event.id}@${event.completedAt}`)
  );
}

/** Pre-admission floors: candidate-phase checks for a commit no ticket names.
 *  A failed check ends that landing; a conflict probe does too; silence for
 *  `CANDIDATE_FRESH_MS` means the floor is no longer running. */
function liveCandidates(
  events: MetricsEvent[],
  tickets: RawTicket[],
  now: number
): Array<{ candidateSha: string; at: number; checksPassed: number }> {
  const ticketed = new Set<string>();
  for (const ticket of tickets) {
    ticketed.add(ticket.candidateSha);
    if (ticket.attemptSha) ticketed.add(ticket.attemptSha);
  }
  const bySha = new Map<
    string,
    { at: number; checksPassed: number; ended: boolean }
  >();
  for (const event of events) {
    if (!event.candidateSha || event.ticketId) continue;
    if (event.phase !== 'candidate') continue;
    if (event.type !== 'floor_check' && event.type !== 'probe_conflict')
      continue;
    const entry = bySha.get(event.candidateSha) ?? {
      at: 0,
      checksPassed: 0,
      ended: false,
    };
    entry.at = Math.max(entry.at, event.at);
    if (event.type === 'probe_conflict' || event.status === 'failed') {
      entry.ended = true;
    } else if (event.status === 'passed' || event.status === 'flaked') {
      entry.checksPassed += 1;
    }
    bySha.set(event.candidateSha, entry);
  }
  const live: Array<{
    candidateSha: string;
    at: number;
    checksPassed: number;
  }> = [];
  for (const [candidateSha, entry] of bySha) {
    if (entry.ended || ticketed.has(candidateSha)) continue;
    if (now - entry.at > CANDIDATE_FRESH_MS) continue;
    live.push({ candidateSha, at: entry.at, checksPassed: entry.checksPassed });
  }
  return live.sort((left, right) => right.at - left.at);
}

/**
 * Read one repository's delivery queue. Pure over the filesystem apart from
 * `subjectFor`, which the caller supplies, so the parsing of real queue and
 * metrics shapes is testable without git.
 */
export async function readDeliveryState(
  source: DeliveryStateSource
): Promise<RoadmapDeliveryRead> {
  const now = source.now ? source.now() : Date.now();
  const queueDir = path.join(source.stateRoot, 'queue');
  let names: string[];
  try {
    names = await fs.promises.readdir(queueDir);
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code: unknown }).code)
        : 'unreadable';
    return {
      status: 'unavailable',
      reason: `delivery queue not readable (${code}) at ${queueDir}`,
    };
  }
  const newest = names
    .filter(name => name.endsWith('.json'))
    .sort((left, right) => right.localeCompare(left))
    .slice(0, TICKET_READ_BOUND);

  let unreadableTickets = 0;
  const raw: RawTicket[] = [];
  for (const name of newest) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        await fs.promises.readFile(path.join(queueDir, name), 'utf8')
      );
    } catch {
      unreadableTickets += 1;
      continue;
    }
    const ticket = parseTicket(parsed);
    if (!ticket) {
      unreadableTickets += 1;
      continue;
    }
    raw.push(ticket);
  }
  raw.sort((left, right) => left.number - right.number);

  const metrics = await readMetricsTail(source.stateRoot);

  // Report in-flight tickets, recent terminal ones, and always the newest
  // landing so the lens can say when something last reached master.
  const newestIntegrated = [...raw]
    .reverse()
    .find(ticket => ticket.status === 'integrated');
  const reported = raw.filter(
    ticket =>
      ticket.status === 'queued' ||
      ticket.status === 'integrating' ||
      ticket === newestIntegrated ||
      (ticket.terminalAt !== null &&
        now - ticket.terminalAt <= TERMINAL_HISTORY_MS)
  );
  const candidates = liveCandidates(metrics.events, raw, now);

  const subjects = await Promise.all([
    ...reported.map(ticket =>
      source.subjectFor({ base: ticket.baseSha, sha: ticket.candidateSha })
    ),
    ...candidates.map(candidate =>
      source.subjectFor({ base: null, sha: candidate.candidateSha })
    ),
  ]);

  const tickets: RoadmapDeliveryTicket[] = reported.map((ticket, index) => ({
    id: ticket.id,
    number: ticket.number,
    status: ticket.status,
    branch: ticket.branch,
    lane: ticket.lane,
    subject: subjects[index],
    admittedAt: ticket.admittedAt,
    headAt: ticket.headAt,
    terminalAt: ticket.terminalAt,
    integratedSha: ticket.integratedSha,
    failureReason: ticket.failureReason,
    checking: ticketIsChecking(ticket, metrics.events),
    held: Boolean(ticket.hold && typeof ticket.hold === 'object'),
  }));
  const reportedCandidates: RoadmapDeliveryCandidate[] = candidates.map(
    (candidate, index) => ({
      candidateSha: candidate.candidateSha,
      subject: subjects[reported.length + index],
      at: candidate.at,
      checksPassed: candidate.checksPassed,
    })
  );

  return {
    status: 'ok',
    readAt: now,
    tickets,
    candidates: reportedCandidates,
    unreadableTickets,
    metricsAt: metrics.at,
  };
}

function assertValidProjectDir(projectDir: string): void {
  if (
    !projectDir ||
    projectDir.includes('\0') ||
    projectDir.length > 4096 ||
    !path.isAbsolute(projectDir)
  ) {
    throw new Error('Invalid Project directory');
  }
}

async function git(projectDir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', projectDir, ...args], {
    timeout: 5000,
    maxBuffer: 512 * 1024,
  });
  return stdout;
}

/** Commits are immutable, so a resolved subject never changes; a failed
 *  resolution is not cached so a transient git error retries next poll. */
const subjectCache = new Map<string, string>();
const SUBJECT_CACHE_BOUND = 512;

function rememberSubject(key: string, subject: string): void {
  if (subjectCache.size >= SUBJECT_CACHE_BOUND) {
    const oldest = subjectCache.keys().next().value;
    if (oldest !== undefined) subjectCache.delete(oldest);
  }
  subjectCache.set(key, subject);
}

async function gitSubjectFor(
  projectDir: string,
  range: SubjectRange
): Promise<string | null> {
  const base = range.base ?? 'origin/master';
  const key = `${base}..${range.sha}`;
  const cached = subjectCache.get(key);
  if (cached !== undefined) return cached;
  try {
    const listed = await git(projectDir, [
      'log',
      '--reverse',
      '--format=%s',
      `${base}..${range.sha}`,
    ]);
    let subject = listed.split('\n').find(line => line.length > 0) ?? null;
    if (subject === null) {
      // the range is empty when the base already contains the commit; the
      // tip's own subject is then the best remaining evidence
      subject =
        (await git(projectDir, ['log', '-1', '--format=%s', range.sha]))
          .split('\n')
          .find(line => line.length > 0) ?? null;
    }
    if (subject !== null) rememberSubject(key, subject);
    return subject;
  } catch {
    return null;
  }
}

/** The Project's delivery queue, resolved through its repository's common
 *  Git directory (worktrees share it, so a landing from any sibling checkout
 *  is visible on the Project). */
export async function readRoadmapLandings(
  projectDir: string
): Promise<RoadmapDeliveryRead> {
  assertValidProjectDir(projectDir);
  let commonDir: string;
  try {
    commonDir = (
      await git(projectDir, [
        'rev-parse',
        '--path-format=absolute',
        '--git-common-dir',
      ])
    ).trim();
  } catch {
    return { status: 'unavailable', reason: 'not a git repository' };
  }
  if (!commonDir) {
    return { status: 'unavailable', reason: 'no common git directory' };
  }
  return readDeliveryState({
    stateRoot: path.join(commonDir, 'exawatt-delivery'),
    subjectFor: range => gitSubjectFor(projectDir, range),
  });
}

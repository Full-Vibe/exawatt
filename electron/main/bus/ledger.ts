/**
 * The bus ledger (ENG-029 C4, decision `0052` §5): every message, both ends,
 * the text, the time and every delivery change, per Project.
 *
 * `BusStore` is the seam the operator asked for ("we may in fact just plug in
 * some other ... system"): the bus core only appends and reads through it.
 * The first implementation is machine-local JSONL, `<root>/<key>.jsonl` per
 * Project, append-only: one message line when it is logged, naming every
 * recipient with its first delivery, and a delivery line whenever one
 * recipient's delivery moves.
 *
 * Line versions: `v: 2` is a message to recipients (`to` a list, one
 * delivery each; a delivery line names its recipient). `v: 1` lines, from
 * before a message could name several recipients, are still read: a v1
 * message is a message to its one recipient, and a v1 delivery line moves
 * that recipient. They are never rewritten, so a downgrade reads the old
 * messages it wrote.
 *
 * Size class (decision `0039`): at most `BUS_LEDGER_BOUNDS.messages` messages
 * and `BUS_LEDGER_BOUNDS.bytes` per Project, enforced on the write path. Over
 * either bound the file is rewritten atomically with the newest whole
 * messages (and only their delivery lines) that fit below the low-water mark;
 * a record is never cut mid-line. A damaged line makes the read fail with its
 * line number (BUG-125: a damaged ledger is never an empty one), and a
 * damaged file is never rewritten, so nothing it holds is lost to pruning.
 *
 * One damage is expected, not a fault: a crash mid-append leaves a torn
 * FINAL line with no newline after it. A read takes the whole lines before
 * it; the next write moves the torn bytes to `<file>.torn` (kept, never
 * deleted) and ends the file at its last newline before appending, so a
 * later line is never written onto the torn one. Only an unterminated last
 * line is read as torn: a bad line anywhere else still fails the read.
 */
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  isBusDeliveryState,
  type BusEndpoint,
  type BusLedgerRead,
  type DeliveryEvent,
  type MessageRecord,
} from '@exawatt/core';

export interface BusStore {
  /** Log a newly accepted message with its first delivery event. */
  append(record: MessageRecord): Promise<void>;
  /** Log a change in one recipient's delivery of a message already
   *  logged. */
  appendDelivery(
    projectId: string,
    id: string,
    recipientSessionId: string,
    event: DeliveryEvent
  ): Promise<void>;
  read(projectId: string): Promise<BusLedgerRead>;
}

/** The ledger's size class: count and bytes per Project, and the low-water
 *  mark a prune rewrites down to so pruning is not paid on every append. */
const BUS_LEDGER_BOUNDS = {
  messages: 2_000,
  bytes: 4 * 1024 * 1024,
  lowWater: 0.75,
} as const;

/** How every message line begins, in either version
 *  (`JSON.stringify` keeps key order). */
const MESSAGE_LINE = /^\{"v":[12],"type":"message"/;

/** A message as a v1 line held it: one recipient, one delivery. */
interface MessageRecordV1 extends Omit<MessageRecord, 'to' | 'deliveries'> {
  to: BusEndpoint;
  delivery: DeliveryEvent;
  history: DeliveryEvent[];
}

type LedgerLine =
  | { v: 2; type: 'message'; record: MessageRecord }
  | { v: 2; type: 'delivery'; id: string; to: string; event: DeliveryEvent };

/** What a line means once read, whichever version wrote it. A v1 delivery
 *  line names no recipient: it moves the message's only one. */
type ReadLine =
  | { type: 'message'; record: MessageRecord }
  | { type: 'delivery'; id: string; to: string | null; event: DeliveryEvent };

function isEvent(value: unknown): value is DeliveryEvent {
  const event = value as DeliveryEvent | null;
  return (
    !!event &&
    typeof event === 'object' &&
    isBusDeliveryState(event.state) &&
    typeof event.adapter === 'string' &&
    typeof event.at === 'number'
  );
}

function isEndpoint(value: unknown): value is BusEndpoint {
  const endpoint = value as BusEndpoint | null;
  return (
    !!endpoint &&
    typeof endpoint === 'object' &&
    typeof endpoint.sessionId === 'string' &&
    typeof endpoint.name === 'string' &&
    typeof endpoint.harness === 'string'
  );
}

function isEnvelope(record: Partial<MessageRecord> | undefined): boolean {
  return (
    !!record &&
    typeof record.id === 'string' &&
    typeof record.projectId === 'string' &&
    typeof record.text === 'string' &&
    typeof record.at === 'number' &&
    !!record.from
  );
}

/** A v1 message, read as the message to one recipient it was. */
function fromV1(record: MessageRecordV1 | undefined): MessageRecord | null {
  if (
    !record ||
    !isEnvelope(record as unknown as Partial<MessageRecord>) ||
    !isEndpoint(record.to) ||
    !isEvent(record.delivery) ||
    !Array.isArray(record.history) ||
    !record.history.every(isEvent)
  )
    return null;
  const { to, delivery, history, ...envelope } = record;
  return {
    ...envelope,
    to: [to],
    deliveries: [{ sessionId: to.sessionId, delivery, history }],
  };
}

function isRecordV2(record: MessageRecord | undefined): boolean {
  return (
    !!record &&
    isEnvelope(record) &&
    Array.isArray(record.to) &&
    record.to.length > 0 &&
    record.to.every(isEndpoint) &&
    Array.isArray(record.deliveries) &&
    record.deliveries.length === record.to.length &&
    record.deliveries.every(
      (entry, index) =>
        !!entry &&
        entry.sessionId === record.to[index].sessionId &&
        isEvent(entry.delivery) &&
        Array.isArray(entry.history) &&
        entry.history.every(isEvent)
    )
  );
}

function parseLine(text: string): ReadLine | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const line = value as {
    v?: unknown;
    type?: unknown;
    record?: unknown;
    id?: unknown;
    to?: unknown;
    event?: unknown;
  } | null;
  if (!line || typeof line !== 'object') return null;
  if (line.v !== 1 && line.v !== 2) return null;
  if (line.type === 'message') {
    if (line.v === 1) {
      const record = fromV1(line.record as MessageRecordV1 | undefined);
      return record ? { type: 'message', record } : null;
    }
    const record = line.record as MessageRecord | undefined;
    return record && isRecordV2(record) ? { type: 'message', record } : null;
  }
  if (line.type === 'delivery') {
    if (typeof line.id !== 'string' || !isEvent(line.event)) return null;
    if (line.v === 1)
      return { type: 'delivery', id: line.id, to: null, event: line.event };
    return typeof line.to === 'string'
      ? { type: 'delivery', id: line.id, to: line.to, event: line.event }
      : null;
  }
  return null;
}

type Folded =
  | {
      ok: true;
      records: MessageRecord[];
      /** each message's own lines, so a prune keeps them together */
      lines: Map<string, string[]>;
    }
  | { ok: false; reason: string };

/** Fold a ledger's text into records, oldest first. An unterminated last
 *  line that does not parse is a torn append and is left out; every other
 *  bad line fails the fold. */
function fold(text: string): Folded {
  const records = new Map<string, MessageRecord>();
  const lines = new Map<string, string[]>();
  const rows = text.split('\n');
  for (let index = 0; index < rows.length; index += 1) {
    const raw = rows[index];
    if (!raw.trim()) continue;
    const line = parseLine(raw);
    if (!line && index === rows.length - 1) continue;
    if (!line) {
      return {
        ok: false,
        reason: `The message log for this Project is damaged at line ${index + 1}; Exawatt left it as it is`,
      };
    }
    if (line.type === 'message') {
      records.set(line.record.id, {
        ...line.record,
        deliveries: line.record.deliveries.map(entry => ({
          ...entry,
          history: [...entry.history],
        })),
      });
      lines.set(line.record.id, [raw]);
      continue;
    }
    const record = records.get(line.id);
    // A delivery for a message pruned before it: history that is gone.
    if (!record) continue;
    const entry =
      line.to === null
        ? record.deliveries.length === 1
          ? record.deliveries[0]
          : undefined
        : record.deliveries.find(item => item.sessionId === line.to);
    if (!entry) {
      return {
        ok: false,
        reason: `The message log for this Project is damaged at line ${index + 1}; Exawatt left it as it is`,
      };
    }
    entry.history.push(line.event);
    entry.delivery = line.event;
    lines.get(line.id)!.push(raw);
  }
  return {
    ok: true,
    records: [...records.values()].sort((a, b) => a.at - b.at),
    lines,
  };
}

export class JsonlBusStore implements BusStore {
  /** One write chain per file: appends and prunes never interleave. */
  private chains = new Map<string, Promise<void>>();
  /** Messages per file, learned on first touch and kept on every write. */
  private counts = new Map<string, number>();
  /** Files known to end in a newline: checked once, kept by every write. */
  private terminated = new Set<string>();

  constructor(
    private readonly root: string,
    private readonly bounds: {
      messages: number;
      bytes: number;
      lowWater: number;
    } = BUS_LEDGER_BOUNDS
  ) {}

  /** A Project id is a path; the file name is a digest of it. */
  fileFor(projectId: string): string {
    const key = createHash('sha256').update(projectId).digest('hex');
    return path.join(this.root, `${key.slice(0, 24)}.jsonl`);
  }

  append(record: MessageRecord): Promise<void> {
    return this.write(record.projectId, { v: 2, type: 'message', record }, 1);
  }

  appendDelivery(
    projectId: string,
    id: string,
    recipientSessionId: string,
    event: DeliveryEvent
  ): Promise<void> {
    return this.write(
      projectId,
      { v: 2, type: 'delivery', id, to: recipientSessionId, event },
      0
    );
  }

  async read(projectId: string): Promise<BusLedgerRead> {
    const file = this.fileFor(projectId);
    await this.chains.get(file);
    let text: string;
    try {
      text = await fs.promises.readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { ok: true, records: [] };
      return {
        ok: false,
        reason: `The message log for this Project could not be read (${(error as NodeJS.ErrnoException).code ?? 'error'})`,
      };
    }
    const folded = fold(text);
    return folded.ok
      ? { ok: true, records: folded.records }
      : { ok: false, reason: folded.reason };
  }

  private write(
    projectId: string,
    line: LedgerLine,
    addsMessage: 0 | 1
  ): Promise<void> {
    const file = this.fileFor(projectId);
    const previous = this.chains.get(file) ?? Promise.resolve();
    const next = previous.then(async () => {
      await fs.promises.mkdir(this.root, { recursive: true, mode: 0o700 });
      await this.repairTail(file);
      const count = await this.countOf(file);
      try {
        await fs.promises.appendFile(file, `${JSON.stringify(line)}\n`, {
          encoding: 'utf8',
          mode: 0o600,
        });
      } catch (error) {
        // A failed append may have written part of its line.
        this.terminated.delete(file);
        throw error;
      }
      this.counts.set(file, count + addsMessage);
      await this.pruneIfOver(file);
    });
    // The chain survives a failed write; the caller still sees the failure.
    this.chains.set(
      file,
      next.catch(() => {})
    );
    return next;
  }

  /**
   * Make the file end in a newline before anything is appended to it. A
   * whole last line that only lost its newline keeps it; a torn one is
   * moved to `<file>.torn` and cut off at the last newline. Anything that
   * cannot be checked fails the write: appending onto an unknown tail could
   * turn a torn line into a damaged middle one.
   */
  private async repairTail(file: string): Promise<void> {
    if (this.terminated.has(file)) return;
    let text: string;
    try {
      text = await fs.promises.readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.terminated.add(file);
      return;
    }
    if (text === '' || text.endsWith('\n')) {
      this.terminated.add(file);
      return;
    }
    const cut = text.lastIndexOf('\n') + 1;
    const tail = text.slice(cut);
    if (parseLine(tail)) {
      await fs.promises.appendFile(file, '\n', 'utf8');
    } else {
      await fs.promises.appendFile(`${file}.torn`, `${tail}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await fs.promises.truncate(file, Buffer.byteLength(text.slice(0, cut)));
      // A torn message line was counted as a message.
      this.counts.delete(file);
    }
    this.terminated.add(file);
  }

  private async countOf(file: string): Promise<number> {
    const known = this.counts.get(file);
    if (known !== undefined) return known;
    let text = '';
    try {
      text = await fs.promises.readFile(file, 'utf8');
    } catch (error) {
      // No file yet: nothing to count. Any other failure is the write's: a
      // ledger that cannot be read must not be counted as empty, or its
      // bound would let it grow past the limit.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const count = text.split('\n').filter(raw => MESSAGE_LINE.test(raw)).length;
    this.counts.set(file, count);
    return count;
  }

  private async pruneIfOver(file: string): Promise<void> {
    const size = (await fs.promises.stat(file)).size;
    const count = this.counts.get(file) ?? 0;
    if (size <= this.bounds.bytes && count <= this.bounds.messages) return;
    const folded = fold(await fs.promises.readFile(file, 'utf8'));
    // Never rewrite a damaged log: pruning would discard what the read
    // refuses to interpret, and the operator may still want it.
    if (!folded.ok) return;
    const byteTarget = this.bounds.bytes * this.bounds.lowWater;
    const countTarget = Math.floor(this.bounds.messages * this.bounds.lowWater);
    const kept: string[][] = [];
    let bytes = 0;
    for (let index = folded.records.length - 1; index >= 0; index -= 1) {
      const block = folded.lines.get(folded.records[index].id)!;
      const blockBytes = block.reduce(
        (total, raw) => total + Buffer.byteLength(raw, 'utf8') + 1,
        0
      );
      if (kept.length >= countTarget || bytes + blockBytes > byteTarget) break;
      kept.unshift(block);
      bytes += blockBytes;
    }
    const temporary = `${file}.${process.pid}.tmp`;
    await fs.promises.writeFile(
      temporary,
      kept.map(block => `${block.join('\n')}\n`).join(''),
      { encoding: 'utf8', mode: 0o600 }
    );
    await fs.promises.rename(temporary, file);
    this.counts.set(file, kept.length);
    this.terminated.add(file);
  }
}

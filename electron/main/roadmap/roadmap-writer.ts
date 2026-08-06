import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  parseRoadmap,
  resolveRoadmapSectionStatus,
  type RoadmapDoc,
  type RoadmapItem,
  type RoadmapItemStatus,
} from '@exawatt/core';
import { loadSettings, type AgentPermissionMode } from '../settings-store';
import { isRepoRelativePath, resolveContainedPath } from '../contained-path';

export const ROADMAP_STATE_WRITE_PERMISSION = 'roadmap-state-write' as const;

export type RoadmapWritableStatus = 'now' | 'next' | 'later' | 'parked';

export type RoadmapWriteAction =
  | {
      kind: 'set-status';
      itemId: string;
      status: RoadmapWritableStatus;
    }
  | {
      kind: 'move-item';
      itemId: string;
      direction: 'up' | 'down';
    }
  | {
      kind: 'set-milestone';
      itemId: string;
      line: number;
      done: boolean;
    };

export interface RoadmapWriteRequest {
  projectDir: string;
  file: string;
  expectedContentHash: string;
  action: RoadmapWriteAction;
  /** One explicit confirmation for Projects whose launch policy is Ask first. */
  confirmed?: boolean;
}

export type RoadmapWriteResult =
  | {
      status: 'applied';
      contentHash: string;
      undoToken: string;
      permission: typeof ROADMAP_STATE_WRITE_PERMISSION;
    }
  | {
      status: 'permission-required' | 'refused' | 'failed';
      message: string;
      permission: typeof ROADMAP_STATE_WRITE_PERMISSION;
    };

export type RoadmapUndoResult =
  | { status: 'applied'; contentHash: string }
  | { status: 'refused' | 'failed'; message: string };

interface UndoEntry {
  filePath: string;
  before: string;
  afterHash: string;
  expiresAt: number;
}

const UNDO_WINDOW_MS = 10_000;
const undoEntries = new Map<string, UndoEntry>();
const fileOperationQueues = new Map<string, Promise<unknown>>();
const ITEM_ID = /^[A-Z][A-Z0-9]*-\d+$/;
const SECTION_HEADING = /^##\s+(.+?)\s*$/;
const DONE_PROSE = /\((landed|shipped)[^)]*\)|✅/i;
const WRITABLE_STATUSES = new Set<RoadmapWritableStatus>([
  'now',
  'next',
  'later',
  'parked',
]);

interface ItemBlock {
  id: string;
  start: number;
  end: number;
  sectionStart: number;
  sectionStatus: RoadmapWritableStatus | 'backlog' | 'shipped' | null;
}

interface TextLayout {
  lines: string[];
  eol: '\n' | '\r\n';
  hadFinalNewline: boolean;
}

function contentHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function validatedRequest(value: unknown): RoadmapWriteRequest {
  if (!value || typeof value !== 'object')
    throw new Error('Invalid roadmap write request');
  const input = value as Record<string, unknown>;
  const action = input.action;
  if (
    typeof input.projectDir !== 'string' ||
    typeof input.file !== 'string' ||
    typeof input.expectedContentHash !== 'string' ||
    !/^[0-9a-f]{8}$/.test(input.expectedContentHash) ||
    (input.confirmed !== undefined && typeof input.confirmed !== 'boolean') ||
    !action ||
    typeof action !== 'object'
  ) {
    throw new Error('Invalid roadmap write request');
  }
  const candidate = action as Record<string, unknown>;
  if (typeof candidate.itemId !== 'string' || !ITEM_ID.test(candidate.itemId)) {
    throw new Error('Invalid roadmap item id');
  }
  if (
    (candidate.kind === 'set-status' &&
      !WRITABLE_STATUSES.has(candidate.status as RoadmapWritableStatus)) ||
    (candidate.kind === 'move-item' &&
      candidate.direction !== 'up' &&
      candidate.direction !== 'down') ||
    (candidate.kind === 'set-milestone' &&
      (!Number.isInteger(candidate.line) ||
        (candidate.line as number) < 1 ||
        typeof candidate.done !== 'boolean')) ||
    !['set-status', 'move-item', 'set-milestone'].includes(
      candidate.kind as string
    )
  ) {
    throw new Error('Invalid roadmap state action');
  }
  return value as RoadmapWriteRequest;
}

async function resolveProjectRoadmapPath(
  projectDir: string,
  file: string
): Promise<string> {
  if (
    !path.isAbsolute(projectDir) ||
    projectDir.includes('\0') ||
    !isRepoRelativePath(file)
  ) {
    throw new Error('Invalid roadmap path');
  }
  const realRoot = await fs.promises.realpath(projectDir);
  const lexicalTarget = path.resolve(realRoot, file);
  if (!resolveContainedPath(realRoot, lexicalTarget)) {
    throw new Error('Roadmap path escaped Project');
  }
  const realTarget = await fs.promises.realpath(lexicalTarget);
  const contained = resolveContainedPath(realRoot, realTarget);
  if (!contained || contained === realRoot) {
    throw new Error('Roadmap path escaped Project');
  }
  const stat = await fs.promises.stat(contained);
  if (!stat.isFile()) throw new Error('Roadmap path is not a file');
  return contained;
}

function serializeFileOperation<T>(
  filePath: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = fileOperationQueues.get(filePath) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  fileOperationQueues.set(filePath, current);
  return current.finally(() => {
    if (fileOperationQueues.get(filePath) === current) {
      fileOperationQueues.delete(filePath);
    }
  });
}

async function atomicWriteText(filePath: string, text: string): Promise<void> {
  const stat = await fs.promises.stat(filePath);
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.exawatt-${process.pid}-${randomUUID()}.tmp`
  );
  let handle: fs.promises.FileHandle | null = null;
  try {
    handle = await fs.promises.open(temporary, 'wx', stat.mode);
    await handle.writeFile(text, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.promises.rename(temporary, filePath);
  } finally {
    await handle?.close().catch(() => {});
    await fs.promises.rm(temporary, { force: true }).catch(() => {});
  }
}

function splitText(text: string): TextLayout {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const hadFinalNewline = text.endsWith(eol);
  const lines = text.split(/\r?\n/);
  if (hadFinalNewline) lines.pop();
  return { lines, eol, hadFinalNewline };
}

function outline(lines: string[], doc: RoadmapDoc): ItemBlock[] {
  return doc.items.map((item, index) => {
    const start = item.source.line - 1;
    let sectionStart = -1;
    for (let line = start - 1; line >= 0; line--) {
      if (!lines[line].startsWith('###') && SECTION_HEADING.test(lines[line])) {
        sectionStart = line;
        break;
      }
    }
    if (sectionStart < 0) {
      throw new Error(`Roadmap item ${item.id} has no queue section`);
    }
    const next = doc.items[index + 1];
    const nextItem = next ? next.source.line - 1 : lines.length;
    let nextSection = lines.length;
    for (let line = start + 1; line < lines.length; line++) {
      if (!lines[line].startsWith('###') && SECTION_HEADING.test(lines[line])) {
        nextSection = line;
        break;
      }
    }
    return {
      id: item.id,
      start,
      end: Math.min(nextItem, nextSection),
      sectionStart,
      sectionStatus: item.sectionStatus,
    };
  });
}

export function resolveRoadmapWritePermission(projectDir: string): {
  permission: typeof ROADMAP_STATE_WRITE_PERMISSION;
  mode: AgentPermissionMode;
} {
  const settings = loadSettings();
  const source = settings.agentSources?.projectLastUsed[projectDir];
  const mode = source
    ? settings.agentSources?.projectPermissionModes[projectDir]?.[source]
    : undefined;
  return {
    permission: ROADMAP_STATE_WRITE_PERMISSION,
    // This resolver is intentionally its own seam even though its default
    // reads the Project's launch policy today (decision 0035).
    mode: mode ?? 'unrestricted',
  };
}

function canonicalSection(status: RoadmapWritableStatus): string {
  return status === 'now'
    ? 'Now'
    : status === 'next'
      ? 'Next'
      : status === 'later'
        ? 'Later'
        : 'Parked';
}

function setStatusLine(
  block: string[],
  status: RoadmapWritableStatus
): string[] {
  const next = [...block];
  const line = next.findIndex(
    (value, index) => index > 0 && /^Status:\s*/i.test(value)
  );
  if (line === -1) {
    next.splice(1, 0, '', `Status: ${status}`);
    return next;
  }
  next[line] = next[line].replace(/^(Status:\s*)\S+/i, `$1${status}`);
  return next;
}

function uniqueWriteTarget(doc: RoadmapDoc, itemId: string): RoadmapItem {
  const matches = doc.items.filter(item => item.declaredId === itemId);
  if (matches.length === 0) {
    throw new Error(`Roadmap item ${itemId} was not found`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Roadmap item ${itemId} is duplicated; resolve the ids before writing`
    );
  }
  return matches[0];
}

function blockForItem(blocks: ItemBlock[], item: RoadmapItem): ItemBlock {
  const block = blocks.find(
    candidate =>
      candidate.start === item.source.line - 1 &&
      candidate.id === item.declaredId
  );
  if (!block) throw new Error(`Roadmap item ${item.id} source moved`);
  return block;
}

function isWritableQueueStatus(
  status: RoadmapItemStatus
): status is RoadmapWritableStatus {
  return WRITABLE_STATUSES.has(status as RoadmapWritableStatus);
}

function isReorderableStatus(status: RoadmapItemStatus): boolean {
  return isWritableQueueStatus(status) || status === 'backlog';
}

function rewriteStatus(
  lines: string[],
  doc: RoadmapDoc,
  item: RoadmapItem,
  status: RoadmapWritableStatus
): string[] {
  if (!isWritableQueueStatus(item.status)) {
    throw new Error(
      `${item.id} is ${item.status}; only Now, Next, Later, and Parked items can change state`
    );
  }
  const blocks = outline(lines, doc);
  const block = blockForItem(blocks, item);
  const rewritten = setStatusLine(lines.slice(block.start, block.end), status);
  if (block.sectionStatus === status) {
    return [
      ...lines.slice(0, block.start),
      ...rewritten,
      ...lines.slice(block.end),
    ];
  }

  const without = [...lines.slice(0, block.start), ...lines.slice(block.end)];
  const remainingDoc = parseRoadmap(without.join('\n'), {
    projectDir: doc.projectDir,
    file: doc.file,
  });
  const remaining = outline(without, remainingDoc);
  const targetBlocks = remaining.filter(
    candidate => candidate.sectionStatus === status
  );
  let insertAt: number;
  if (targetBlocks.length > 0) {
    insertAt = targetBlocks[targetBlocks.length - 1].end;
  } else {
    const targetHeading = without.findIndex(line => {
      const heading = !line.startsWith('###') && SECTION_HEADING.exec(line);
      return Boolean(
        heading &&
        resolveRoadmapSectionStatus(heading[1], doc.convention) === status
      );
    });
    if (targetHeading >= 0) {
      insertAt = targetHeading + 1;
    } else {
      const shipped = without.findIndex(line =>
        /^##\s+(Shipped|Done|Completed)\b/i.test(line)
      );
      insertAt = shipped >= 0 ? shipped : without.length;
      without.splice(insertAt, 0, `## ${canonicalSection(status)}`, '');
      insertAt += 2;
    }
  }
  without.splice(insertAt, 0, ...rewritten, '');
  return without;
}

function rewriteMove(
  lines: string[],
  doc: RoadmapDoc,
  item: RoadmapItem,
  direction: 'up' | 'down'
): string[] {
  if (!isReorderableStatus(item.status)) {
    throw new Error(`${item.id} is not in a reorderable queue state`);
  }
  if (item.status !== item.sectionStatus) {
    throw new Error(
      `${item.id} has a Status override; align its section before reordering`
    );
  }
  const blocks = outline(lines, doc);
  const block = blockForItem(blocks, item);
  const index = blocks.indexOf(block);
  const neighbor = blocks[index + (direction === 'up' ? -1 : 1)];
  if (!neighbor || neighbor.sectionStart !== block.sectionStart) {
    throw new Error(
      `Roadmap item ${item.id} is already at the ${direction === 'up' ? 'top' : 'bottom'} of its state`
    );
  }
  const neighborItem = doc.items.find(
    candidate => candidate.source.line === neighbor.start + 1
  );
  if (
    !neighborItem ||
    neighborItem.status !== item.status ||
    neighborItem.sectionStatus !== item.sectionStatus
  ) {
    throw new Error(
      'Source order does not match the visible state; align Status overrides before reordering'
    );
  }
  const first = direction === 'up' ? neighbor : block;
  const second = direction === 'up' ? block : neighbor;
  return [
    ...lines.slice(0, first.start),
    ...lines.slice(second.start, second.end),
    ...lines.slice(first.start, first.end),
    ...lines.slice(second.end),
  ];
}

function rewriteMilestone(
  lines: string[],
  item: RoadmapItem,
  lineNumber: number,
  done: boolean,
  doc: RoadmapDoc
): string[] {
  const block = blockForItem(outline(lines, doc), item);
  const index = lineNumber - 1;
  if (index <= block.start || index >= block.end) {
    throw new Error('Milestone source moved');
  }
  const milestone = item.milestones.find(
    candidate => candidate.source.line === lineNumber
  );
  if (!milestone) throw new Error('Milestone source is not in Milestones');
  if (milestone.retired) throw new Error('Retired milestones are read-only');
  const source = lines[index];
  if (!/^\s*[-*]\s+/.test(source))
    throw new Error('Milestone source is not a bullet');
  if (!done && DONE_PROSE.test(source)) {
    throw new Error(
      'This milestone is completed by prose in the roadmap; edit the file to reverse it'
    );
  }
  const next = [...lines];
  if (/^\s*[-*]\s+\[[ xX]\]\s+/.test(source)) {
    next[index] = source.replace(
      /^(\s*[-*]\s+)\[[ xX]\]/,
      `$1[${done ? 'x' : ' '}]`
    );
  } else if (done) {
    next[index] = source.replace(/^(\s*[-*]\s+)/, '$1[x] ');
  } else {
    throw new Error('This milestone has no checkbox to untick');
  }
  return next;
}

function applyAction(
  text: string,
  action: RoadmapWriteAction,
  doc: RoadmapDoc
): string {
  if (!ITEM_ID.test(action.itemId))
    throw new Error('Only items with declared ids are manipulable');
  const item = uniqueWriteTarget(doc, action.itemId);
  const { lines, eol, hadFinalNewline } = splitText(text);
  const rewritten =
    action.kind === 'set-status'
      ? rewriteStatus(lines, doc, item, action.status)
      : action.kind === 'move-item'
        ? rewriteMove(lines, doc, item, action.direction)
        : rewriteMilestone(lines, item, action.line, action.done, doc);
  return rewritten.join(eol) + (hadFinalNewline ? eol : '');
}

export async function writeRoadmapState(
  value: unknown
): Promise<RoadmapWriteResult> {
  let request: RoadmapWriteRequest;
  try {
    request = validatedRequest(value);
  } catch (cause) {
    return {
      status: 'failed',
      message: cause instanceof Error ? cause.message : String(cause),
      permission: ROADMAP_STATE_WRITE_PERMISSION,
    };
  }
  const permission = resolveRoadmapWritePermission(request.projectDir);
  if (permission.mode === 'prompt' && !request.confirmed) {
    return {
      status: 'permission-required',
      message: 'Ask first is enabled for this Project',
      permission: permission.permission,
    };
  }
  try {
    const filePath = await resolveProjectRoadmapPath(
      request.projectDir,
      request.file
    );
    return await serializeFileOperation(filePath, async () => {
      const before = await fs.promises.readFile(filePath, 'utf8');
      if (contentHash(before) !== request.expectedContentHash) {
        return {
          status: 'refused' as const,
          message: 'Roadmap changed before the edit; refreshed instead',
          permission: permission.permission,
        };
      }
      const doc = parseRoadmap(before, {
        projectDir: request.projectDir,
        file: request.file,
      });
      if (doc.conformance !== 'declared') {
        return {
          status: 'refused' as const,
          message: 'Roadmap writes require declared Exawatt conformance',
          permission: permission.permission,
        };
      }
      const after = applyAction(before, request.action, doc);
      if (after === before) throw new Error('Roadmap edit produced no change');
      const immediatelyBeforeWrite = await fs.promises.readFile(
        filePath,
        'utf8'
      );
      if (contentHash(immediatelyBeforeWrite) !== request.expectedContentHash) {
        return {
          status: 'refused' as const,
          message: 'Roadmap changed while applying the edit; refreshed instead',
          permission: permission.permission,
        };
      }
      await atomicWriteText(filePath, after);
      const afterHash = contentHash(after);
      const undoToken = randomUUID();
      undoEntries.set(undoToken, {
        filePath,
        before,
        afterHash,
        expiresAt: Date.now() + UNDO_WINDOW_MS,
      });
      return {
        status: 'applied' as const,
        contentHash: afterHash,
        undoToken,
        permission: permission.permission,
      };
    });
  } catch (cause) {
    return {
      status: 'failed',
      message: cause instanceof Error ? cause.message : String(cause),
      permission: permission.permission,
    };
  }
}

export async function undoRoadmapState(
  token: string
): Promise<RoadmapUndoResult> {
  if (typeof token !== 'string' || token.length > 128) {
    return { status: 'refused', message: 'Invalid undo token' };
  }
  const entry = undoEntries.get(token);
  undoEntries.delete(token);
  if (!entry || entry.expiresAt < Date.now()) {
    return { status: 'refused', message: 'Undo window expired' };
  }
  try {
    return await serializeFileOperation(entry.filePath, async () => {
      const current = await fs.promises.readFile(entry.filePath, 'utf8');
      if (contentHash(current) !== entry.afterHash) {
        return {
          status: 'refused' as const,
          message: 'Roadmap changed after the edit; undo refused',
        };
      }
      await atomicWriteText(entry.filePath, entry.before);
      return {
        status: 'applied' as const,
        contentHash: contentHash(entry.before),
      };
    });
  } catch (cause) {
    return {
      status: 'failed',
      message: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

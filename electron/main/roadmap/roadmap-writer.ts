import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { loadSettings, type AgentPermissionMode } from '../settings-store';

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
const ITEM_ID = /^[A-Z][A-Z0-9]*-\d+$/;
const ITEM_HEADING = /^###\s+([A-Z][A-Z0-9]*-\d+)\b/;
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
        typeof candidate.done !== 'boolean')) ||
    !['set-status', 'move-item', 'set-milestone'].includes(
      candidate.kind as string
    )
  ) {
    throw new Error('Invalid roadmap state action');
  }
  return value as RoadmapWriteRequest;
}

function assertProjectPath(projectDir: string, file: string): string {
  if (
    !path.isAbsolute(projectDir) ||
    projectDir.includes('\0') ||
    !file ||
    file.includes('\0') ||
    path.isAbsolute(file)
  ) {
    throw new Error('Invalid roadmap path');
  }
  const root = path.resolve(projectDir);
  const resolved = path.resolve(root, file);
  if (!resolved.startsWith(root + path.sep))
    throw new Error('Roadmap path escaped Project');
  return resolved;
}

function sectionStatus(name: string, v2: boolean): ItemBlock['sectionStatus'] {
  if (/^(now|current)\b/i.test(name)) return 'now';
  if (/^next\b/i.test(name)) return 'next';
  if (/^(later|future)\b/i.test(name)) return 'later';
  if (/^backlog\b/i.test(name)) return v2 ? 'backlog' : 'later';
  if (/^(shipped|done|completed)\b/i.test(name)) return 'shipped';
  if (/^(parked|icebox)\b/i.test(name)) return 'parked';
  return null;
}

function outline(lines: string[], v2: boolean): ItemBlock[] {
  const starts: Array<Omit<ItemBlock, 'end'>> = [];
  let activeSectionStart = -1;
  let activeStatus: ItemBlock['sectionStatus'] = null;
  for (let index = 0; index < lines.length; index++) {
    const section =
      !lines[index].startsWith('###') && SECTION_HEADING.exec(lines[index]);
    if (section) {
      activeSectionStart = index;
      activeStatus = sectionStatus(section[1], v2);
      continue;
    }
    const item = ITEM_HEADING.exec(lines[index]);
    if (item && activeStatus) {
      starts.push({
        id: item[1],
        start: index,
        sectionStart: activeSectionStart,
        sectionStatus: activeStatus,
      });
    }
  }
  return starts.map((item, index) => {
    const nextItem = starts[index + 1]?.start ?? lines.length;
    let nextSection = lines.length;
    for (let line = item.start + 1; line < lines.length; line++) {
      if (!lines[line].startsWith('###') && SECTION_HEADING.test(lines[line])) {
        nextSection = line;
        break;
      }
    }
    return { ...item, end: Math.min(nextItem, nextSection) };
  });
}

function conventionVersion(text: string): 'v1' | 'v2' | null {
  const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!block) return null;
  const frontmatter = block[1];
  const marker = /^exawatt-roadmap:\s*(v1|v2)\s*$/m.exec(frontmatter);
  return marker?.[1] === 'v2' ? 'v2' : marker?.[1] === 'v1' ? 'v1' : null;
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
    // reads the Project's launch policy today (decision 0029).
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

function rewriteStatus(
  lines: string[],
  itemId: string,
  status: RoadmapWritableStatus,
  v2: boolean
): string[] {
  const blocks = outline(lines, v2);
  const block = blocks.find(candidate => candidate.id === itemId);
  if (!block) throw new Error(`Roadmap item ${itemId} was not found`);
  const rewritten = setStatusLine(lines.slice(block.start, block.end), status);
  if (block.sectionStatus === status) {
    return [
      ...lines.slice(0, block.start),
      ...rewritten,
      ...lines.slice(block.end),
    ];
  }

  const without = [...lines.slice(0, block.start), ...lines.slice(block.end)];
  const remaining = outline(without, v2);
  const targetBlocks = remaining.filter(
    candidate => candidate.sectionStatus === status
  );
  let insertAt: number;
  if (targetBlocks.length > 0) {
    insertAt = targetBlocks[targetBlocks.length - 1].end;
  } else {
    const targetHeading = without.findIndex(line => {
      const heading = !line.startsWith('###') && SECTION_HEADING.exec(line);
      return Boolean(heading && sectionStatus(heading[1], v2) === status);
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
  itemId: string,
  direction: 'up' | 'down',
  v2: boolean
): string[] {
  const blocks = outline(lines, v2);
  const index = blocks.findIndex(candidate => candidate.id === itemId);
  if (index === -1) throw new Error(`Roadmap item ${itemId} was not found`);
  const block = blocks[index];
  const neighbor = blocks[index + (direction === 'up' ? -1 : 1)];
  if (!neighbor || neighbor.sectionStart !== block.sectionStart) {
    throw new Error(
      `Roadmap item ${itemId} is already at the ${direction === 'up' ? 'top' : 'bottom'} of its state`
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
  itemId: string,
  lineNumber: number,
  done: boolean,
  v2: boolean
): string[] {
  const block = outline(lines, v2).find(candidate => candidate.id === itemId);
  const index = lineNumber - 1;
  if (!block || index <= block.start || index >= block.end) {
    throw new Error('Milestone source moved');
  }
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
  version: 'v1' | 'v2'
): string {
  if (!ITEM_ID.test(action.itemId))
    throw new Error('Only items with declared ids are manipulable');
  const hadFinalNewline = text.endsWith('\n');
  const lines = text.split('\n');
  if (hadFinalNewline) lines.pop();
  const v2 = version === 'v2';
  const rewritten =
    action.kind === 'set-status'
      ? rewriteStatus(lines, action.itemId, action.status, v2)
      : action.kind === 'move-item'
        ? rewriteMove(lines, action.itemId, action.direction, v2)
        : rewriteMilestone(lines, action.itemId, action.line, action.done, v2);
  return rewritten.join('\n') + (hadFinalNewline ? '\n' : '');
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
    const filePath = assertProjectPath(request.projectDir, request.file);
    const before = await fs.promises.readFile(filePath, 'utf8');
    const version = conventionVersion(before);
    if (!version) {
      return {
        status: 'refused',
        message: 'Roadmap writes require declared Exawatt conformance',
        permission: permission.permission,
      };
    }
    if (contentHash(before) !== request.expectedContentHash) {
      return {
        status: 'refused',
        message: 'Roadmap changed before the edit; refreshed instead',
        permission: permission.permission,
      };
    }
    const after = applyAction(before, request.action, version);
    if (after === before) throw new Error('Roadmap edit produced no change');
    const immediatelyBeforeWrite = await fs.promises.readFile(filePath, 'utf8');
    if (contentHash(immediatelyBeforeWrite) !== request.expectedContentHash) {
      return {
        status: 'refused',
        message: 'Roadmap changed while applying the edit; refreshed instead',
        permission: permission.permission,
      };
    }
    await fs.promises.writeFile(filePath, after, 'utf8');
    const afterHash = contentHash(after);
    const undoToken = randomUUID();
    undoEntries.set(undoToken, {
      filePath,
      before,
      afterHash,
      expiresAt: Date.now() + UNDO_WINDOW_MS,
    });
    return {
      status: 'applied',
      contentHash: afterHash,
      undoToken,
      permission: permission.permission,
    };
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
    const current = await fs.promises.readFile(entry.filePath, 'utf8');
    if (contentHash(current) !== entry.afterHash) {
      return {
        status: 'refused',
        message: 'Roadmap changed after the edit; undo refused',
      };
    }
    await fs.promises.writeFile(entry.filePath, entry.before, 'utf8');
    return { status: 'applied', contentHash: contentHash(entry.before) };
  } catch (cause) {
    return {
      status: 'failed',
      message: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

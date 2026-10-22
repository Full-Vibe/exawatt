import type {
  RoadmapConformance,
  RoadmapConvention,
  RoadmapBacklogMetadata,
  RoadmapDiagnostic,
  RoadmapDoc,
  RoadmapItem,
  RoadmapItemStatus,
  RoadmapMilestone,
} from './types';
import { trimEdgeRuns } from '../text/runs';
import {
  hasDoneMarker,
  hasRetiredMarker,
  isItemId,
  milestoneCheckbox,
  milestoneId,
  splitItemHeading,
  startsWithItemId,
  statusWord,
  tokenizeRoadmapLine,
  type RoadmapLabel,
} from './tokenize';

export interface ParseRoadmapOptions {
  projectDir: string;
  /** Repo-relative path of the file being parsed. */
  file: string;
  /** Injectable clock for tests; defaults to Date.now. */
  now?: () => number;
}

const SECTION_ALIASES_V1: Array<{
  pattern: RegExp;
  status: RoadmapItemStatus;
}> = [
  { pattern: /^(now|current)\b/i, status: 'now' },
  { pattern: /^next\b/i, status: 'next' },
  { pattern: /^(later|backlog|future)\b/i, status: 'later' },
  { pattern: /^(shipped|done|completed)\b/i, status: 'shipped' },
  { pattern: /^(parked|icebox)\b/i, status: 'parked' },
];

const SECTION_ALIASES_V2: Array<{
  pattern: RegExp;
  status: RoadmapItemStatus;
}> = [
  { pattern: /^(now|current)\b/i, status: 'now' },
  { pattern: /^next\b/i, status: 'next' },
  { pattern: /^(later|future)\b/i, status: 'later' },
  { pattern: /^backlog\b/i, status: 'backlog' },
  { pattern: /^(shipped|done|completed)\b/i, status: 'shipped' },
  { pattern: /^(parked|icebox)\b/i, status: 'parked' },
];

export function resolveRoadmapSectionStatus(
  heading: string,
  convention: RoadmapConvention
): RoadmapItemStatus | null {
  const aliases =
    convention === 'exawatt-v1' ? SECTION_ALIASES_V1 : SECTION_ALIASES_V2;
  return aliases.find(({ pattern }) => pattern.test(heading))?.status ?? null;
}

const STATUS_ALIASES: Record<string, RoadmapItemStatus> = {
  now: 'now',
  active: 'now',
  'active-build': 'now',
  'in-progress': 'now',
  building: 'now',
  next: 'next',
  later: 'later',
  backlog: 'backlog',
  shipped: 'shipped',
  done: 'shipped',
  complete: 'shipped',
  completed: 'shipped',
  landed: 'shipped',
  '✅': 'shipped',
  parked: 'parked',
  stale: 'parked',
  deferred: 'parked',
  paused: 'parked',
  'on-hold': 'parked',
};

/** Tokens that carry lifecycle info but keep the section's queue position. */
const POSITION_NEUTRAL_TOKENS = new Set(['planned', 'blocked']);

function slugify(text: string): string {
  return trimEdgeRuns(text.toLowerCase().replace(/[^a-z0-9]+/g, '-'), '-');
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function parseMilestone(
  text: string,
  file: string,
  line: number
): RoadmapMilestone {
  let rest = text;
  let done = false;
  const checkbox = milestoneCheckbox(rest);
  if (checkbox) {
    done = checkbox.done;
    rest = rest.slice(checkbox.length);
  }
  if (hasDoneMarker(rest) || rest.includes('✅')) done = true;
  const retired = !done && hasRetiredMarker(rest);
  let id: string | null = null;
  const idMatch = milestoneId(rest);
  if (idMatch) {
    id = idMatch.id;
    rest = rest.slice(idMatch.length);
  }
  const title = rest.trim() || id || text.trim();
  return { id, title, done, retired, source: { file, line } };
}

function parseBacklogMetadata(note: string): RoadmapBacklogMetadata | null {
  const parts = note
    .split('\u00b7')
    .map(part => part.trim())
    .filter(Boolean);
  if (parts.length !== 3 || !parts[0] || !isItemId(parts[1]) || !parts[2]) {
    return null;
  }
  return {
    kind: parts[0],
    ownerItemId: parts[1],
    provenance: parts[2],
  };
}

/**
 * Parse a roadmap file per the published Exawatt roadmap convention v1/v2
 * (`docs/product/reference/roadmap-convention.md`). Tolerant within the
 * grammar (alias tables), diagnostic-honest outside it: unrecognized
 * structure is counted and reported, never guessed into items.
 */
export function parseRoadmap(
  text: string,
  options: ParseRoadmapOptions
): RoadmapDoc {
  const { projectDir, file } = options;
  const lines = text.split('\n').map(line => line.replace(/\r$/, ''));

  const items: RoadmapItem[] = [];
  const diagnostics: RoadmapDiagnostic[] = [];
  const seenIds = new Map<string, number>();
  let unparsedLineCount = 0;

  let declaredVersion: 'v1' | 'v2' | null = null;
  let bodyStart = 0;
  if (lines[0] === '---') {
    const close = lines.indexOf('---', 1);
    if (close > 0) {
      const marker = lines
        .slice(1, close)
        .map(line => /^exawatt-roadmap:\s*(v1|v2)\s*$/.exec(line))
        .find(Boolean);
      declaredVersion =
        marker?.[1] === 'v2' ? 'v2' : marker?.[1] === 'v1' ? 'v1' : null;
      bodyStart = close + 1;
    }
  }
  // Unmarked files stay tolerant and receive the current additive grammar.
  // A declared v1 file retains v1's Backlog→Later semantics until migrated.
  const convention = declaredVersion === 'v1' ? 'exawatt-v1' : 'exawatt-v2';

  let section: RoadmapItemStatus | null = null;
  let sectionOrphanWarned = false;
  let item: RoadmapItem | null = null;
  let block: RoadmapLabel | null = null;
  let sawStatusLine = false;

  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    const token = tokenizeRoadmapLine(line);

    if (token.kind === 'section') {
      section = resolveRoadmapSectionStatus(token.heading, convention);
      sectionOrphanWarned = false;
      item = null;
      block = null;
      continue;
    }

    if (token.kind === 'item') {
      if (section === null) {
        if (startsWithItemId(token.heading)) {
          diagnostics.push({
            level: 'info',
            message: `item-like heading "${token.heading}" outside a queue section — ignored`,
            source: { file, line: lineNo },
          });
        }
        item = null;
        block = null;
        continue;
      }
      const split = splitItemHeading(token.heading);
      const declaredId = split ? split.id : null;
      const title = split ? split.title : token.heading;
      const id = declaredId ?? `~${slugify(title)}`;
      if (seenIds.has(id)) {
        diagnostics.push({
          level: 'warn',
          message: `duplicate item id "${id}" (first at line ${seenIds.get(id)})`,
          source: { file, line: lineNo },
        });
      } else {
        seenIds.set(id, lineNo);
      }
      item = {
        id,
        declaredId,
        title,
        sectionStatus: section,
        status: section,
        blocked: false,
        ordinal: items.length,
        statusNote: null,
        backlog: null,
        description: [],
        scope: [],
        exitCriteria: [],
        milestones: [],
        docPaths: [],
        source: { file, line: lineNo },
      };
      items.push(item);
      block = null;
      sawStatusLine = false;
      continue;
    }

    if (item === null) {
      if (section !== null && token.kind !== 'blank') {
        unparsedLineCount++;
        if (!sectionOrphanWarned) {
          diagnostics.push({
            level: 'warn',
            message: 'content in a queue section not attached to an item',
            source: { file, line: lineNo },
          });
          sectionOrphanWarned = true;
        }
      }
      continue;
    }

    if (token.kind === 'blank') continue;

    if (token.kind === 'status' && !sawStatusLine) {
      sawStatusLine = true;
      const note = token.note.trim();
      item.statusNote = note;
      const word = statusWord(note);
      if (item.status === 'backlog') {
        item.backlog = parseBacklogMetadata(note);
        // A compact backlog Status line describes the record, not its queue
        // position. Keep the section's backlog state without warning.
        if (!item.backlog) {
          diagnostics.push({
            level: 'warn',
            message:
              'backlog status must be "kind · owning item id · provenance"',
            source: { file, line: lineNo },
          });
        }
      } else if (word === 'blocked') {
        item.blocked = true;
      } else if (!POSITION_NEUTRAL_TOKENS.has(word)) {
        const mapped =
          word === 'backlog' && convention === 'exawatt-v1'
            ? 'later'
            : STATUS_ALIASES[word];
        if (mapped) {
          if (word !== mapped) {
            diagnostics.push({
              level: 'info',
              message: `status "${word}" read as "${mapped}"`,
              source: { file, line: lineNo },
            });
          }
          item.status = mapped;
        } else {
          diagnostics.push({
            level: 'warn',
            message: `unknown status "${word}" — kept section default "${item.status}"`,
            source: { file, line: lineNo },
          });
        }
      }
      block = null;
      continue;
    }

    if (token.kind === 'label') {
      block = token.label;
      continue;
    }

    if (token.kind === 'bullet') {
      const bullet = token.bullet.trim();
      if (block === 'milestones') {
        item.milestones.push(parseMilestone(bullet, file, lineNo));
      } else if (block === 'docPaths') {
        item.docPaths.push(bullet.replace(/`/g, '').trim());
      } else if (block !== null) {
        item[block].push(bullet);
      } else {
        item.description.push(bullet);
      }
      continue;
    }

    block = null;
    item.description.push(token.text);
  }

  const conformance: RoadmapConformance = declaredVersion
    ? 'declared'
    : items.length > 0
      ? 'detected'
      : 'none';

  return {
    projectDir,
    file,
    convention,
    conformance,
    items,
    diagnostics,
    unparsedLineCount,
    parsedAt: (options.now ?? Date.now)(),
    contentHash: fnv1a(text),
  };
}

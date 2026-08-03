import type {
  RoadmapConformance,
  RoadmapBacklogMetadata,
  RoadmapDiagnostic,
  RoadmapDoc,
  RoadmapItem,
  RoadmapItemStatus,
  RoadmapMilestone,
} from './types';

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

const ITEM_HEADING = /^###\s+(.+?)\s*$/;
const SECTION_HEADING = /^##\s+(.+?)\s*$/;
const ITEM_ID = /^([A-Z][A-Z0-9]*-\d+)\s+(.+)$/;
const ITEM_ID_ONLY = /^[A-Z][A-Z0-9]*-\d+\b/;
const STATUS_LINE = /^Status:\s*(.+)$/i;
const LABEL_LINE = /^(Scope|Exit criteria|Milestones|Project doc):\s*$/i;
const BULLET_LINE = /^[-*]\s+(.+)$/;
const MILESTONE_CHECKBOX = /^\[( |x|X)\]\s+/;
const MILESTONE_ID = /^([A-Z]{1,4}\d+(?:\.\d+)*)\b[\s:]*/;
const MILESTONE_DONE_MARKER = /\((landed|shipped)[^)]*\)/i;
const MILESTONE_RETIRED_MARKER =
  /\((rescoped|retired|dropped|superseded|cut)[^)]*\)/i;
const BACKLOG_OWNER_ID = /^[A-Z][A-Z0-9]*-\d+$/;

type LabeledBlock = 'scope' | 'exitCriteria' | 'milestones' | 'docPaths';

const LABEL_TO_BLOCK: Record<string, LabeledBlock> = {
  scope: 'scope',
  'exit criteria': 'exitCriteria',
  milestones: 'milestones',
  'project doc': 'docPaths',
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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
  const checkbox = MILESTONE_CHECKBOX.exec(rest);
  if (checkbox) {
    done = checkbox[1] !== ' ';
    rest = rest.slice(checkbox[0].length);
  }
  if (MILESTONE_DONE_MARKER.test(rest) || rest.includes('✅')) done = true;
  const retired = !done && MILESTONE_RETIRED_MARKER.test(rest);
  let id: string | null = null;
  const idMatch = MILESTONE_ID.exec(rest);
  if (idMatch) {
    id = idMatch[1];
    rest = rest.slice(idMatch[0].length);
  }
  const title = rest.trim() || id || text.trim();
  return { id, title, done, retired, source: { file, line } };
}

function parseBacklogMetadata(note: string): RoadmapBacklogMetadata | null {
  const parts = note
    .split('\u00b7')
    .map(part => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const ownerIndex = parts.findIndex(part => BACKLOG_OWNER_ID.test(part));
  if (ownerIndex === -1) return null;
  return {
    kind: parts[0],
    ownerItemId: parts[ownerIndex],
    provenance: parts.slice(ownerIndex + 1).join(' · ') || null,
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
  const sectionAliases =
    convention === 'exawatt-v1' ? SECTION_ALIASES_V1 : SECTION_ALIASES_V2;

  let section: RoadmapItemStatus | null = null;
  let sectionOrphanWarned = false;
  let item: RoadmapItem | null = null;
  let block: LabeledBlock | null = null;
  let sawStatusLine = false;

  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    const trimmed = line.trim();

    const sectionMatch = !line.startsWith('###') && SECTION_HEADING.exec(line);
    if (sectionMatch) {
      const alias = sectionAliases.find(({ pattern }) =>
        pattern.test(sectionMatch[1])
      );
      section = alias ? alias.status : null;
      sectionOrphanWarned = false;
      item = null;
      block = null;
      continue;
    }

    const itemMatch = !line.startsWith('####') && ITEM_HEADING.exec(line);
    if (itemMatch) {
      if (section === null) {
        if (ITEM_ID_ONLY.test(itemMatch[1])) {
          diagnostics.push({
            level: 'info',
            message: `item-like heading "${itemMatch[1]}" outside a queue section — ignored`,
            source: { file, line: lineNo },
          });
        }
        item = null;
        block = null;
        continue;
      }
      const idMatch = ITEM_ID.exec(itemMatch[1]);
      const declaredId = idMatch ? idMatch[1] : null;
      const title = idMatch ? idMatch[2] : itemMatch[1];
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
      if (section !== null && trimmed !== '') {
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

    if (trimmed === '') continue;

    const statusMatch = !sawStatusLine && STATUS_LINE.exec(trimmed);
    if (statusMatch) {
      sawStatusLine = true;
      const note = statusMatch[1].trim();
      item.statusNote = note;
      const token = note
        .split(/\s+/)[0]
        .replace(/[.,;:]+$/, '')
        .toLowerCase();
      if (item.status === 'backlog') {
        item.backlog = parseBacklogMetadata(note);
        // A compact backlog Status line describes the record, not its queue
        // position. Keep the section's backlog state without warning.
        if (!item.backlog && token !== 'backlog') {
          diagnostics.push({
            level: 'warn',
            message: 'backlog status must include an owning item id',
            source: { file, line: lineNo },
          });
        }
      } else if (token === 'blocked') {
        item.blocked = true;
      } else if (!POSITION_NEUTRAL_TOKENS.has(token)) {
        const mapped =
          token === 'backlog' && convention === 'exawatt-v1'
            ? 'later'
            : STATUS_ALIASES[token];
        if (mapped) {
          if (token !== mapped) {
            diagnostics.push({
              level: 'info',
              message: `status "${token}" read as "${mapped}"`,
              source: { file, line: lineNo },
            });
          }
          item.status = mapped;
        } else {
          diagnostics.push({
            level: 'warn',
            message: `unknown status "${token}" — kept section default "${item.status}"`,
            source: { file, line: lineNo },
          });
        }
      }
      block = null;
      continue;
    }

    const labelMatch = LABEL_LINE.exec(trimmed);
    if (labelMatch) {
      block = LABEL_TO_BLOCK[labelMatch[1].toLowerCase()];
      continue;
    }

    const bulletMatch = BULLET_LINE.exec(trimmed);
    if (bulletMatch) {
      const bullet = bulletMatch[1].trim();
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
    item.description.push(trimmed);
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

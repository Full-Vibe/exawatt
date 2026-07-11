import type {
  RoadmapConformance,
  RoadmapDoc,
  RoadmapItemStatus,
  RoadmapMilestone,
  SessionLink,
  SessionLinkConfidence,
  SessionLinkEvidence,
  SessionLinkMethod,
} from '@exawatt/core';

/**
 * Roadmap lens view model (ENG-017). Pure and geometry-free: the workspace
 * DOM rail is the first consumer; a horizontal strip or spatial expression
 * consumes the same model unchanged (same shared-resolver philosophy as
 * `selectFleetSpatialScene`).
 */

/** What the lens needs to know about a live session to render a chip. */
export interface RoadmapLensSessionInput {
  sessionId: string;
  /** Durable workspace tab id when known. */
  tabId: string | null;
  title: string;
  harness: string;
  needsAttention: boolean;
}

export interface RoadmapSessionChip {
  sessionId: string;
  tabId: string | null;
  title: string;
  harness: string;
  needsAttention: boolean;
  method: SessionLinkMethod;
  confidence: SessionLinkConfidence;
  evidence: SessionLinkEvidence[];
}

/** Normal-case pill vocabulary; `now` displays as `active`. */
export type RoadmapDisplayStatus = 'active' | 'next' | 'later' | 'shipped' | 'parked';

export interface RoadmapItemView {
  id: string;
  declaredId: string | null;
  title: string;
  status: RoadmapItemStatus;
  displayStatus: RoadmapDisplayStatus;
  blocked: boolean;
  /** The single active station — first item in the now group. */
  isNowStation: boolean;
  statusNote: string | null;
  description: string[];
  scope: string[];
  exitCriteria: string[];
  milestones: RoadmapMilestone[];
  milestonesDone: number;
  docPaths: string[];
  sourceLine: number;
  /** Parser warnings anchored inside this item's line range. */
  hasWarnings: boolean;
  chips: RoadmapSessionChip[];
}

export interface RoadmapLensTrust {
  file: string;
  conformance: RoadmapConformance;
  itemCount: number;
  warningCount: number;
  unparsedLineCount: number;
}

export type RoadmapLensStatus = 'loading' | 'ok' | 'none' | 'error';

export interface RoadmapLensView {
  status: RoadmapLensStatus;
  /** Discovery paths that were checked (status 'none'). */
  checkedPaths: string[];
  error: string | null;
  file: string | null;
  mtimeMs: number | null;
  /** All queue-status now items; the first is the hero station. */
  now: RoadmapItemView[];
  next: RoadmapItemView[];
  later: RoadmapItemView[];
  shipped: RoadmapItemView[];
  parked: RoadmapItemView[];
  /** No unfinished work anywhere — the designed "no food" moment. */
  queueEmpty: boolean;
  /** Live sessions with no link to any item; visible, never guessed. */
  unmappedSessions: RoadmapLensSessionInput[];
  trust: RoadmapLensTrust | null;
}

export type RoadmapLensRead =
  | { status: 'loading' }
  | { status: 'none'; checked: string[] }
  | { status: 'error'; error: string }
  | { status: 'ok'; doc: RoadmapDoc; mtimeMs: number };

export interface RoadmapLensInput {
  read: RoadmapLensRead;
  sessions?: RoadmapLensSessionInput[];
  /** Session→item links, declared and inferred, already merged (S3/S4). */
  links?: SessionLink[];
}

const DISPLAY_STATUS: Record<RoadmapItemStatus, RoadmapDisplayStatus> = {
  now: 'active',
  next: 'next',
  later: 'later',
  shipped: 'shipped',
  parked: 'parked',
};

function emptyView(status: RoadmapLensStatus): RoadmapLensView {
  return {
    status,
    checkedPaths: [],
    error: null,
    file: null,
    mtimeMs: null,
    now: [],
    next: [],
    later: [],
    shipped: [],
    parked: [],
    queueEmpty: false,
    unmappedSessions: [],
    trust: null,
  };
}

/** The reciprocal lookup: which item is this workspace tab executing? */
export function findRoadmapSessionChip(
  view: RoadmapLensView,
  tabId: string
): { item: RoadmapItemView; chip: RoadmapSessionChip } | null {
  for (const group of [view.now, view.next, view.later, view.shipped, view.parked]) {
    for (const item of group) {
      const chip = item.chips.find(c => c.tabId === tabId);
      if (chip) return { item, chip };
    }
  }
  return null;
}

export function buildRoadmapLens(input: RoadmapLensInput): RoadmapLensView {
  const { read, sessions = [], links = [] } = input;
  if (read.status === 'loading') return emptyView('loading');
  if (read.status === 'none') {
    return { ...emptyView('none'), checkedPaths: read.checked, unmappedSessions: sessions };
  }
  if (read.status === 'error') {
    return { ...emptyView('error'), error: read.error, unmappedSessions: sessions };
  }

  const { doc } = read;
  const linkBySession = new Map<string, SessionLink>();
  for (const link of links) {
    if (!linkBySession.has(link.sessionId)) linkBySession.set(link.sessionId, link);
  }

  const chipsByItem = new Map<string, RoadmapSessionChip[]>();
  const unmappedSessions: RoadmapLensSessionInput[] = [];
  const itemIds = new Set(doc.items.map((item) => item.id));
  for (const session of sessions) {
    const link = linkBySession.get(session.sessionId);
    if (!link || !itemIds.has(link.itemId)) {
      unmappedSessions.push(session);
      continue;
    }
    const chip: RoadmapSessionChip = {
      sessionId: session.sessionId,
      tabId: session.tabId,
      title: session.title,
      harness: session.harness,
      needsAttention: session.needsAttention,
      method: link.method,
      confidence: link.confidence,
      evidence: link.evidence,
    };
    const chips = chipsByItem.get(link.itemId);
    if (chips) chips.push(chip);
    else chipsByItem.set(link.itemId, [chip]);
  }

  // Bucket parser warnings into item line ranges so the rail can badge the
  // exact item whose source the parser struggled with.
  const sorted = [...doc.items].sort((a, b) => a.source.line - b.source.line);
  const warnLines = doc.diagnostics
    .filter((d) => d.level === 'warn')
    .map((d) => d.source.line);
  const itemHasWarning = new Set<string>();
  for (const line of warnLines) {
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (line >= sorted[i].source.line) {
        const next = sorted[i + 1];
        if (!next || line < next.source.line) itemHasWarning.add(sorted[i].id);
        break;
      }
    }
  }

  const views = doc.items.map<RoadmapItemView>((item) => ({
    id: item.id,
    declaredId: item.declaredId,
    title: item.title,
    status: item.status,
    displayStatus: DISPLAY_STATUS[item.status],
    blocked: item.blocked,
    isNowStation: false,
    statusNote: item.statusNote,
    description: item.description,
    scope: item.scope,
    exitCriteria: item.exitCriteria,
    milestones: item.milestones,
    milestonesDone: item.milestones.filter((m) => m.done).length,
    docPaths: item.docPaths,
    sourceLine: item.source.line,
    hasWarnings: itemHasWarning.has(item.id),
    chips: chipsByItem.get(item.id) ?? [],
  }));

  const byStatus = (status: RoadmapItemStatus) =>
    views.filter((v) => v.status === status);
  const now = byStatus('now');
  if (now.length > 0) now[0].isNowStation = true;

  return {
    status: 'ok',
    checkedPaths: [],
    error: null,
    file: doc.file,
    mtimeMs: read.mtimeMs,
    now,
    next: byStatus('next'),
    later: byStatus('later'),
    shipped: byStatus('shipped'),
    parked: byStatus('parked'),
    queueEmpty: now.length === 0 && byStatus('next').length === 0 && byStatus('later').length === 0,
    unmappedSessions,
    trust: {
      file: doc.file,
      conformance: doc.conformance,
      itemCount: doc.items.length,
      warningCount: warnLines.length,
      unparsedLineCount: doc.unparsedLineCount,
    },
  };
}
